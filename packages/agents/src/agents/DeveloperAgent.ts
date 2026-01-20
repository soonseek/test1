import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { prisma } from '@magic-wand/db';
import { Anthropic } from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import fs from 'fs-extra';
import { join } from 'path';

interface DeveloperInput {
  projectId: string;
  project: {
    name: string;
    description: string;
    wizardLevel: string;
  };
  failureContext?: {
    taskId: string;
    title: string;
    description: string;
    errors: Array<{
      agentId: string;
      agentName: string;
      error: {
        message: string;
        stackTrace?: string;
      };
    }>;
  };
}

interface DeveloperOutput {
  currentPhase: 'development' | 'completed';
  currentTask?: {
    id: string;
    title: string;
    description: string;
  };
  completedTasks: string[];
  generatedFiles: {
    path: string;
    content: string;
    type: 'component' | 'page' | 'api' | 'util' | 'other';
  }[];
  changes: {
    file: string;
    diff: string;
  }[];
  summary: {
    totalTasksCompleted: number;
    filesCreated: number;
    filesModified: number;
  };
}

export class DeveloperAgent extends Agent {
  private anthropic: Anthropic;
  private magicWandRoot: string;

  constructor() {
    super({
      agentId: 'developer',
      name: 'Developer',
      role: 'Task 수행 및 코드 개발',
      trigger: {
        type: 'event',
        event: 'task.assigned',
      },
      completionMode: CompletionMode.AUTO_CLOSE,
      maxRetries: 3,
      timeout: 3600, // 60분
      dependencies: ['scrum-master'],
      contextSharing: {
        sharesTo: ['code-reviewer'],
        data: ['generatedFiles', 'changes'],
      },
    });

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // MAGIC WAND 루트 경로 (agents 패키지 기준)
    this.magicWandRoot = process.cwd();
  }

  private getProjectDir(projectId: string): string {
    // /projects/<projectId>/ 경로 반환
    return join(this.magicWandRoot, 'projects', projectId);
  }

  async execute(input: DeveloperInput): Promise<AgentExecutionResult> {
    await this.log('Developer 작업 시작', {
      projectId: input.projectId,
    });

    // 1. Scrum Master가 생성한 Task List 로드
    const scrumMasterOutput = await this.getScrumMasterOutput(input.projectId);

    if (!scrumMasterOutput) {
      await this.logError(new Error('Scrum Master 실행 결과를 찾을 수 없습니다'));
      return {
        status: AgentStatus.FAILED,
        error: {
          message: 'Scrum Master 실행 결과를 찾을 수 없습니다',
          retryable: false,
        },
      };
    }

    await this.log('Task List 로드 완료', {
      totalTasks: scrumMasterOutput.tasks.length,
    });

    // 2. 진행할 Task 선택 (pending 상태인 첫 번째 task)
    const pendingTask = scrumMasterOutput.tasks.find((t: any) => t.status === 'pending');

    if (!pendingTask) {
      await this.log('모든 Task가 완료됨');
      return {
        status: AgentStatus.COMPLETED,
        output: {
          currentPhase: 'completed',
          completedTasks: scrumMasterOutput.tasks.filter((t: any) => t.status === 'completed').map((t: any) => t.id),
          generatedFiles: [],
          changes: [],
          summary: {
            totalTasksCompleted: scrumMasterOutput.tasks.filter((t: any) => t.status === 'completed').length,
            filesCreated: 0,
            filesModified: 0,
          },
        } as DeveloperOutput,
      };
    }

    await this.log('Task 개발 시작', {
      taskId: pendingTask.id,
      title: pendingTask.title,
    });

    // 3. PRD와 Story 정보 로드
    const prd = await this.getPRD(input.projectId);
    const story = await this.getStory(input.projectId, pendingTask.storyId);

    // 4. 개발 수행 (에러 처리 포함)
    let result: DeveloperOutput;
    let taskSuccess = false;

    try {
      result = await this.performTask(pendingTask, prd, story, scrumMasterOutput, input);
      taskSuccess = true;

      await this.log('Task 개발 완료', {
        taskId: pendingTask.id,
        filesCreated: result.summary.filesCreated,
        filesModified: result.summary.filesModified,
      });

      // 5. Scrum Master의 Task 상태 업데이트 (성공)
      await this.updateTaskStatus(input.projectId, pendingTask.id, 'completed');

      return {
        status: AgentStatus.COMPLETED,
        output: result,
      };
    } catch (error: any) {
      await this.logError(error as Error);

      // Task 실패 상태로 업데이트하지만 COMPLETED로 반환하여 다음 Task 진행
      await this.updateTaskStatus(input.projectId, pendingTask.id, 'failed');

      await this.log('Task 실패로 표시하고 다음 Task 진행', {
        taskId: pendingTask.id,
        error: error.message,
      });

      // 실패해도 COMPLETED로 반환하여 루프 계속
      return {
        status: AgentStatus.COMPLETED,
        output: {
          currentPhase: 'development',
          completedTasks: scrumMasterOutput.tasks.filter((t: any) => t.status === 'completed').map((t: any) => t.id),
          generatedFiles: [],
          changes: [],
          summary: {
            totalTasksCompleted: scrumMasterOutput.tasks.filter((t: any) => t.status === 'completed').length,
            filesCreated: 0,
            filesModified: 0,
          },
          error: {
            taskId: pendingTask.id,
            message: error.message,
          },
        } as DeveloperOutput,
      };
    }
  }

