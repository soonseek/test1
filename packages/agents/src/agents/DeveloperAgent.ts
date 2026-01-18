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

    try {
      // 1. Scrum Master가 생성한 Task List 로드
      const scrumMasterOutput = await this.getScrumMasterOutput(input.projectId);

      if (!scrumMasterOutput) {
        throw new Error('Scrum Master 실행 결과를 찾을 수 없습니다');
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

      // 4. 개발 수행
      const result = await this.performTask(pendingTask, prd, story, scrumMasterOutput, input);

      await this.log('Task 개발 완료', {
        taskId: pendingTask.id,
        filesCreated: result.summary.filesCreated,
        filesModified: result.summary.filesModified,
      });

      return {
        status: AgentStatus.COMPLETED,
        output: result,
      };
    } catch (error: any) {
      await this.logError(error);
      return {
        status: AgentStatus.FAILED,
        error: {
          message: error.message,
          stackTrace: error.stack,
          retryable: this.isRetryable(error),
        },
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

    // LLM을 통한 코드 생성
    const response = await this.anthropic.messages.create({
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

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // 생성된 코드 파싱 및 파일 작성
    const { generatedFiles, changes } = await this.parseAndWriteCode(text, task, input);

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

생성되는 코드는 /projects/${projectId}/ 디렉토리에 저장됩니다:

\`\`\`
projects/${projectId}/
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

    // 파일 블록 추출
    const fileBlocks = text.match(/## 파일: (.+?)\n\n```[\s\S]*?```/g);

    if (!fileBlocks) {
      throw new Error('생성된 코드에서 파일 블록을 찾을 수 없습니다');
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

  private isRetryable(error: any): boolean {
    return error.message?.includes('timeout') ||
           error.message?.includes('rate limit') ||
           error.code === 'ECONNRESET';
  }
}
