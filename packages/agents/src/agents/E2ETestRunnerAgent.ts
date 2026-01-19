import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import { prisma } from '@magic-wand/db';

interface E2ETestRunnerInput {
  projectId: string;
  deployedUrl: string;
  testRequirements: any;
  complexityScore: number;
}

interface E2ETestRunnerOutput {
  testResults: {
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  failedTests: Array<{
    testName: string;
    errorMessage: string;
    stackTrace: string;
    screenshotUrl: string;
  }>;
  coverageReport: {
    lines: number;
    functions: number;
    branches: number;
    statements: number;
  };
}

export class E2ETestRunnerAgent extends Agent {
  constructor() {
    super({
      agentId: 'e2e-test-runner',
      name: 'E2E 테스트 실행기',
      role: '생성된 MVP에 대해 E2E 테스트 자동 생성 및 실행',
      trigger: {
        type: 'dependency_satisfied',
        dependencies: ['netlify-deployer'],
        condition: 'netlify_deployer.build_status == "ready"',
      },
      completionMode: CompletionMode.REQUIRES_REVIEW,
      maxRetries: 3,
      timeout: 900, // 15분
      dependencies: ['netlify-deployer'],
      contextSharing: {
        sharesTo: ['issue-resolver'],
        data: ['test_results', 'failed_tests', 'coverage_report'],
      },
    });
  }

  async execute(input: E2ETestRunnerInput): Promise<AgentExecutionResult> {
    await this.log('E2E 테스트 시작', { projectId: input.projectId, url: input.deployedUrl });

    const testDir = path.join(process.cwd(), 'e2e-tests', input.projectId);

    try {
      // 1. 테스트 스크립트 생성
      await this.generateTestScripts(testDir, input);

      // 2. 테스트 실행
      const testResults = await this.runTests(testDir, input.deployedUrl);

      // 3. 결과 분석
      const analysis = this.analyzeResults(testResults);

      const output: E2ETestRunnerOutput = {
        testResults: analysis.summary,
        failedTests: analysis.failedTests,
        coverageReport: analysis.coverage,
      };

      // 4. 데이터베이스에 저장
      await this.saveResults(input.projectId, output);

      await this.log('E2E 테스트 완료', {
        passed: output.testResults.passed,
        failed: output.testResults.failed,
      });

      // 실패가 있으면 requires_review
      if (output.testResults.failed > 0) {
        return {
          status: AgentStatus.COMPLETED,
          output,
          comments: [
            {
              type: 'warning',
              message: `${output.testResults.failed}개 테스트 실패. Issue Resolver가 필요할 수 있습니다.`,
              timestamp: new Date().toISOString(),
            },
          ],
        };
      }

      return {
        status: AgentStatus.COMPLETED,
        output,
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

  private async generateTestScripts(testDir: string, input: E2ETestRunnerInput): Promise<void> {
    await fs.ensureDir(testDir);

    // Playwright 설정
    const playwrightConfig = `
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: '${input.deployedUrl}',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
`;

    await fs.writeFile(path.join(testDir, 'playwright.config.ts'), playwrightConfig);

    // 기본 테스트
    const basicTest = `
import { test, expect } from '@playwright/test';

test.describe('Basic Smoke Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/./);
  });

  test('page is responsive', async ({ page }) => {
    await page.goto('/');
    const viewport = page.viewportSize();
    expect(viewport?.width).toBeGreaterThan(0);
  });

  test('no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');

    expect(errors).toHaveLength(0);
  });
});
`;

    const testsDir = path.join(testDir, 'tests');
    await fs.ensureDir(testsDir);
    await fs.writeFile(path.join(testsDir, 'smoke.spec.ts'), basicTest);

    // package.json
    const packageJson = {
      name: 'e2e-tests',
      scripts: {
        test: 'playwright test',
        'test:ui': 'playwright test --ui',
      },
      devDependencies: {
        '@playwright/test': '^1.40.0',
        '@types/node': '^20.0.0',
      },
    };

    await fs.writeJson(path.join(testDir, 'package.json'), packageJson);
  }

  private async runTests(testDir: string, deployedUrl: string): Promise<any> {
    try {
      // 의존성 설치
      await execa('npm', ['install'], { cwd: testDir, timeout: 120000 });

      // 테스트 실행
      const { stdout } = await execa('npm', ['test', '--reporter=json'], {
        cwd: testDir,
        timeout: 300000,
      });

      return JSON.parse(stdout);
    } catch (error: any) {
      // 테스트 실패도 결과로 반환
      if (error.stdout) {
        try {
          return JSON.parse(error.stdout);
        } catch (parseError) {
          // JSON 파싱 실패
        }
      }
      throw error;
    }
  }

  private analyzeResults(results: any): any {
    const summary = {
      totalTests: results.stats?.expected || 0,
      passed: results.stats?.passed || 0,
      failed: results.stats?.failed || 0,
      skipped: results.stats?.skipped || 0,
      duration: results.stats?.duration || 0,
    };

    const failedTests = (results.suites || [])
      .flatMap((suite: any) => suite.specs || [])
      .flatMap((spec: any) => spec.tests || [])
      .filter((test: any) => test.results?.[0]?.status === 'failed')
      .map((test: any) => ({
        testName: test.name,
        errorMessage: test.results?.[0]?.error || 'Unknown error',
        stackTrace: test.results?.[0]?.stack || '',
        screenshotUrl: test.results?.[0]?.screenshot || '',
      }));

    const coverageReport = {
      lines: 0,
      functions: 0,
      branches: 0,
      statements: 0,
    };

    return { summary, failedTests, coverageReport };
  }

  private async saveResults(projectId: string, output: E2ETestRunnerOutput): Promise<void> {
    await prisma.agentExecution.create({
      data: {
        projectId,
        agentId: this.getId(),
        agentName: this.getName(),
        status: 'COMPLETED',
        input: {},
        output: output as any,
      },
    });
  }
}
