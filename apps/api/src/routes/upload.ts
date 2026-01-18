import { Router } from 'express';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '@magic-wand/db';
import { randomBytes } from 'crypto';
import { getDocumentParser } from '@magic-wand/document-parser';

const router = Router();

// S3 클라이언트 lazy 초기화
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    // 환경변수 체크
    const region = process.env.AWS_REGION;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!region || !accessKeyId || !secretAccessKey) {
      throw new Error('AWS credentials are not configured properly');
    }

    console.log('[Upload] Initializing S3 client with:', {
      region,
      accessKeyId: accessKeyId.substring(0, 10) + '...',
      bucket: process.env.S3_BUCKET,
    });

    s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  return s3Client;
}

// POST /api/upload/presigned-url - Presigned URL 발급
router.post('/presigned-url', async (req, res) => {
  try {
    const { fileName, fileType } = req.body;

    if (!fileName || !fileType) {
      return res.status(400).json({
        error: { message: 'fileName and fileType are required' },
      });
    }

    console.log('[Upload] Generating presigned URL for:', { fileName, fileType });

    // 고유한 S3 키 생성
    const fileKey = `uploads/${Date.now()}-${randomBytes(16).toString('hex')}-${fileName}`;

    console.log('[Upload] File key:', fileKey);

    // Presigned URL 생성
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: fileKey,
      ContentType: fileType,
    });

    console.log('[Upload] S3 Command:', {
      bucket: process.env.S3_BUCKET,
      key: fileKey,
      contentType: fileType,
    });

    const presignedUrl = await getSignedUrl(getS3Client(), command, {
      expiresIn: 3600, // 1시간
    });

    console.log('[Upload] Presigned URL generated successfully');

    res.json({
      presignedUrl,
      fileKey,
      uploadUrl: `s3://${process.env.S3_BUCKET}/${fileKey}`,
    });
  } catch (error: any) {
    console.error('[Upload] Error generating presigned URL:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      code: error.Code,
      $metadata: error.$metadata,
    });

    res.status(500).json({
      error: {
        message: 'Failed to generate presigned URL',
        details: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/upload/complete - 업로드 완료 처리
router.post('/complete', async (req, res) => {
  try {
    const { projectId, s3Key, fileName, fileType, fileSize, description, parseDocument = true } = req.body;

    if (!projectId || !s3Key || !fileName || !description) {
      return res.status(400).json({
        error: { message: 'Missing required fields' },
      });
    }

    // 데이터베이스에 파일 정보 저장
    const sessionFile = await prisma.sessionFile.create({
      data: {
        projectId,
        s3Key,
        fileName,
        fileType,
        fileSize,
        description,
      },
    });

    // 문서 파싱 (비동기, 백그라운드에서 실행)
    if (parseDocument) {
      // 지원하는 파일 타입만 파싱
      const supportedTypes = [
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/jpg',
      ];

      if (supportedTypes.includes(fileType)) {
        console.log(`[Upload] Starting document parsing for ${fileName}`);

        // 비동기로 파싱 실행 (응답을 기다리지 않음)
        getDocumentParser().parseFromS3(s3Key, fileType)
          .then(async (result) => {
            if (result.success && result.parsedDocument) {
              // 파싱 결과를 데이터베이스에 저장
              await prisma.sessionFile.update({
                where: { id: sessionFile.id },
                data: {
                  parsedText: result.parsedDocument.text,
                  parsedLayout: result.parsedDocument.layout,
                  parsedTables: result.parsedDocument.tables,
                  confidence: result.parsedDocument.confidence,
                },
              });

              console.log(`[Upload] Document parsing completed for ${fileName}`);
            } else {
              console.error(`[Upload] Document parsing failed for ${fileName}:`, result.error);
            }
          })
          .catch((error) => {
            console.error(`[Upload] Document parsing error for ${fileName}:`, error);
          });
      } else {
        console.log(`[Upload] Skipping document parsing for unsupported file type: ${fileType}`);
      }
    }

    res.status(201).json({ sessionFile });
  } catch (error: any) {
    console.error('Error completing upload:', error);
    res.status(500).json({
      error: {
        message: 'Failed to complete upload',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// GET /api/upload/:fileId - 파일 조회
router.get('/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;

    const file = await prisma.sessionFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      return res.status(404).json({
        error: { message: 'File not found' },
      });
    }

    // S3에서 파일 가져오기 (Presigned URL)
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: file.s3Key,
    });

    const fileUrl = await getSignedUrl(getS3Client(), command, {
      expiresIn: 3600,
    });

    res.json({
      file: {
        ...file,
        url: fileUrl,
      },
    });
  } catch (error: any) {
    console.error('Error fetching file:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch file',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

export default router;