  private async getScrumMasterOutput(projectId: string): Promise<any> {
    const execution = await prisma.agentExecution.findFirst({
      where: {
        projectId,
        agentId: 'scrum-master',
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    return execution?.output;
  }

  private async getPRD(projectId: string): Promise<any> {
    const execution = await prisma.agentExecution.findFirst({
      where: {
        projectId,
        agentId: 'requirement-analyzer',
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    if (!execution || !execution.output) {
      return null;
    }

    const output = execution.output as any;
    return output.selectedPRD || (output.prdOptions && output.prdOptions[0]);
  }

  private async getStory(projectId: string, storyId: string): Promise<any> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        storyFiles: true,
      },
    });

    if (!project || !project.storyFiles) {
      return null;
    }

    const stories = project.storyFiles as any[];
    return stories.find((s: any) => s.id === storyId);
  }

  private async performTask(
    task: any,
    prd: any,
    story: any,
    scrumMasterOutput: any,
    input: DeveloperInput
  ): Promise<DeveloperOutput> {
    await this.updateProgress(input.projectId, {
      currentPhase: 'development' as const,
      currentTask: {
        id: task.id,
        title: task.title,
        description: task.description,
      },
      completedTasks: scrumMasterOutput.tasks.filter((t: any) => t.status === 'completed').map((t: any) => t.id),
    });

    // 프롬프트 빌드
    const prompt = this.buildDevelopmentPrompt(task, prd, story, scrumMasterOutput, input.failureContext);

    // LLM 응답 재시도 로직 (지수 백오프 적용)
    let generatedFiles: any[] = [];
    let changes: any[] = [];

    const response = await this.retryWithBackoff(
      async () => {
        await this.log('LLM 코드 생성 시도', {
          taskId: task.id,
        });

        const llmResponse = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 16384,
          temperature: 0.3,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        });

        const text = llmResponse.content[0].type === 'text' ? llmResponse.content[0].text : '';

        // 🐛 DEBUG: LLM 응답 전체를 파일로 저장하여 분석
        const debugDir = join(this.magicWandRoot, 'debug-llm-responses');
        await fs.ensureDir(debugDir);
        const debugFile = join(debugDir, `task-${task.id}-${Date.now()}.md`);
        writeFileSync(debugFile, text, 'utf-8');
        await this.log('🐛 LLM 응답 전체를 디버그 파일에 저장', {
          taskId: task.id,
          debugFile,
          responseLength: text.length,
        });

        // 생성된 코드 파싱 및 파일 작성
        const result = await this.parseAndWriteCode(text, task, input);
        generatedFiles = result.generatedFiles;
        changes = result.changes;

        // 파일이 하나라도 생성되었는지 확인
        if (generatedFiles.length === 0 && changes.length === 0) {
          // 응답 분석으로 상세 에러 제공
          const analysis = this.analyzeLLMResponse(text);

          // 🐛 DEBUG: 실패 시 응답을 별도 파일로 저장
          const failureDebugFile = join(debugDir, `task-${task.id}-failure-${Date.now()}.md`);
          writeFileSync(failureDebugFile, text, 'utf-8');

          await this.log('❌ LLM 파일 생성 실패 - 상세 분석', {
            taskId: task.id,
            responseLength: text.length,
            responseType: analysis.type,
            elements: analysis.elements,
            failureDebugFile,
          });

          throw new Error(
            `LLM이 파일을 생성하지 않았습니다.\n` +
            `- 응답 길이: ${text.length} 바이트\n` +
            `- 응답 유형: ${analysis.type}\n` +
            `- 발견된 요소: ${analysis.elements.join(', ') || '없음'}\n` +
            `- 응답 미리보기 (앞 500자): ${text.substring(0, 500)}...\n` +
            `- 응답 미리보기 (뒤 500자): ...${text.substring(Math.max(0, text.length - 500))}\n` +
            `- 🐛 전체 응답은 파일 확인: ${failureDebugFile}`
          );
        }

        await this.log('LLM 코드 생성 성공', {
          taskId: task.id,
          filesCreated: generatedFiles.length,
          filesModified: changes.length,
        });

        return llmResponse;
      },
      `Task "${task.title}" LLM code generation`,
      3, // maxRetries
      5000, // initialDelay = 5 seconds (Ralphy uses 5s)
      2 // backoffMultiplier = 2 (exponential: 5s, 10s, 20s)
    );

    // Task 상태 업데이트
    const completedTasks = [
      ...scrumMasterOutput.tasks.filter((t: any) => t.status === 'completed').map((t: any) => t.id),
      task.id,
    ];

    const output: DeveloperOutput = {
      currentPhase: 'development',
      currentTask: task,
      completedTasks,
      generatedFiles,
      changes,
      summary: {
        totalTasksCompleted: completedTasks.length,
        filesCreated: generatedFiles.length,
        filesModified: changes.length,
      },
    };

    return output;
  }

