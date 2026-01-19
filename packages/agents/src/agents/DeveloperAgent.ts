import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { prisma } from '@magic-wand/db';
import { Anthropic } from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface DeveloperInput {
  projectId: string;
  project: {
    name: string;
    description: string;
    wizardLevel: string;
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
    const prompt = this.buildDevelopmentPrompt(task, prd, story, scrumMasterOutput);

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

        // 생성된 코드 파싱 및 파일 작성
        const result = await this.parseAndWriteCode(text, task, input);
        generatedFiles = result.generatedFiles;
        changes = result.changes;

        // 파일이 하나라도 생성되었는지 확인
        if (generatedFiles.length === 0 && changes.length === 0) {
          throw new Error(`LLM이 파일을 생성하지 않았습니다 (response length: ${text.length})`);
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

  private buildDevelopmentPrompt(task: any, prd: any, story: any, scrumMasterOutput: any): string {
    const prdContent = prd?.analysisMarkdown || '';
    const projectId = task.projectId || 'current-project';

    return `# 개발 Task 수행 요청

당신은 Next.js 14+ Full-Stack 개발자입니다.
할당된 Task를 수행하고 필요한 코드를 생성해주세요.

## ⚠️ 중요: 파일 경로 지정

**절대 지켜야 할 규칙:**
1. 프로젝트 루트는 이미 설정되어 있습니다
2. **절대 경로를 지정하지 마세요** (예: /projects/, ./projects/)
3. **상대 경로만 사용하세요** (예: apps/web/src/app/page.tsx)
4. **'projects/' 폴더를 경로 접두어로 사용하지 마세요**
5. 모든 경로는 apps/ 또는 docs/로 시작해야 합니다

**올바른 경로 예시:**
- ✅ apps/web/src/app/page.tsx
- ✅ apps/api/src/routes/auth.ts
- ✅ docs/development-plan.md
- ❌ projects/xxx/apps/web/src/app/page.tsx
- ❌ /projects/xxx/apps/web/src/app/page.tsx

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

## ⚠️ 필수 준수 사항

**반드시 지켜야 할 규칙:**
1. 모든 파일은 **## 파일: [경로]** 헤더로 시작
2. 코드는 **\`\`\`typescript** 또는 **\`\`\`tsx**로 감싸기
3. import 문 포함
4. 실제로 작동하는 완전한 코드

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

    // 첫 번째 정규식 실패 시 대체 형식 시도
    if (!fileBlocks || fileBlocks.length === 0) {
      await this.log('첫 번째 형식 매칭 실패, 대체 형식 시도', {
        taskId: task.id,
      });

      // 대체 형식 1: ## 파일: ... ```typescript``` (줄바꿈 없음)
      fileBlocks = text.match(/## 파일: (.+?)\n```[\s\S]*?```/g);
    }

    if (!fileBlocks || fileBlocks.length === 0) {
      await this.log('두 번째 형식도 실패, 세 번째 형식 시도', {
        taskId: task.id,
      });

      // 대체 형식 2: ```[typescript] ... ``` (파일 헤더 없음)
      fileBlocks = text.match(/```(?:typescript|tsx|ts|js)\n([\s\S]*?)```/g);

      if (fileBlocks && fileBlocks.length > 0) {
        await this.log('세 번째 형식으로 파일 블록 추출 성공', {
          taskId: task.id,
          blockCount: fileBlocks.length,
        });
      }
    }

    if (!fileBlocks || fileBlocks.length === 0) {
      await this.log('생성된 코드에서 파일 블록을 찾을 수 없음', {
        taskId: task.id,
        responsePreview: text.substring(0, 200),
      });
      return { generatedFiles, changes };
    }

    for (const block of fileBlocks) {
      // 파일 경로 추출
      const pathMatch = block.match(/## 파일: (.+)/);
      if (!pathMatch) continue;

      const filePath = pathMatch[1].trim();
      const fullPath = join(projectDir, filePath);

      // 코드 내용 추출
      const codeMatch = block.match(/```(?:typescript|tsx|ts|js)?\n([\s\S]*?)```/);
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
          execSync(`mkdir -p "${dirPath}"`, { cwd: projectDir, windowsHide: true });
        } catch (e) {
          // Directory might already exist, ignore error
        }

        // 파일 쓰기
        writeFileSync(fullPath, code, 'utf-8');

        generatedFiles.push({
          path: filePath,
          content: code,
          type: fileType,
        });

        await this.log('파일 생성', {
          file: filePath,
          type: fileType,
        });
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
