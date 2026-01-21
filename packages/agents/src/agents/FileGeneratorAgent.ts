import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { Anthropic } from '@anthropic-ai/sdk';
import { writeFileSync } from 'fs';
import fs from 'fs-extra';
import { join } from 'path';

interface FileGenerationInput {
  projectId: string;
  project: {
    name: string;
    description: string;
  };
  task: {
    id: string;
    title: string;
    description: string;
  };
  codeSpecifications: Array<{
    filePath: string;
    fileType: 'component' | 'page' | 'api' | 'util' | 'other' | 'prisma';
    description: string;
    requirements: string[];
  }>;
  prd?: any;
  story?: any;
}

interface FileGenerationOutput {
  generatedFiles: Array<{
    path: string;
    content: string;
    type: 'component' | 'page' | 'api' | 'util' | 'other' | 'prisma';
  }>;
  summary: {
    totalFiles: number;
    filesByType: Record<string, number>;
  };
}

export class FileGeneratorAgent extends Agent {
  private anthropic: Anthropic;
  private magicWandRoot: string;

  constructor() {
    super({
      agentId: 'file-generator',
      name: 'File Generator',
      role: '코드 파일 생성 전문',
      trigger: {
        type: 'dependency_satisfied',
        dependencies: ['developer'],
      },
      completionMode: CompletionMode.AUTO_CLOSE,
      maxRetries: 2,
      timeout: 900, // 15분
      dependencies: ['developer'],
      contextSharing: {
        sharesTo: ['code-reviewer'],
        data: ['generatedFiles'],
      },
    });

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    this.magicWandRoot = process.cwd();
  }

  private getProjectDir(projectId: string): string {
    return join(this.magicWandRoot, 'projects', projectId);
  }

  async execute(input: FileGenerationInput): Promise<AgentExecutionResult> {
    await this.log('File Generator 작업 시작', {
      projectId: input.projectId,
      taskId: input.task.id,
      filesToGenerate: input.codeSpecifications.length,
    });

    try {
      // 프롬프트 빌드
      const prompt = this.buildPrompt(input);

      // LLM 호출
      const llmResponse = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 16384,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const text = llmResponse.content[0].type === 'text' ? llmResponse.content[0].text : '';

      // 🐛 DEBUG: 응답 저장
      const debugDir = join(this.magicWandRoot, 'apps', 'api', 'debug-llm-responses');
      await fs.ensureDir(debugDir);
      const debugFile = join(debugDir, `filegen-${input.task.id}-${Date.now()}.md`);
      writeFileSync(debugFile, text, 'utf-8');
      await this.log('🐛 LLM 응답 저장', { debugFile });

      // 코드 파싱 및 파일 생성
      const result = await this.parseAndWriteFiles(text, input);

      await this.log('File Generator 완료', {
        filesGenerated: result.generatedFiles.length,
      });

      return {
        status: AgentStatus.COMPLETED,
        output: result,
      };
    } catch (error: any) {
      await this.logError(error as Error);

      return {
        status: AgentStatus.FAILED,
        error: {
          message: error.message,
          retryable: true,
        },
      };
    }
  }

  private buildPrompt(input: FileGenerationInput): string {
    const { task, codeSpecifications, prd, story } = input;

    const specsList = codeSpecifications.map((spec, idx) => `
### 파일 ${idx + 1}: ${spec.filePath}
- **타입**: ${spec.fileType}
- **설명**: ${spec.description}
- **요구사항**:
${spec.requirements.map(req => `  - ${req}`).join('\n')}
`).join('\n');

    return `# 코드 파일 생성 요청

당신은 전문 코드 생성 에이전트입니다. 아래 사양에 따라 코드를 생성하세요.

## ⚠️ 필수 출력 형식

반드시 이 형식만 사용하세요:

\`\`\`markdown
## 파일: [파일경로]

\`\`\`[language]
[code]
\`\`\`

## 파일: [파일경로]

\`\`\`[language]
[code]
\`\`\`
\`\`\`

**규칙:**
1. \`## 파일: [경로]\` 헤더로 시작
2. **바로 다음 줄**부터 \`\`\`[language] 시작
3. 헤더와 코드 사이에 **절대 설명 텍스트 넣지 말 것**
4. 코드 블록은 반드시 \`\`\`로 닫기

## Task 정보

**제목**: ${task.title}
**설명**: ${task.description}

## 생성할 파일

${specsList}

## 기술 스택

- Next.js 14+ (App Router)
- shadcn/ui + Tailwind CSS
- Prisma ORM + PostgreSQL
- TypeScript

## 컨텍스트

**PRD:**
\`\`\`
${prd?.analysisMarkdown?.substring(0, 2000) || 'N/A'}
\`\`\`

**Story:**
\`\`\`
${story?.markdown?.substring(0, 1500) || 'N/A'}
\`\`\`

## 출력 예시

\`\`\`markdown
## 파일: src/lib/api/pokemon.ts

\`\`\`typescript
import { PrismaClient } from '@prisma/client';

export async function getPokemonList() {
  const prisma = new PrismaClient();
  return await prisma.pokemonCache.findMany();
}
\`\`\`

## 파일: src/app/page.tsx

\`\`\`tsx
export default function Home() {
  return <div>Pokemon App</div>;
}
\`\`\`
\`\`\`

위 형식을 정확히 따라서 코드를 생성하세요.
`;
  }