  private buildDevelopmentPrompt(task: any, prd: any, story: any, scrumMasterOutput: any, failureContext?: any): string {
    const prdContent = prd?.analysisMarkdown || '';
    const projectId = task.projectId || 'current-project';

    // Task 유형 감지: 파일 확인/수정 vs 신규 생성
    const isFileCheckTask = /확인|검토|수정|추가|check|review|modify|add/i.test(task.title || task.description || '');

    // 실패 컨텍스트가 있는 경우 (Ralph 방식)
    let failureContextSection = '';
    if (failureContext && failureContext.errors && failureContext.errors.length > 0) {
      failureContextSection = `
## ⚠️ 이전 실패 정보 (재시도)

이 Task는 이전에 실패한 기록이 있습니다. **반드시 아래 실패 원인을 분석하고 피하세요**.

### 실패 횟수
- 이번 시도: 재시도 ${task.retryCount || 1}회차

### 이전 실패 원인
${failureContext.errors.map((errorInfo: any, idx: number) => `
#### ${idx + 1}. ${errorInfo.agentName} (${errorInfo.agentId})
\`\`\`
${errorInfo.error.message || '알 수 없는 오류'}
\`\`\`
${errorInfo.error.stackTrace ? `**Stack Trace:**\n\`\`\`\n${errorInfo.error.stackTrace.substring(0, 500)}...\n\`\`\`\n` : ''}
`).join('')}

### ✅ 실패 방지 가이드라인

**반드시 다음 사항을 준수하여 실패를 방지하세요:**

1. **파일 생성 확인**:
   - LLM 응답에 "파일을 생성하지 않았습니다" 오류가 있는 경우:
     - 반드시 \`## 파일: [경로]\` 헤더를 사용하세요
     - 코드는 \`\`\`typescript 또는 \`\`\`tsx로 감싸세요
     - import 문을 포함한 **완전한 코드**를 작성하세요
     - 코드 블록을 반드시 \`## 파일: 헤더 다음 줄에 바로 시작하세요

2. **파일 경로 규칙**:
   - 절대 경로 사용 금지 (\`projects/\`, \`/apps/\` 등)
   - 항상 \`src/\`로 시작하세요 (예: \`src/app/page.tsx\`)
   - 필요한 모든 디렉토리를 생성하세요

3. **응답 형식**:
   - 분석만 하지 말고 **실제 코드를 생성**하세요
   - "확인했습니다", "추가하겠습니다" 같은 설명만 하지 말고 코드를 작성하세요
   - 텍스트와 코드를 섞지 말고, 각 파일을 명확하게 구분하세요

4. **특히 Prisma Schema 작업 시**:
   - 기존 파일 내용을 **전체** 다시 작성하세요
   - 일부만 수정하거나 추가 부분만 작성하지 마세요
   - datasource, generator, **모든 model**을 포함한 완전한 파일을 작성하세요

---

`;
    }

