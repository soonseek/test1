import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { prisma } from '@magic-wand/db';
import { Anthropic } from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface TesterInput {
  projectId: string;
  project: {
    name: string;
    description: string;
    wizardLevel: string;
  };
}

interface TestFailure {
  severity: 'high' | 'medium' | 'low';
  category: 'ui' | 'api' | 'database' | 'integration' | 'edge-case';
  testType: 'manual' | 'automated';
  scenario: string;
  expectedBehavior: string;
  actualBehavior: string;
  steps: string[];
  evidence?: string;
}

interface TesterOutput {
  currentPhase: 'testing' | 'completed';
  testResult: 'pass' | 'fail';
  overallScore: number; // 0-100
  failures: TestFailure[];
  successes: string[];
  testCoverage: {
    ui: number; // percentage
    api: number;
    database: number;
  };
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    highSeverityFailures: number;
  };
}

export class TesterAgent extends Agent {
  private anthropic: Anthropic;
  private projectRoot: string;

  constructor() {
    super({
      agentId: 'tester',
      name: 'Tester',
      role: 'UI, API, DB 테스트 및 pass/fail 평가',
      trigger: {
        type: 'event',
        event: 'code-review.passed',
      },
      completionMode: CompletionMode.AUTO_CLOSE,
      maxRetries: 3,
      timeout: 2400, // 40분
      dependencies: ['code-reviewer'],
      contextSharing: {
        sharesTo: ['scrum-master'],
        data: ['testResult', 'failures', 'testCoverage'],
      },
    });

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    this.projectRoot = process.cwd();
  }

