import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { prisma } from '@magic-wand/db';
import { Anthropic } from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface CodeReviewerInput {
  projectId: string;
  project: {
    name: string;
    description: string;
    wizardLevel: string;
  };
}

interface CodeReviewFailure {
  severity: 'high' | 'medium' | 'low';
  category: 'functionality' | 'security' | 'performance' | 'code-quality' | 'type-safety' | 'best-practices';
  file: string;
  line?: number;
  issue: string;
  suggestion: string;
  codeSnippet?: string;
}

interface CodeReviewerOutput {
  currentPhase: 'review' | 'completed';
  reviewResult: 'pass' | 'fail';
  overallScore: number; // 0-100
  failures: CodeReviewFailure[];
  successes: string[];
  reviewedFiles: string[];
  summary: {
    totalIssues: number;
    highSeverity: number;
    mediumSeverity: number;
    lowSeverity: number;
  };
}

export class CodeReviewerAgent extends Agent {
  private anthropic: Anthropic;
  private magicWandRoot: string;

  constructor() {
    super({
      agentId: 'code-reviewer',
      name: 'Code Reviewer',
      role: '코드 리뷰 및 pass/fail 평가',
      trigger: {
        type: 'event',
        event: 'development.completed',
      },
      completionMode: CompletionMode.AUTO_CLOSE,
      maxRetries: 3,
      timeout: 1800, // 30분
      dependencies: ['developer'],
      contextSharing: {
        sharesTo: ['scrum-master', 'tester'],
        data: ['reviewResult', 'failures', 'reviewedFiles'],
      },
    });

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    this.magicWandRoot = process.cwd();
  }

  private getProjectDir(projectId: string): string {
    // /projects/<projectId>/ 경로 반환
    return join(this.magicWandRoot, 'projects', projectId);
  }

