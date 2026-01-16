import { Router } from 'express';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '@magic-wand/db';
import { randomBytes } from 'crypto';

const router = Router();

// S3 클라이언트 초기화
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// POST /api/upload/presigned-url - Presigned URL 발급
router.post('/presigned-url', async (req, res) => {
  try {
    const { fileName, fileType } = req.body;

    if (!fileName || !fileType) {
      return res.status(400).json({
        error: { message: 'fileName and fileType are required' },
      });
    }

    // 고유한 S3 키 생성
    const fileKey = `uploads/${Date.now()}-${randomBytes(16).toString('hex')}-${fileName}`;

    // Presigned URL 생성
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: fileKey,
      ContentType: fileType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1시간
    });

    res.json({
      presignedUrl,
      fileKey,
      uploadUrl: `s3://${process.env.S3_BUCKET}/${fileKey}`,
    });
  } catch (error: any) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({
      error: {
        message: 'Failed to generate presigned URL',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/upload/complete - 업로드 완료 처리
router.post('/complete', async (req, res) => {
  try {
    const { projectId, s3Key, fileName, fileType, fileSize, description } = req.body;

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

    const fileUrl = await getSignedUrl(s3Client, command, {
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