  async execute(input: TesterInput): Promise<AgentExecutionResult> {
    await this.log('Tester 작업 시작', {
      projectId: input.projectId,
    });

    try {
      // 1. Code Review 결과 확인 (Pass인 경우만 테스트)
      const codeReviewerOutput = await this.getCodeReviewerOutput(input.projectId);

      if (!codeReviewerOutput) {
        throw new Error('Code Reviewer 실행 결과를 찾을 수 없습니다');
      }

      if (codeReviewerOutput.reviewResult === 'fail') {
        await this.log('코드 리뷰 실패로 테스트 스킵');
        return {
          status: AgentStatus.COMPLETED,
          output: {
            currentPhase: 'completed',
            testResult: 'fail',
            overallScore: 0,
            failures: [],
            successes: [],
            testCoverage: { ui: 0, api: 0, database: 0 },
            summary: {
              totalTests: 0,
              passedTests: 0,
              failedTests: 0,
              highSeverityFailures: 0,
            },
          } as TesterOutput,
        };
      }

      await this.log('코드 리뷰 Pass 확인, 테스트 시작');

      // 2. 현재 작업 정보 로드
      const developerOutput = await this.getDeveloperOutput(input.projectId);
      const currentTask = developerOutput?.currentTask;
      const story = await this.getStory(input.projectId, currentTask?.storyId);
      const scrumMasterOutput = await this.getScrumMasterOutput(input.projectId);

      // 3. 테스트 수행
      const testResult = await this.performTesting(
        developerOutput,
        story,
        scrumMasterOutput,
        input
      );

      await this.log('테스트 완료', {
        result: testResult.testResult,
        score: testResult.overallScore,
        failures: testResult.summary.failedTests,
      });

      return {
        status: AgentStatus.COMPLETED,
        output: testResult,
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

  private async getCodeReviewerOutput(projectId: string): Promise<any> {
    const execution = await prisma.agentExecution.findFirst({
      where: {
        projectId,
        agentId: 'code-reviewer',
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    return execution?.output;
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

  private async performTesting(
    developerOutput: any,
    story: any,
    scrumMasterOutput: any,
    input: TesterInput
  ): Promise<TesterOutput> {
    await this.updateProgress(input.projectId, {
      currentPhase: 'testing' as const,
      testResult: 'pass' as const,
      failures: [],
      testCoverage: { ui: 0, api: 0, database: 0 },
    });

    const failures: TestFailure[] = [];
    const successes: string[] = [];

    // 1. UI 테스트
    await this.log('UI 테스트 시작');
    const uiTestResults = await this.performUITesting(developerOutput, story, input);
    failures.push(...uiTestResults.failures);
    successes.push(...uiTestResults.successes);
    await this.log('UI 테스트 완료', {
      failures: uiTestResults.failures.length,
      successes: uiTestResults.successes.length,
    });

    // 2. API 테스트
    await this.log('API 테스트 시작');
    const apiTestResults = await this.performAPITesting(developerOutput, story, input);
    failures.push(...apiTestResults.failures);
    successes.push(...apiTestResults.successes);
    await this.log('API 테스트 완료', {
      failures: apiTestResults.failures.length,
      successes: apiTestResults.successes.length,
    });

    // 3. DB 테스트
    await this.log('DB 테스트 시작');
    const dbTestResults = await this.performDatabaseTesting(developerOutput, story, scrumMasterOutput, input);
    failures.push(...dbTestResults.failures);
    successes.push(...dbTestResults.successes);
    await this.log('DB 테스트 완료', {
      failures: dbTestResults.failures.length,
      successes: dbTestResults.successes.length,
    });

    // 테스트 커버리지 계산
    const totalTests = successes.length + failures.length;
    const testCoverage = {
      ui: uiTestResults.successes.length / Math.max(uiTestResults.successes.length + uiTestResults.failures.length, 1) * 100,
      api: apiTestResults.successes.length / Math.max(apiTestResults.successes.length + apiTestResults.failures.length, 1) * 100,
      database: dbTestResults.successes.length / Math.max(dbTestResults.successes.length + dbTestResults.failures.length, 1) * 100,
    };

    // 전체 점수 계산
    const overallScore = this.calculateOverallScore(failures, totalTests, testCoverage);

    // Pass/Fail 결정 (75점 이상이고 high severity failure가 없어야 함)
    const hasHighSeverity = failures.some(f => f.severity === 'high');
    const testResult: 'pass' | 'fail' = overallScore >= 75 && !hasHighSeverity ? 'pass' : 'fail';

    const output: TesterOutput = {
      currentPhase: 'completed',
      testResult,
      overallScore,
      failures,
      successes,
      testCoverage,
      summary: {
        totalTests,
        passedTests: successes.length,
        failedTests: failures.length,
        highSeverityFailures: failures.filter(f => f.severity === 'high').length,
      },
    };

    return output;
  }

  private async performUITesting(
    developerOutput: any,
    story: any,
    input: TesterInput
  ): Promise<{ failures: TestFailure[], successes: string[] }> {
    const prompt = this.buildUITestPrompt(developerOutput, story);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseTestResponse(text, 'ui');
    } catch (error: any) {
      await this.logError(error);
      return {
        failures: [{
          severity: 'high',
          category: 'ui',
          testType: 'manual',
          scenario: 'UI 테스트 실행',
          expectedBehavior: 'UI 테스트 성공',
          actualBehavior: '테스트 실행 실패',
          steps: ['UI 테스트를 시도함'],
          evidence: error.message,
        }],
        successes: [],
      };
    }
  }

  private async performAPITesting(
    developerOutput: any,
    story: any,
    input: TesterInput
  ): Promise<{ failures: TestFailure[], successes: string[] }> {
    const prompt = this.buildAPITestPrompt(developerOutput, story);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseTestResponse(text, 'api');
    } catch (error: any) {
      await this.logError(error);
      return {
        failures: [{
          severity: 'high',
          category: 'api',
          testType: 'automated',
          scenario: 'API 테스트 실행',
          expectedBehavior: 'API 테스트 성공',
          actualBehavior: '테스트 실행 실패',
          steps: ['API 테스트를 시도함'],
          evidence: error.message,
        }],
        successes: [],
      };
    }
  }

  private async performDatabaseTesting(
    developerOutput: any,
    story: any,
    scrumMasterOutput: any,
    input: TesterInput
  ): Promise<{ failures: TestFailure[], successes: string[] }> {
    const prompt = this.buildDatabaseTestPrompt(developerOutput, story, scrumMasterOutput);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseTestResponse(text, 'database');
    } catch (error: any) {
      await this.logError(error);
      return {
        failures: [{
          severity: 'high',
          category: 'database',
          testType: 'automated',
          scenario: 'DB 테스트 실행',
          expectedBehavior: 'DB 테스트 성공',
          actualBehavior: '테스트 실행 실패',
          steps: ['DB 테스트를 시도함'],
          evidence: error.message,
        }],
        successes: [],
      };
    }
  }

  private buildUITestPrompt(developerOutput: any, story: any): string {
    const generatedFiles = developerOutput.generatedFiles || [];

    return `# UI 테스트 요청

당신은 QA 엔지니어입니다. 생성된 UI 컴포넌트와 페이지를 테스트하세요.

## Story 정보

\`\`\`markdown
${story?.markdown || 'N/A'}
\`\`\`

## 생성된 UI 파일

${generatedFiles.map((f: any) => `- **${f.path}** (${f.type})`).join('\n')}

## 테스트 항목

### 1. 컴포넌트 렌더링
- 컴포넌트가 에러 없이 렌더링되는가?
- 필수 props가 올바르게 전달되는가?

### 2. UI/UX
- 디자인이 일관성 있는가?
- 반응형으로 동작하는가?
- 접근성(a11y)이 고려되었는가?

### 3. 인터랙션
- 버튼 클릭이 동작하는가?
- 폼 제출이 올바른가?
- 사용자 피드백이 제공되는가?

## 테스트 시나리오

Story의 인수 조건(Acceptance Criteria)을 기반으로 테스트 시나리오를 작성하고 예상 결과를 정의하세요.

## 출력 형식

\`\`\`markdown
## UI 테스트 결과

### 성공한 테스트

- [테스트 이름]: (설명)

### 실패한 테스트

#### [Severity] - [Category]

**테스트 유형**: manual 또는 automated
**시나리오**: (테스트 시나리오)
**예상 동작**: (예상 결과)
**실제 동작**: (실제 결과)
**재현 단계**:
1. (단계 1)
2. (단계 2)
3. (단계 3)
**증거**: (스크린샷 또는 로그)

Severity: HIGH, MEDIUM, LOW
Category: ui, integration, edge-case
\`\`\`
`;
  }

  private buildAPITestPrompt(developerOutput: any, story: any): string {
    return `# API 테스트 요청

당신은 API 테스터입니다. 생성된 API 엔드포인트를 테스트하세요.

## Story 정보

\`\`\`markdown
${story?.markdown || 'N/A'}
\`\`\`

## 테스트 항목

### 1. 엔드포인트 존재
- API route가 존재하는가?
- HTTP 메서드가 올바른가?

### 2. 요청/응답
- Request body 검증이 있는가?
- Response 형식이 올바른가?
- Status code가 적절한가?

### 3. 에러 처리
- 에러 상황을 처리하는가?
- 에러 메시지가 명확한가?

### 4. 보안
- 인증이 필요한 경우 확인하는가?
- SQL Injection 등 보안 이슈가 없는가?

## 출력 형식

\`\`\`markdown
## API 테스트 결과

### 성공한 테스트

- [테스트 이름]: (설명)

### 실패한 테스트

#### [Severity] - [Category]

**테스트 유형**: manual 또는 automated
**시나리오**: (테스트 시나리오)
**예상 동작**: (예상 결과)
**실제 동작**: (실제 결과)
**재현 단계**:
1. (단계 1)
2. (단계 2)
**증거**: (API 응답 또는 로그)

Severity: HIGH, MEDIUM, LOW
Category: api, integration, edge-case
\`\`\`
`;
  }

  private buildDatabaseTestPrompt(developerOutput: any, story: any, scrumMasterOutput: any): string {
    const currentEpic = scrumMasterOutput?.currentEpic;
    const currentStory = scrumMasterOutput?.currentStory;

    return `# Database 테스트 요청

당신은 DB 테스터입니다. 데이터베이스 스키마와 데이터 흐름을 테스트하세요.

## Epic/Story 컨텍스트

**Epic**: ${currentEpic?.title || 'N/A'}
**Story**: ${currentStory?.title || 'N/A'}

\`\`\`markdown
${story?.markdown || 'N/A'}
\`\`\`

## 테스트 항목

### 1. Prisma Schema
- 필요한 Model이 정의되었는가?
- 관계(Relation)가 올바른가?
- 필드 타입이 적절한가?

### 2. 데이터 조작
- CREATE: 데이터 생성이 올바른가?
- READ: 조회가 올바르게 동작하는가?
- UPDATE: 업데이트가 올바른가?
- DELETE: 삭제가 올바른가?

### 3. 데이터 무결성
- 제약 조건(Constraint)이 충족되는가?
- 중복 데이터가 방지되는가?
- 참조 무결성이 유지되는가?

## 출력 형식

\`\`\`markdown
## Database 테스트 결과

### 성공한 테스트

- [테스트 이름]: (설명)

### 실패한 테스트

#### [Severity] - [Category]

**테스트 유형**: manual 또는 automated
**시나리오**: (테스트 시나리오)
**예상 동작**: (예상 결과)
**실제 동작**: (실제 결과)
**재현 단계**:
1. (단계 1)
2. (단계 2)
**증거**: (DB 쿼리 결과 또는 로그)

Severity: HIGH, MEDIUM, LOW
Category: database, integration, edge-case
\`\`\`
`;
  }

  private parseTestResponse(text: string, category: 'ui' | 'api' | 'database'): { failures: TestFailure[], successes: string[] } {
    const failures: TestFailure[] = [];
    const successes: string[] = [];

    try {
      // 성공한 테스트 추출
      const successMatch = text.match(/### 성공한 테스트[\s\S]*?(?=### 실패한 테스트|$)/);
      if (successMatch) {
        const successItems = successMatch[0].match(/-\s*\*\*([^\*]+)\*\*:\s*([^\n]+)/g);
        if (successItems) {
          successItems.forEach(item => {
            const nameMatch = item.match(/\*\*([^\*]+)\*\*:/);
            if (nameMatch) {
              successes.push(`[${category.toUpperCase()}] ${nameMatch[1]}: ${item.substring(item.indexOf(':') + 1).trim()}`);
            }
          });
        }
      }

      // 실패한 테스트 추출
      const failureBlocks = text.match(/####\s*\[(HIGH|MEDIUM|LOW)\]\s*-\s*\w+[\s\S]*?(?=####|$)/g);
      if (failureBlocks) {
        for (const block of failureBlocks) {
          const severityMatch = block.match(/\[(HIGH|MEDIUM|LOW)\]/i);
          const scenarioMatch = block.match(/\*\*시나리오\*\*:\s*([^\n]+)/);
          const expectedMatch = block.match(/\*\*예상 동작\*\*:\s*([^\n]+)/);
          const actualMatch = block.match(/\*\*실제 동작\*\*:\s*([^\n]+)/);
          const evidenceMatch = block.match(/\*\*증거\*\*:\s*([^\n]+)/);

          const stepsMatch = block.match(/\*\*재현 단계\*\*:[\s\S]*?(?=\*\*|$)/);
          let steps: string[] = [];
          if (stepsMatch) {
            const stepItems = stepsMatch[0].match(/\d+\.\s*(.+)/g);
            if (stepItems) {
              steps = stepItems.map(s => s.replace(/^\d+\.\s*/, ''));
            }
          }

          if (severityMatch && scenarioMatch && expectedMatch && actualMatch) {
            failures.push({
              severity: severityMatch[1].toLowerCase() as 'high' | 'medium' | 'low',
              category: category as any,
              testType: 'manual',
              scenario: scenarioMatch[1].trim(),
              expectedBehavior: expectedMatch[1].trim(),
              actualBehavior: actualMatch[1].trim(),
              steps,
              evidence: evidenceMatch ? evidenceMatch[1].trim() : undefined,
            });
          }
        }
      }
    } catch (error: any) {
      console.error('[Tester] Failed to parse test response:', error);
    }

    return { failures, successes };
  }

  private calculateOverallScore(failures: TestFailure[], totalTests: number, testCoverage: { ui: number; api: number; database: number }): number {
    if (totalTests === 0) return 100;

    // 기본 점수: 테스트 커버리지 평균
    let score = (testCoverage.ui + testCoverage.api + testCoverage.database) / 3;

    // 실패별 감점
    for (const failure of failures) {
      switch (failure.severity) {
        case 'high':
          score -= 15;
          break;
        case 'medium':
          score -= 8;
          break;
        case 'low':
          score -= 3;
          break;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  private async updateProgress(projectId: string, progress: Partial<TesterOutput>): Promise<void> {
    try {
      const execution = await prisma.agentExecution.findFirst({
        where: {
          projectId,
          agentId: 'tester',
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
      console.error('[Tester] Failed to update progress:', error);
    }
  }

  private isRetryable(error: any): boolean {
    return error.message?.includes('timeout') ||
           error.message?.includes('rate limit') ||
           error.code === 'ECONNRESET';
  }
}