    return `# 개발 Task 수행 요청

당신은 Next.js 14+ Full-Stack 개발자입니다.
할당된 Task를 수행하고 필요한 코드를 생성해주세요.

${failureContextSection}

## ⚠️ 중요: 파일 경로 지정

**프로젝트 구조:**
이 프로젝트는 **단일 Next.js 앱**입니다 (monorepo가 아닙니다).

**절대 지켜야 할 규칙:**
1. 프로젝트 루트는 이미 설정되어 있습니다 (projects/{project-id}/)
2. **절대 경로를 지정하지 마세요** (예: /projects/, ./projects/)
3. **항상 src/로 시작하세요** (예: src/app/page.tsx)
4. **apps/web/ 또는 apps/api/ 접두사를 사용하지 마세요**
5. **필요한 모든 디렉토리를 자동으로 생성하세요**

**올바른 경로 예시:**
- ✅ src/app/page.tsx
- ✅ src/lib/api/pokemon.ts
- ✅ src/components/Header.tsx
- ❌ apps/web/src/app/page.tsx (monorepo 경로 사용 금지)
- ❌ projects/xxx/src/app/page.tsx (절대 경로 사용 금지)

## Task 정보

**Task ID**: ${task.id}
**제목**: ${task.title}
**설명**: ${task.description}
**우선순위**: ${task.priority}

## Story 컨텍스트

\`\`\`markdown
${story?.markdown || 'N/A'}
\`\`\`

## PRD 컨텍스트

\`\`\`
${prdContent.substring(0, 8000)}
\`\`\`

## 기술 스택 (고정값)

- **Frontend**: Next.js 14+ (App Router)
- **UI Library**: shadcn/ui (Radix UI + Tailwind CSS)
- **Backend**: Next.js API Routes (Server-side)
- **Database**: Prisma ORM + PostgreSQL
- **Styling**: Tailwind CSS

## 프로젝트 구조

생성되는 코드는 프로젝트 루트의 하위 디렉토리에 저장됩니다:

\`\`\`
apps/
  web/              # Frontend (Next.js App Router)
    src/
      app/          # App Router pages
      components/   # React components
      lib/          # Utilities
  api/              # Backend (Next.js API Routes)
    src/
      routes/       # API routes
      lib/          # Utilities
docs/               # Documentation (PRD, Epic, Story)
\`\`\`

## 코드 생성 가이드

1. **파일 경로**: apps/web/src/app/[path]/page.tsx 형식
2. **컴포넌트**: shadcn/ui 컴포넌트 활용
3. **스타일**: Tailwind CSS 사용
4. **타입**: TypeScript strict mode
5. **API**: apps/api/src/routes/ 디렉토리

## 출력 형식

${isFileCheckTask ? `
**⚠️ 중요: 이 Task는 기존 파일 확인/수정 작업입니다**

**반드시 다음 규칙을 따르세요:**
1. 대상 파일의 **완전한 전체 내용**을 반드시 작성하세요
2. **절대 중간에 생략하지 말고** 끝까지 완성하세요
3. 파일이 이미 존재하면 **전체 내용을 그대로** 출력하세요
4. 추가/수정할 부분이 있으면 **반영된 전체 코드**를 출력하세요
5. "이 파일을 확인했습니다" 같은 설명만 하지 말고 **실제 코드를 작성**하세요

**올바른 예시:**
\`\`\`markdown
## 파일: prisma/schema.prisma

\`\`\`prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// ... 모든 model 정의를 포함하여 파일 끝까지 전체 작성
model PokemonCache {
  id        String   @id
  data      Json
  updatedAt DateTime @updatedAt
}
\`\`\`
\`\`\`

**❌ 잘못된 예시:**
- 파일을 확인했습니다. (코드 없음)
- PokemonCache 모델이 있습니다. (코드 없음)
- 코드의 일부만 작성하고 중간에 생략
` : `
각 파일을 다음 형식으로 생성하세요:

\`\`\`markdown
## 파일: apps/web/src/app/login/page.tsx

\`\`\`typescript
'use client';

import { useState } from 'react';
// ... code here
\`\`\`

## 파일: apps/api/src/routes/auth.ts

\`\`\`typescript
import { NextRequest, NextResponse } from 'next/server';
// ... code here
\`\`\`
\`\`\`
`}

