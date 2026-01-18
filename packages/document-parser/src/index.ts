import axios from 'axios';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import FormData from 'form-data';

export interface ParsedDocument {
  text: string;
  layout?: any[];
  tables?: any[];
  confidence?: number;
}

export interface DocumentParseResult {
  success: boolean;
  parsedDocument?: ParsedDocument;
  error?: string;
}

export class DocumentParser {
  private s3Client: S3Client | null = null;
  private upstageApiKey: string;

  constructor() {
    this.upstageApiKey = process.env.UPSTAGE_API_KEY || '';

    if (!this.upstageApiKey) {
      console.warn('[DocumentParser] UPSTAGE_API_KEY not set');
    }
  }

  private getS3Client(): S3Client {
    if (!this.s3Client) {
      const region = process.env.AWS_REGION;
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

      if (!region || !accessKeyId || !secretAccessKey) {
        throw new Error('AWS credentials are not configured properly');
      }

      this.s3Client = new S3Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    }

    return this.s3Client;
  }

  /**
   * S3에서 파일 다운로드
   */
  private async downloadFromS3(s3Key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: s3Key,
    });

    const response = await this.getS3Client().send(command);
    const bytes = await response.Body?.transformToByteArray();

    if (!bytes) {
      throw new Error('Failed to download file from S3');
    }

    return Buffer.from(bytes);
  }

  /**
   * 업스테이지 문서 파싱 API 호출
   */
  private async parseWithUpstage(fileBuffer: Buffer, mimeType: string): Promise<ParsedDocument> {
    if (!this.upstageApiKey) {
      throw new Error('UPSTAGE_API_KEY is not configured');
    }

    try {
      // FormData 생성
      const form = new FormData();

      form.append('document', fileBuffer, {
        filename: 'document',
        contentType: mimeType,
      });
      form.append('output_type', 'text'); // 또는 'html', 'json'

      // 업스테이지 API 호출
      const response = await axios.post(
        'https://api.upstage.ai/v1/document-digitization',
        form,
        {
          headers: {
            'Authorization': `Bearer ${this.upstageApiKey}`,
            ...form.getHeaders(),
          },
          timeout: 60000, // 60초 타임아웃
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }
      );

      if (response.data && response.data.text) {
        return {
          text: response.data.text,
          layout: response.data.layout,
          tables: response.data.tables,
          confidence: response.data.confidence,
        };
      } else {
        throw new Error('Invalid response from Upstage API');
      }
    } catch (error: any) {
      console.error('[DocumentParser] Upstage API error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * S3 파일을 업스테이지로 파싱
   */
  async parseFromS3(s3Key: string, mimeType: string): Promise<DocumentParseResult> {
    try {
      console.log(`[DocumentParser] Parsing document from S3: ${s3Key}`);

      // 1. S3에서 파일 다운로드
      const fileBuffer = await this.downloadFromS3(s3Key);
      console.log(`[DocumentParser] Downloaded ${fileBuffer.length} bytes from S3`);

      // 2. 업스테이지 API로 파싱
      const parsedDocument = await this.parseWithUpstage(fileBuffer, mimeType);

      console.log(`[DocumentParser] Successfully parsed document (${parsedDocument.text.length} characters)`);

      return {
        success: true,
        parsedDocument,
      };
    } catch (error: any) {
      console.error('[DocumentParser] Parse error:', error);
      return {
        success: false,
        error: error.message || 'Failed to parse document',
      };
    }
  }

  /**
   * 로컬 파일 파싱 (테스트용)
   */
  async parseLocalFile(filePath: string): Promise<DocumentParseResult> {
    // 구현 필요 시
    return {
      success: false,
      error: 'Not implemented',
    };
  }
}

// 싱글톤 인스턴스
let parserInstance: DocumentParser | null = null;

export function getDocumentParser(): DocumentParser {
  if (!parserInstance) {
    parserInstance = new DocumentParser();
  }
  return parserInstance;
}
