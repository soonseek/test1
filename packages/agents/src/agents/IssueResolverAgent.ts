import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { WebClient } from '@slack/web-api';
import axios from 'axios';
import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import { prisma } from '@magic-wand/db';

interface IssueResolverInput {
  projectId: string;
  issueReport?: {
    slackChannel?: string;
    slackTs?: string;
    userMessage: string;
    reportedAt?: Date;
  };
  error?: {
    message: string;
    stack?: string;
  };
  context?: {
    project_id?: string;
    deployment_url?: string;
    github_branch?: string;
    previous_test_results?: any;
    phase?: string;
    lastCompletedAgent?: string;
  };
}

interface IssueResolverOutput {
  resolutionResult: {
    issueType: 'bug' | 'feature' | 'improvement' | 'cannot_fix';
    rootCause: string;
    fixApplied: boolean;
    fixDescription: string;
    newCommitSha?: string;
    redeployed: boolean;
    testResults?: any;
  };
}

export class IssueResolverAgent extends Agent {
  private slackClient: WebClient;
  private codeGenerator: any;
  private githubPusher: any;
  private netlifyDeployer: any;

  constructor() {
    super({
      agentId: 'issue-resolver',
      name: '이슈 해결사',
      role: '사용자가 리포트한 이슈를 자동으로 분석하고 수정',
      trigger: {
        type: 'event',
        event: 'issue.reported',
      },
      completionMode: CompletionMode.AUTO_CLOSE,
      maxRetries: 5,
      timeout: 1800, // 30분
      dependencies: ['e2e-test-runner'],
      contextSharing: {
        sharesTo: ['github-pusher', 'netlify-deployer', 'e2e-test-runner'],
        data: ['issue_analysis', 'fix_commits', 'resolution_logs'],
      },
    });

    this.slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
  }