  private async parseAndWriteFiles(
    text: string,
    input: FileGenerationInput
  ): Promise<FileGenerationOutput> {
    const generatedFiles: FileGenerationOutput['generatedFiles'] = [];
    const projectDir = this.getProjectDir(input.projectId);

    await this.log('파일 파싱 시작', {
      responseLength: text.length,
    });

    // 엄격한 형식: ## 파일: [path] 다음 줄에 바로 ```lang
    const filePattern = /##\s*파일:\s*(.+?)\n\n```(\w+)?\n([\s\S]*?)```/g;
    let match;
    let fileCount = 0;

    while ((match = filePattern.exec(text)) !== null) {
      const [, filePath, language, code] = match;
      fileCount++;

      await this.log(`파일 ${fileCount} 파싱`, {
        filePath: filePath.trim(),
        language,
        codeLength: code.length,
      });

      // apps/web/ 또는 apps/api/ 접두사 제거
      let cleanPath = filePath.trim().replace(/^apps\/(web|api)\//, '').replace(/^apps\\(web|api)\\/, '');

      // 파일 타입 결정
      let fileType: 'component' | 'page' | 'api' | 'util' | 'other' | 'prisma' = 'other';
      if (cleanPath.includes('prisma/schema.prisma')) fileType = 'prisma';
      else if (cleanPath.includes('/components/')) fileType = 'component';
      else if (cleanPath.includes('/app/') && cleanPath.endsWith('page.tsx')) fileType = 'page';
      else if (cleanPath.includes('/routes/')) fileType = 'api';
      else if (cleanPath.includes('/lib/')) fileType = 'util';

      const fullPath = join(projectDir, cleanPath);

      // 디렉토리 생성
      const dirPath = fullPath.substring(0, fullPath.lastIndexOf('\\')) ||
                      fullPath.substring(0, fullPath.lastIndexOf('/'));
      try {
        await fs.ensureDir(dirPath);
      } catch (error) {
        await this.logError(error as Error);
      }

      // 파일 쓰기
      try {
        writeFileSync(fullPath, code, 'utf-8');

        generatedFiles.push({
          path: cleanPath,
          content: code,
          type: fileType,
        });

        await this.log('파일 생성 성공', {
          file: cleanPath,
          type: fileType,
        });
      } catch (error: any) {
        await this.logError(error);
        throw new Error(`파일 생성 실패: ${cleanPath} - ${error.message}`);
      }
    }

    if (generatedFiles.length === 0) {
      await this.log('파일 파싱 실패', {
        responsePreview: text.substring(0, 500),
      });

      throw new Error(
        `파일 생성 실패: LLM 응답에서 파일을 찾을 수 없습니다.\n` +
        `예상 형식: "## 파일: [path]\n\n\`\`\`lang\ncode\n\`\`\`"\n` +
        `응답 길이: ${text.length} 바이트\n` +
        `응답 미리보기:\n${text.substring(0, 300)}...`
      );
    }

    // 타입별 집계
    const filesByType: Record<string, number> = {};
    generatedFiles.forEach(file => {
      filesByType[file.type] = (filesByType[file.type] || 0) + 1;
    });

    return {
      generatedFiles,
      summary: {
        totalFiles: generatedFiles.length,
        filesByType,
      },
    };
  }
}