  async execute(input: CodeReviewerInput): Promise<AgentExecutionResult> {
    await this.log('Code Reviewer 작업 시작', {
      projectId: input.projectId,
    });

    try {
      // 1. Developer의 변경사항 로드
      const developerOutput = await this.getDeveloperOutput(input.projectId);

      if (!developerOutput) {
        throw new Error('Developer 실행 결과를 찾을 수 없습니다');
      }

      await this.log('Developer 변경사항 로드 완료', {
        filesCreated: developerOutput.generatedFiles?.length || 0,
        filesModified: developerOutput.changes?.length || 0,
      });

      // 2. 현재 Task 정보 로드
      const currentTask = developerOutput.currentTask;

      // ⚠️ Developer가 실패한 경우 체크
      if (!currentTask) {
        throw new Error('Developer가 실패하여 현재 Task 정보를 찾을 수 없습니다');
      }

      const story = await this.getStory(input.projectId, currentTask.storyId);

      // 3. 코드 리뷰 수행
      const reviewResult = await this.performCodeReview(
        developerOutput,
        story,
        input
      );

      await this.log('코드 리뷰 완료', {
        result: reviewResult.reviewResult,
        score: reviewResult.overallScore,
        issues: reviewResult.summary.totalIssues,
      });

      // Task 상태를 testing으로 변경 (리뷰 완료 후 테스트 단계로)
      await this.updateTaskStatus(input.projectId, 'testing');

      return {
        status: AgentStatus.COMPLETED,
        output: reviewResult,
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

  private async getDeveloperOutput(projectId: string): Promise<any> {
    const execution = await prisma.agentExecution.findFirst({
      where: {
        projectId,
        agentId: 'developer',
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    return execution?.output;
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

  private async performCodeReview(
    developerOutput: any,
    story: any,
    input: CodeReviewerInput
  ): Promise<CodeReviewerOutput> {
    await this.updateProgress(input.projectId, {
      currentPhase: 'review' as const,
      reviewResult: 'pass' as const,
      failures: [],
      reviewedFiles: [],
    });

    // 프로젝트 디렉토리 경로
    const projectDir = this.getProjectDir(input.projectId);

    // 리뷰할 파일 수집
    const filesToReview = [
      ...(developerOutput.generatedFiles || []),
      ...(developerOutput.changes || []).map((c: any) => c.file),
    ];

    const failures: CodeReviewFailure[] = [];
    const successes: string[] = [];

    for (const fileData of filesToReview) {
      const filePath = typeof fileData === 'string' ? fileData : fileData.path;
      const fullPath = join(projectDir, filePath);

      if (!existsSync(fullPath)) {
        failures.push({
          severity: 'high',
          category: 'functionality',
          file: filePath,
          issue: '파일이 존재하지 않습니다',
          suggestion: `${filePath} 파일을 생성하세요`,
        });
        continue;
      }

      // 파일 내용 읽기
      const content = readFileSync(fullPath, 'utf-8');

      // LLM을 통한 코드 리뷰
      const reviewResult = await this.reviewFile(filePath, content, story, developerOutput.currentTask);

      if (reviewResult.passed) {
        successes.push(`${filePath}: ${reviewResult.feedback}`);
      } else {
        failures.push(...reviewResult.failures);
      }
    }

    // 전체 점수 계산
    const overallScore = this.calculateOverallScore(failures, filesToReview.length);

    // Pass/Fail 결정 (70점 이상이고 high severity issue가 없어야 함)
    const hasHighSeverity = failures.some(f => f.severity === 'high');
    const reviewResult: 'pass' | 'fail' = overallScore >= 70 && !hasHighSeverity ? 'pass' : 'fail';

    const output: CodeReviewerOutput = {
      currentPhase: 'completed',
      reviewResult,
      overallScore,
      failures,
      successes,
      reviewedFiles: filesToReview.map((f: any) => typeof f === 'string' ? f : f.path),
      summary: {
        totalIssues: failures.length,
        highSeverity: failures.filter(f => f.severity === 'high').length,
        mediumSeverity: failures.filter(f => f.severity === 'medium').length,
        lowSeverity: failures.filter(f => f.severity === 'low').length,
      },
    };

    return output;
  }

  private async reviewFile(
    filePath: string,
    content: string,
    story: any,
    task: any
  ): Promise<{ passed: boolean; failures: CodeReviewFailure[]; feedback: string }> {
    const prompt = this.buildReviewPrompt(filePath, content, story, task);

    try {
      const response = await this.retryWithBackoff(
        async () => {
          return await this.anthropic.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 4096,
            temperature: 0.2,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          });
        },
        `Code review for ${filePath}`,
        3, // maxRetries
        5000, // initialDelay = 5 seconds
        2 // backoffMultiplier
      );

      const text = response.content[0].type === 'text' ? response.content[0].text : '';

      return this.parseReviewResponse(text, filePath);
    } catch (error: any) {
      await this.logError(error);
      return {
        passed: false,
        failures: [{
          severity: 'high',
          category: 'code-quality',
          file: filePath,
          issue: '코드 리뷰 중 오류 발생',
          suggestion: error.message,
        }],
        feedback: '리뷰 실패',
      };
    }
  }

  private buildReviewPrompt(filePath: string, content: string, story: any, task: any): string {
    // 내용이 너무 길면 자르기
    const truncatedContent = content.length > 8000 ? content.substring(0, 8000) + '\n... (truncated)' : content;

    return `# 코드 리뷰 요청

당신은 시니어 개발자이자 코드 리뷰어입니다.
제공된 코드를 리뷰하고 다음 카테고리에서 문제를 찾아주세요:

## 리뷰 카테고리

1. **Functionality (기능성)**: 요구사항을 올바르게 구현했는가?
2. **Security (보안)**: 보안 취약점이 있는가?
3. **Performance (성능)**: 성능 이슈가 있는가?
4. **Code Quality (코드 품질)**: 코드가 깔끔하고 유지보수 가능한가?
5. **Type Safety (타입 안전성)**: TypeScript 타입이 올바르게 사용되었는가?
6. **Best Practices (모범 사례)**: Next.js/React 모범 사례를 따르는가?

## 파일 정보

**파일 경로**: ${filePath}
**Task**: ${task?.title || 'N/A'}

## Story 컨텍스트

\`\`\`markdown
${story?.markdown || 'N/A'}
\`\`\`

## 코드

\`\`\`typescript
${truncatedContent}
\`\`\`

## 리뷰 기준

### Pass 조건
- 기능이 Story의 인수 조건을 충족함
- High/Medium severity issue가 없음
- TypeScript 타입 오류가 없음
- 보안 취약점이 없음

### Fail 조건
- 기능이 Story의 인수 조건을 충족하지 않음
- High severity issue가 1개 이상
- Medium severity issue가 3개 이상
- 타입 안전성 문제가 있음
- 보안 취약점이 있음

## 출력 형식

\`\`\`markdown
## 리뷰 결과

**결과**: PASS 또는 FAIL

## 발견된 이슈

각 이슈를 다음 형식으로 작성:

### [Severity] - Category

**파일**: ${filePath}
**라인**: (해당 라인 번호)
**문제**: (문제 설명)
**제안**: (개선 제안)
**코드**: (문제가 되는 코드 스니펫)

Severity: HIGH, MEDIUM, LOW
Category: functionality, security, performance, code-quality, type-safety, best-practices

## 피드백

(전체 피드백 - passed인 경우 주요 장점, failed인 경우 핵심 문제 요약)

## 점수

0-100 사이 점수 (PASS면 70+, FAIL이면 70 미만)
\`\`\`

중요:
- 객관적이고 구체적으로 리뷰하세요
- 개선 제안은 실행 가능해야 합니다
- Story의 인수 조건을 기반으로 평가하세요
`;
  }

  private parseReviewResponse(text: string, filePath: string): { passed: boolean; failures: CodeReviewFailure[]; feedback: string } {
    try {
      // 결과 추출
      const resultMatch = text.match(/\*\*결과\*\*:\s*(PASS|FAIL)/i);
      const result = resultMatch ? resultMatch[1].toUpperCase() : 'FAIL';
      const passed = result === 'PASS';

      // 이슈 추출
      const failures: CodeReviewFailure[] = [];
      const issueBlocks = text.match(/###\s*\[(HIGH|MEDIUM|LOW)\]\s*-\s*(\w+)[\s\S]*?(?=###\s*\[|$)/g);

      if (issueBlocks) {
        for (const block of issueBlocks) {
          const severityMatch = block.match(/\[(HIGH|MEDIUM|LOW)\]/i);
          const categoryMatch = block.match(/-\s*(\w+)/);

          const problemMatch = block.match(/\*\*문제\*\*:\s*([^\n]+)/);
          const suggestionMatch = block.match(/\*\*제안\*\*:\s*([^\n]+)/);
          const codeMatch = block.match(/\*\*코드\*\*:[\s\S]*?```[\s\S]*?```([\s\S]*?)```/);

          if (severityMatch && categoryMatch && problemMatch && suggestionMatch) {
            failures.push({
              severity: severityMatch[1].toLowerCase() as 'high' | 'medium' | 'low',
              category: categoryMatch[1].toLowerCase() as any,
              file: filePath,
              issue: problemMatch[1].trim(),
              suggestion: suggestionMatch[1].trim(),
              codeSnippet: codeMatch ? codeMatch[1].trim() : undefined,
            });
          }
        }
      }

      // 피드백 추출
      const feedbackMatch = text.match(/##\s*피드백[\s\S]*?\n([\s\S]*?)(?=##|$)/);
      const feedback = feedbackMatch ? feedbackMatch[1].trim() : '피드백 없음';

      return { passed, failures, feedback };
    } catch (error: any) {
      console.error('[CodeReviewer] Failed to parse review response:', error);
      return {
        passed: false,
        failures: [{
          severity: 'high',
          category: 'code-quality',
          file: filePath,
          issue: '리뷰 응답 파싱 실패',
          suggestion: '리뷰 응답 형식을 확인하세요',
        }],
        feedback: '리뷰 실패',
      };
    }
  }

  private calculateOverallScore(failures: CodeReviewFailure[], fileCount: number): number {
    if (fileCount === 0) return 100;

    let score = 100;

    // 심각도별 감점
    for (const failure of failures) {
      switch (failure.severity) {
        case 'high':
          score -= 20;
          break;
        case 'medium':
          score -= 10;
          break;
        case 'low':
          score -= 5;
          break;
      }
    }

    return Math.max(0, score);
  }

  private async updateProgress(projectId: string, progress: Partial<CodeReviewerOutput>): Promise<void> {
    try {
      const execution = await prisma.agentExecution.findFirst({
        where: {
          projectId,
          agentId: 'code-reviewer',
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
      console.error('[CodeReviewer] Failed to update progress:', error);
    }
  }

  private async updateTaskStatus(projectId: string, status: 'pending' | 'developing' | 'reviewing' | 'testing' | 'completed' | 'failed'): Promise<void> {
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

      // 'reviewing' 상태인 첫 번째 task 찾기 (현재 리뷰 중인 task)
      const output = scrumMasterExec.output as any;
      const task = output.tasks?.find((t: any) => t.status === 'reviewing');

      if (!task) {
        await this.log('Task 상태 업데이트 실패: reviewing 상태인 task를 찾을 수 없음', {
          totalTasks: output.tasks?.length || 0,
          taskStatuses: output.tasks?.map((t: any) => `${t.id}:${t.status}`).join(', ') || 'none',
        });
        return;
      }

      task.status = status;

      // 데이터베이스 업데이트
      await prisma.agentExecution.update({
        where: { id: scrumMasterExec.id },
        data: {
          output: output as any,
        },
      });

      await this.log('Task 상태 업데이트 완료', {
        taskId: task.id,
        oldStatus: 'reviewing',
        newStatus: status,
      });
    } catch (error) {
      await this.logError(error as Error);
    }
  }
}