## ⚠️ 필수 준수 사항

**반드시 지켜야 할 규칙:**
1. 모든 파일은 **## 파일: [경로]** 헤더로 시작
2. 코드는 **\`\`\`typescript** 또는 **\`\`\`tsx**로 감싸기
3. import 문 포함
4. 실제로 작동하는 완전한 코드
5. **파일 중간에 절대 생략하지 말고 끝까지 완성하세요**
6. **코드 블록을 닫지 않은 채로 중단하지 마세요** (\`\`\`로 반드시 닫기)

**❌ 절대 하지 말 것:**
- 코드 없이 설명만 작성
- "코드는 다음과 같습니다:"라 말만 하고 실제 코드 없음
- 코드가 \`\`\`로 감싸지 않음
- ## 파일: 헤더 없이 바로 코드 시작

**✅ 올바른 예시:**
\`\`\`markdown
## 파일: apps/web/src/app/page.tsx

\`\`\`typescript
'use client';

import { useState } from 'react';

export default function Home() {
  return <div>Hello</div>;
}
\`\`\`
\`\`\`

**❌ 잘못된 예시:**
- 파일 생성합니다: apps/web/src/app/page.tsx (코드 없음)
- 다음 파일을 만듭니다: (코드 없음)
- ## 파일: projects/xxx/apps/web/src/app/page.tsx (경로 오류)

중요:
- 실제로 작동하는 완전한 코드를 생성하세요
- import 문을 포함하세요
- 타입 안전성을 유지하세요
- 에러 처리를 추가하세요
- shadcn/ui 컴포넌트를 활용하세요
`;
  }

  /**
   * LLM 응답 분석 - 응답 유형과 문제점 감지
   */
  private analyzeLLMResponse(text: string): { type: string; elements: string[] } {
    const elements: string[] = [];

    // 마크다운 헤더 확인
    if (text.includes('##')) elements.push('markdown-headers');

    // 코드 블록 확인 (다양한 형식)
    if (text.includes('```')) elements.push('code-blocks');
    if (text.includes('```typescript')) elements.push('typescript-blocks');
    if (text.includes('```tsx')) elements.push('tsx-blocks');

    // "파일:" 헤더 확인
    if (/##\s*파일:/.test(text)) elements.push('file-headers');
    if (/##\s*File:/.test(text)) elements.push('file-headers-en');

    // 응답 유형 판단
    if (!text.includes('```') && !elements.includes('file-headers')) {
      return { type: 'text-only', elements };
    }

    if (elements.includes('markdown-headers') && !elements.includes('file-headers')) {
      return { type: 'malformed', elements };
    }

    if (elements.includes('code-blocks') && !elements.includes('file-headers')) {
      return { type: 'malformed', elements };
    }

    return { type: 'unknown', elements };
  }

  private async parseAndWriteCode(
    text: string,
    task: any,
    input: DeveloperInput
  ): Promise<{ generatedFiles: any[], changes: any[] }> {
    const generatedFiles: any[] = [];
    const changes: any[] = [];

    // 프로젝트 디렉토리 경로
    const projectDir = this.getProjectDir(input.projectId);

    // LLM 응답이 비어있거나 너무 짧은 경우 처리
    if (!text || text.trim().length < 50) {
      await this.log('LLM 응답이 비어있거나 너무 짧음', {
        taskId: task.id,
        responseLength: text?.length || 0,
      });
      return { generatedFiles, changes };
    }

    // 파일 블록 추출 - 여러 형식 시도
    let fileBlocks = text.match(/## 파일: (.+?)\n\n```[\s\S]*?```/g);

    await this.log('🔍 Regex 패턴 매칭 시도 - Pattern 1', {
      taskId: task.id,
      pattern: '/## 파일: (.+?)\\n\\n```[\\s\\S]*?```/g',
      matched: fileBlocks?.length || 0,
    });

    // 첫 번째 정규식 실패 시 대체 형식 시도
    if (!fileBlocks || fileBlocks.length === 0) {
      await this.log('Pattern 1 실패, Pattern 2 시도', {
        taskId: task.id,
      });

      // 대체 형식 1: ## 파일: ... ```typescript``` (줄바꿈 없음)
      fileBlocks = text.match(/## 파일: (.+?)\n```[\s\S]*?```/g);

      await this.log('🔍 Regex 패턴 매칭 시도 - Pattern 2', {
        taskId: task.id,
        pattern: '/## 파일: (.+?)\\n```[\\s\\S]*?```/g',
        matched: fileBlocks?.length || 0,
      });
    }

    if (!fileBlocks || fileBlocks.length === 0) {
      await this.log('Pattern 2 실패, Pattern 3 시도 (트렁케이션 허용)', {
        taskId: task.id,
      });

      // 대체 형식 2: ## 파일: ... ```lang (트레일링 ``` 없이 - 트렁케이션 대응)
      fileBlocks = text.match(/## 파일: (.+?)\n```[\s\S]*/g);

      await this.log('🔍 Regex 패턴 매칭 시도 - Pattern 3', {
        taskId: task.id,
        pattern: '/## 파일: (.+?)\\n```[\\s\\S]*/g (트렁케이션 허용)',
        matched: fileBlocks?.length || 0,
      });

      if (fileBlocks && fileBlocks.length > 0) {
        await this.log('✅ Pattern 3로 파일 블록 추출 성공', {
          taskId: task.id,
          blockCount: fileBlocks.length,
        });
      }
    }

    if (!fileBlocks || fileBlocks.length === 0) {
      await this.log('Pattern 3 실패, Pattern 4 시도 (파일 헤더 없음)', {
        taskId: task.id,
      });

      // 대체 형식 3: ```[typescript] ... ``` (파일 헤더 없음)
      fileBlocks = text.match(/```(?:typescript|tsx|ts|js|prisma)\n([\s\S]*?)```/g);

      await this.log('🔍 Regex 패턴 매칭 시도 - Pattern 4', {
        taskId: task.id,
        pattern: '/```(?:typescript|tsx|ts|js|prisma)\\n([\\s\\S]*?)```/g (파일 헤더 없음)',
        matched: fileBlocks?.length || 0,
      });

      if (fileBlocks && fileBlocks.length > 0) {
        await this.log('✅ Pattern 4로 파일 블록 추출 성공', {
          taskId: task.id,
          blockCount: fileBlocks.length,
        });
      }
    }

    if (!fileBlocks || fileBlocks.length === 0) {
      // 상세한 응답 분석
      const responseAnalysis = this.analyzeLLMResponse(text);

      await this.log('생성된 코드에서 파일 블록을 찾을 수 없음', {
        taskId: task.id,
        responseLength: text.length,
        responsePreview: text.substring(0, 200),
        hasMarkdownHeaders: text.includes('##'),
        hasCodeBlocks: text.includes('```'),
        analysis: responseAnalysis,
      });

      // LLM이 텍스트/분석만 반환한 경우
      if (responseAnalysis.type === 'text-only') {
        throw new Error(
          `LLM이 파일 블록을 생성하지 않았습니다.\n` +
          `응답 유형: 텍스트/분석만 있음 (코드 블록 없음)\n` +
          `응답 길이: ${text.length} 바이트\n` +
          `응답 미리보기:\n${text.substring(0, 300)}...\n\n` +
          `가능한 원인:\n` +
          `1. Task가 기존 파일 확인 작업인데 LLM이 새 파일 생성으로 이해\n` +
          `2. LLM이 코드 생성 대신 분석만 수행\n` +
          `3. 프롬프트 지시사항을 따르지 않음`
        );
      }

      // LLM이 잘못된 형식으로 반환한 경우
      if (responseAnalysis.type === 'malformed') {
        throw new Error(
          `LLM 응답 형식이 올바르지 않습니다.\n` +
          `응답 길이: ${text.length} 바이트\n` +
          `발견된 요소: ${responseAnalysis.elements.join(', ')}\n` +
          `응답 미리보기:\n${text.substring(0, 300)}...`
        );
      }

      return { generatedFiles, changes };
    }

    for (const block of fileBlocks) {
      // 파일 경로 추출
      const pathMatch = block.match(/## 파일: (.+)/);
      if (!pathMatch) continue;

      let filePath = pathMatch[1].trim();

      // apps/web/ 또는 apps\web\ 접두사 제거 (실제 프로젝트 구조에 맞춤)
      filePath = filePath.replace(/^apps\/(web|api)\//, '').replace(/^apps\\(web|api)\\/, '');

      const fullPath = join(projectDir, filePath);

      // 코드 내용 추출 (트렁케이션 대응: 닫는 ```가 없어도 추출)
      let codeMatch = block.match(/```(?:typescript|tsx|ts|js|prisma)?\n([\s\S]*?)```/);

      // 닫는 ```가 없는 경우 (트렁케이션) - 여는 ``` 이후 전체 추출
      if (!codeMatch) {
        codeMatch = block.match(/```(?:typescript|tsx|ts|js|prisma)?\n([\s\S]*)/);
      }

      if (!codeMatch) continue;

      const code = codeMatch[1];

      // 파일 타입 결정
      let fileType: 'component' | 'page' | 'api' | 'util' | 'other' = 'other';
      if (filePath.includes('/components/')) fileType = 'component';
      else if (filePath.includes('/app/') && filePath.endsWith('/page.tsx')) fileType = 'page';
      else if (filePath.includes('/routes/')) fileType = 'api';
      else if (filePath.includes('/lib/')) fileType = 'util';

      // 파일이 존재하는지 확인
      const fileExists = existsSync(fullPath);

      if (fileExists) {
        // 기존 파일인 경우 diff 생성
        const existingContent = readFileSync(fullPath, 'utf-8');
        const diff = this.generateDiff(existingContent, code, fullPath);

        changes.push({
          file: filePath,
          diff,
        });

        await this.log('파일 수정', {
          file: filePath,
        });
      } else {
        // 신규 파일인 경우 생성
        const dirPath = fullPath.substring(0, fullPath.lastIndexOf('\\')) || fullPath.substring(0, fullPath.lastIndexOf('/'));

        // 디렉토리 생성 (존재하지 않는 경우)
        try {
          await fs.ensureDir(dirPath);
          await this.log('디렉토리 생성', { dir: dirPath, file: filePath });
        } catch (error) {
          await this.logError(error as Error);
          // 디렉토리 생성 실패 시 파일 생성 계속 시도
        }

        // 파일 쓰기
        try {
          writeFileSync(fullPath, code, 'utf-8');

          generatedFiles.push({
            path: filePath,
            content: code,
            type: fileType,
          });

          await this.log('파일 생성 성공', {
            file: filePath,
            type: fileType,
          });
        } catch (error: any) {
          await this.logError(error);

          // 상세 에러 메시지
          if (error.code === 'ENOENT') {
            throw new Error(
              `파일 생성 실패: 디렉토리가 존재하지 않습니다.\n` +
              `요청 경로: ${filePath}\n` +
              `전체 경로: ${fullPath}\n` +
              `대상 디렉토리: ${dirPath}\n` +
              `해결책: mkdir -p "${dirPath}" 명령어로 디렉토리를 먼저 생성하세요.`
            );
          }

          throw error;
        }
      }
    }

    return { generatedFiles, changes };
  }

  private generateDiff(oldContent: string, newContent: string, filePath: string): string {
    // 간단한 diff 생성 (실제로는 diff 라이브러리 사용 권장)
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    let diff = `Diff for ${filePath}:\n`;
    diff += '```diff\n';

    const maxLines = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === newLine) {
        diff += ` ${oldLine || ''}\n`;
      } else {
        if (oldLine) diff += `- ${oldLine}\n`;
        if (newLine) diff += `+ ${newLine}\n`;
      }
    }

    diff += '```\n';

    return diff;
  }

  private async updateProgress(projectId: string, progress: Partial<DeveloperOutput>): Promise<void> {
    try {
      const execution = await prisma.agentExecution.findFirst({
        where: {
          projectId,
          agentId: 'developer',
          status: 'RUNNING',
        },
        orderBy: {
          startedAt: 'desc',
        },
      });

      if (execution) {
        const currentOutput = (execution.output as any) || {};
        const updatedOutput = { ...currentOutput, ...progress };

        await prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            output: updatedOutput as any,
          },
        });
      }
    } catch (error) {
      console.error('[Developer] Failed to update progress:', error);
    }
  }

  private async updateTaskStatus(projectId: string, taskId: string, status: 'pending' | 'in-progress' | 'completed' | 'failed'): Promise<void> {
    try {
      // Scrum Master 실행 기록 찾기
      const scrumMasterExec = await prisma.agentExecution.findFirst({
        where: {
          projectId,
          agentId: 'scrum-master',
        },
        orderBy: {
          startedAt: 'desc',
        },
      });

      if (!scrumMasterExec || !scrumMasterExec.output) {
        await this.log('Scrum Master 실행 결과를 찾을 수 없어 Task 상태 업데이트 불가');
        return;
      }

      // Task 상태 업데이트
      const output = scrumMasterExec.output as any;
      const task = output.tasks?.find((t: any) => t.id === taskId);

      if (task) {
        task.status = status;

        // 데이터베이스 업데이트
        await prisma.agentExecution.update({
          where: { id: scrumMasterExec.id },
          data: {
            output: output as any,
          },
        });

        await this.log('Task 상태 업데이트 완료', {
          taskId,
          status,
        });
      }
    } catch (error) {
      await this.logError(error as Error);
    }
  }
}