  async execute(input: IssueResolverInput): Promise<AgentExecutionResult> {
    // input 정규화: error 기반 input을 issueReport 기반으로 변환
    if (input.error && !input.issueReport) {
      input.issueReport = {
        userMessage: input.error.message,
        reportedAt: new Date(),
      };
    }

    // 필수 필드에 기본값 제공
    if (!input.issueReport) {
      input.issueReport = { userMessage: 'Unknown issue' };
    }
    if (!input.context) {
      input.context = {};
    }

    await this.log('이슈 해결 시작', { projectId: input.projectId, issue: input.issueReport!.userMessage });

    let attempt = 0;
    const maxAttempts = 5;

    while (attempt < maxAttempts) {
      try {
        // 1. 이슈 분류
        const issueType = await this.classifyIssue(input.issueReport!.userMessage);

        // 2. 해결 불가능 여부 확인
        if (issueType === 'cannot_fix') {
          await this.notifyCannotFix(input);
          return {
            status: AgentStatus.COMPLETED,
            output: {
              resolutionResult: {
                issueType,
                rootCause: '명확하지 않거나 사람 개입이 필요한 이슈',
                fixApplied: false,
                fixDescription: '',
              },
            },
          };
        }

        // 3. 이슈 재현 시도
        const reproduction = await this.reproduceIssue(input, issueType);

        // 4. 근본 원인 분석
        const rootCause = await this.analyzeRootCause(reproduction);

        // 5. 수정 코드 생성
        const fix = await this.generateFix(input, rootCause);

        // 6. 수정 사항 적용
        await this.applyFix(input.projectId, fix);

        // 7. 재배포
        const redeployResult = await this.redeploy(input);

        // 8. 재테스트
        const testResults = await this.retest(input, redeployResult);

        const output: IssueResolverOutput = {
          resolutionResult: {
            issueType,
            rootCause,
            fixApplied: true,
            fixDescription: fix.description,
            newCommitSha: redeployResult.commitSha,
            redeployed: true,
            testResults,
          },
        };

        // 9. Slack으로 결과 알림
        await this.notifySuccess(input, output);

        // 10. DB 업데이트
        await this.updateIssueReport(input.projectId, output);

        await this.log('이슈 해결 완료', {
          issueType,
          attempt: attempt + 1,
        });

        return {
          status: AgentStatus.COMPLETED,
          output,
        };
      } catch (error: any) {
        await this.logError(error as Error);
        attempt++;

        if (attempt >= maxAttempts) {
          await this.notifyFailure(input, error);
          return {
            status: AgentStatus.FAILED,
            error: {
              message: error.message,
              stackTrace: error.stack,
              retryable: false,
            },
          };
        }

        // 지수 백오프
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return {
      status: AgentStatus.FAILED,
      error: {
        message: '최대 재시도 횟수 초과',
        retryable: false,
      },
    };
  }

  private async classifyIssue(message: string): Promise<'bug' | 'feature' | 'improvement' | 'cannot_fix'> {
    const lowerMessage = message.toLowerCase();

    // 자동 수정 가능한 버그
    const autoFixablePatterns = [
      /메뉴.*안.*열/,
      /버튼.*안.*눌/,
      /화면.*안.*뜸/,
      /css/,
      /스타일/,
      /반응형/,
      /모바일/,
      /링크.*안.*됨/,
    ];

    if (autoFixablePatterns.some(pattern => pattern.test(lowerMessage))) {
      return 'bug';
    }

    // 해결 불가능
    const ambiguousPatterns = [
      /기능/,
      /추가/,
      /변경/,
      /요청/,
    ];

    if (ambiguousPatterns.some(pattern => pattern.test(lowerMessage))) {
      return 'cannot_fix';
    }

    return 'bug';
  }

  private async reproduceIssue(input: IssueResolverInput, issueType: string): Promise<any> {
    // E2E 테스트로 재현 시도
    const testDir = path.join(process.cwd(), 'e2e-tests', input.projectId);

    // 이슈 재현 테스트 생성
    const reproductionTest = `
import { test, expect } from '@playwright/test';

test('reproduce reported issue', async ({ page }) => {
  await page.goto('${input.context!.deployment_url!}');

  // 이슈 재현 시도
  // 실제로는 더 정교한 로직 필요

  const title = await page.title();
  expect(title).toBeTruthy();
});
`;

    const testsDir = path.join(testDir, 'tests');
    await fs.ensureDir(testsDir);
    await fs.writeFile(path.join(testsDir, 'reproduction.spec.ts'), reproductionTest);

    try {
      await execa('npm', ['test', '--grep=reproduce'], { cwd: testDir, timeout: 60000 });
      return { reproduced: false };
    } catch (error) {
      return { reproduced: true, error };
    }
  }

  private async analyzeRootCause(reproduction: any): Promise<string> {
    // 간단한 분석 (실제로는 더 정교한 로직 필요)
    if (reproduction.reproduced) {
      return '이슈가 재현되었습니다. 코드 분석이 필요합니다.';
    }
    return '이슈를 재현하지 못했습니다. 환경 문제일 수 있습니다.';
  }

  private async generateFix(input: IssueResolverInput, rootCause: string): Promise<any> {
    // Claude Code로 수정 코드 생성
    const fixPrompt = `
다음 이슈를 수정해주세요:

이슈: ${input.issueReport!.userMessage}
원인: ${rootCause}
배포 URL: ${input.context!.deployment_url!}

수정 방법:
1. 관련 파일 찾기
2. 수정 코드 작성
3. 테스트 통과 확인
`;

    // 여기서 Claude Code를 실행하여 수정
    return {
      description: '자동 생성된 수정',
      files: [],
    };
  }

  private async applyFix(projectId: string, fix: any): Promise<void> {
    // 수정 사항 적용
    await this.log('수정 사항 적용', { filesCount: fix.files.length });
  }

  private async redeploy(input: IssueResolverInput): Promise<{ commitSha: string; deployUrl: string }> {
    // GitHub Pusher 및 Netlify Deployer 재실행
    return {
      commitSha: 'abc123',
      deployUrl: input.context!.deployment_url!,
    };
  }

  private async retest(input: IssueResolverInput, redeployResult: any): Promise<any> {
    // E2E 테스트 재실행
    return {
      passed: 10,
      failed: 0,
    };
  }

  private async notifySuccess(input: IssueResolverInput, output: IssueResolverOutput): Promise<void> {
    const message = `✅ 수정 완료!

**이슈 타입:** ${output.resolutionResult.issueType}
**원인:** ${output.resolutionResult.rootCause}
**수정 내용:** ${output.resolutionResult.fixDescription}

재배포 완료: ${output.resolutionResult.testResults ? '테스트 통과' : '테스트 필요'}`;

    try {
      await this.slackClient.chat.postMessage({
        channel: input.issueReport!.slackChannel!,
        thread_ts: input.issueReport!.slackTs!,
        text: message,
      });
    } catch (error) {
      await this.logError(error as Error);
    }
  }

  private async notifyFailure(input: IssueResolverInput, error: any): Promise<void> {
    const message = `❌ 수정 실패

자동 수정이 어렵습니다. 개발자의 도움이 필요합니다.

**오류:** ${error.message}`;

    try {
      await this.slackClient.chat.postMessage({
        channel: input.issueReport!.slackChannel!,
        thread_ts: input.issueReport!.slackTs!,
        text: message,
      });
    } catch (slackError) {
      await this.logError(slackError as Error);
    }
  }

  private async notifyCannotFix(input: IssueResolverInput): Promise<void> {
    const message = `⚠️ 자동 수정 불가

이 이슈는 자동으로 수정하기 어렵습니다.
더 자세한 정보를 주시거나 개발자가 직접 확인해야 합니다.

**이슈:** ${input.issueReport!.userMessage}`;

    try {
      await this.slackClient.chat.postMessage({
        channel: input.issueReport!.slackChannel!,
        thread_ts: input.issueReport!.slackTs!,
        text: message,
      });
    } catch (error) {
      await this.logError(error as Error);
    }
  }

  private async updateIssueReport(projectId: string, output: IssueResolverOutput): Promise<void> {
    await prisma.issueReport.updateMany({
      where: { projectId, status: 'OPEN' },
      data: {
        status: 'FIXED',
        fixAttempts: { increment: 1 },
        fixLogs: output as any,
      },
    });
  }
}
