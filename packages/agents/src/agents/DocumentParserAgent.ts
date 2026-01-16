import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { prisma } from '@magic-wand/db';

interface DocumentParserInput {
  fileId: string;
  s3Key: string;
  fileName: string;
  fileType: string;
  userDescription: string;
}

interface DocumentParserOutput {
  fileId: string;
  parsedDocument: {
    file_id: string;
    raw_text: string;
    layout_info?: any;
    tables?: any[];
    images?: any[];
    confidence: number;
  };
  extractedInsights: {
    document_type: string;
    key_requirements: string[];
    visual_style?: any;
    suggested_features: string[];
  };
}

export class DocumentParserAgent extends Agent {
  private upstageApiKey: string;
  private awsRegion: string;
  private s3Bucket: string;

  constructor() {
    super({
      agentId: 'document-parser',
      name: '문서 파서',
      role: '업로드된 파일을 업스테이지 API로 파싱하여 구조화된 데이터 추출',
      trigger: {
        type: 'event',
        event: 'file.uploaded',
      },
      completionMode: CompletionMode.AUTO_CLOSE,
      maxRetries: 3,
      timeout: 600, // 10분
      dependencies: [],
      contextSharing: {
        sharesTo: ['prompt-builder', 'code-generator'],
        data: ['parsed_documents', 'extracted_insights'],
      },
    });

    this.upstageApiKey = process.env.UPSTAGE_API_KEY || '';
    this.awsRegion = process.env.AWS_REGION || 'ap-northeast-2';
    this.s3Bucket = process.env.S3_BUCKET || '';
  }

  async execute(input: DocumentParserInput): Promise<AgentExecutionResult> {
    await this.log('문서 파싱 시작', { fileId: input.fileId, fileName: input.fileName });

    try {
      // 1. S3에서 파일 다운로드
      const fileBuffer = await this.downloadFromS3(input.s3Key);

      // 2. 파일 타입 감지
      const fileType = this.detectFileType(input.fileName, input.fileType);

      // 3. 업스테이지 API 호출
      const parsed = await this.parseWithUpstage(fileBuffer, fileType, input.s3Key);

      // 4. 문서 유형 추론
      const documentType = this.inferDocumentType(parsed, input.userDescription);

      // 5. 인사이트 추출
      const extractedInsights = this.extractInsights(parsed, documentType, input.userDescription);

      const output: DocumentParserOutput = {
        fileId: input.fileId,
        parsedDocument: parsed,
        extractedInsights,
      };

      // 6. 데이터베이스 업데이트
      await this.updateDatabase(input.fileId, parsed, extractedInsights);

      await this.log('문서 파싱 완료', {
        fileId: input.fileId,
        documentType,
        confidence: parsed.confidence,
      });

      return {
        status: AgentStatus.COMPLETED,
        output,
      };
    } catch (error: any) {
      await this.logError(error, { fileId: input.fileId });

      // 실패해도 계속 진행 (기본 텍스트만 사용)
      return {
        status: AgentStatus.COMPLETED,
        output: {
          fileId: input.fileId,
          parsedDocument: {
            file_id: input.fileId,
            raw_text: '',
            confidence: 0,
          },
          extractedInsights: {
            document_type: 'unknown',
            key_requirements: [],
            suggested_features: [],
          },
        },
        comments: [
          {
            type: 'warning',
            message: `파일 파싱 실패: ${input.fileName}. 기본 텍스트만 사용합니다.`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
  }

  private async downloadFromS3(s3Key: string): Promise<Buffer> {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { S3Client } = require('@aws-sdk/client-s3');

    const s3Client = new S3Client({
      region: this.awsRegion,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    const command = new GetObjectCommand({
      Bucket: this.s3Bucket,
      Key: s3Key,
    });

    const response = await s3Client.send(command);
    const chunks: Buffer[] = [];

    // @ts-ignore
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  private detectFileType(fileName: string, mimeType: string): string {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType === 'application/pdf') return 'pdf';
    if (fileName.endsWith('.doc') || fileName.endsWith('.docx')) return 'doc';
    return 'unknown';
  }

  private async parseWithUpstage(fileBuffer: Buffer, fileType: string, s3Key: string): Promise<any> {
    if (!this.upstageApiKey) {
      throw new Error('UPSTAGE_API_KEY가 설정되지 않았습니다');
    }

    const axios = require('axios');
    const FormData = require('form-data');

    try {
      const formData = new FormData();
      formData.append('document', fileBuffer, {
        filename: s3Key.split('/').pop(),
        contentType: fileType === 'pdf' ? 'application/pdf' : 'image/png',
      });
      formData.append('ocr', 'true');
      formData.append('layout_analysis', 'true');
      formData.append('table_extraction', 'true');

      const response = await axios.post(
        'https://api.upstage.ai/v1/document-ai/parse',
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.upstageApiKey}`,
            ...formData.getHeaders(),
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 300000, // 5분
        }
      );

      return {
        file_id: s3Key,
        raw_text: response.data.text || '',
        layout_info: response.data.layouts,
        tables: response.data.tables || [],
        images: response.data.images || [],
        confidence: response.data.confidence || 0.9,
      };
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`업스테이지 API 호출 실패: ${error.message}`);
    }
  }

  private inferDocumentType(parsed: any, userDescription: string): string {
    const description = userDescription.toLowerCase();
    const text = (parsed.raw_text || '').toLowerCase();

    // 사용자 설명 우선
    if (description.includes('홈') || description.includes('메인') || description.includes('레퍼런스')) {
      return 'design-reference';
    }
    if (description.includes('기획') || description.includes('요구') || description.includes('스펙')) {
      return 'spec-document';
    }
    if (description.includes('와이어프레임') || description.includes('목업')) {
      return 'wireframe';
    }

    // 텍스트 내용 분석
    if (parsed.tables && parsed.tables.length > 0) {
      return 'spec-document';
    }
    if (parsed.images && parsed.images.length > 2) {
      return 'design-reference';
    }

    return 'other';
  }

  private extractInsights(parsed: any, documentType: string, userDescription: string): any {
    const insights: any = {
      document_type: documentType,
      key_requirements: [],
      suggested_features: [],
    };

    // 텍스트에서 요구사항 추출
    const text = parsed.raw_text || '';
    if (text) {
      // 간단한 키워드 추출 (실제로는 더 정교한 NLP 필요)
      const keywords = text.match(/(?:기능|요구|필요|구현)[^。，\n]*/g) || [];
      insights.key_requirements = keywords.slice(0, 5);
    }

    // 사용자 설명
    if (userDescription) {
      insights.user_description = userDescription;
    }

    // 문서 타입별 추가 정보
    if (documentType === 'design-reference') {
      insights.visual_style = {
        has_images: parsed.images?.length > 0,
        color_suggestions: this.extractColors(text),
      };
    }

    if (documentType === 'spec-document' && parsed.tables) {
      insights.data_structures = parsed.tables.map((table: any) => ({
        headers: table.headers,
        rowCount: table.rows?.length || 0,
      }));
    }

    return insights;
  }

  private extractColors(text: string): string[] {
    // 간단한 색상 추출 (실제로는 더 정교한 방법 필요)
    const colorPatterns = [
      /#([0-9A-Fa-f]{6})/g,
      /rgb\((\d+),\s*(\d+),\s*(\d+)\)/g,
    ];

    const colors: string[] = [];
    colorPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        colors.push(...matches);
      }
    });

    return [...new Set(colors)].slice(0, 5);
  }

  private async updateDatabase(fileId: string, parsed: any, insights: any): Promise<void> {
    await prisma.sessionFile.update({
      where: { id: fileId },
      data: {
        parsedText: parsed.raw_text,
        parsedLayout: parsed.layout_info,
        parsedTables: parsed.tables,
        confidence: parsed.confidence,
      },
    });
  }
}
