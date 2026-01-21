import { getEventBus } from '@magic-wand/agent-framework';
import { prisma } from '@magic-wand/db';
import { RequirementAnalyzerAgent } from '@magic-wand/agents';
import { EpicStoryAgent } from '@magic-wand/agents';
import { ScrumMasterAgent } from '@magic-wand/agents';
import { DeveloperAgent } from '@magic-wand/agents';
import { FileGeneratorAgent } from '@magic-wand/agents';
import { CodeReviewerAgent } from '@magic-wand/agents';
import { TesterAgent } from '@magic-wand/agents';
import { PromptBuilderAgent } from '@magic-wand/agents';
import { CodeGeneratorAgent } from '@magic-wand/agents';
import { GitHubPusherAgent } from '@magic-wand/agents';
import { NetlifyDeployerAgent } from '@magic-wand/agents';
import { E2ETestRunnerAgent } from '@magic-wand/agents';
import { IssueResolverAgent } from '@magic-wand/agents';
import { DocumentParserAgent } from '@magic-wand/agents';
import { DatabaseInitializerAgent } from '@magic-wand/agents';

interface MagicStartEvent {
  projectId: string;
  project: {
    name: string;
    description: string;
    wizardLevel: string;
  };
  files: any[];
  survey: any;
}

export class MagicOrchestrator {
  private agents: Map<string, any>;
  private paused: Map<string, boolean>; // projectId -> paused state
  private activeDevelopmentLoops: Set<string>; // 현재 실행 중인 개발 루프

  constructor() {
    // 모든 Agent 초기화
    this.agents = new Map();
    this.paused = new Map(); // 일시정지 상태 초기화
    this.activeDevelopmentLoops = new Set(); // 활성 개발 루프 추적 초기화
    this.agents.set('requirement-analyzer', new RequirementAnalyzerAgent());
    this.agents.set('epic-story', new EpicStoryAgent());
    this.agents.set('scrum-master', new ScrumMasterAgent());
    this.agents.set('developer', new DeveloperAgent());
    this.agents.set('file-generator', new FileGeneratorAgent());
    this.agents.set('code-reviewer', new CodeReviewerAgent());
    this.agents.set('tester', new TesterAgent());
    this.agents.set('prompt-builder', new PromptBuilderAgent());
    this.agents.set('code-generator', new CodeGeneratorAgent());
    this.agents.set('github-pusher', new GitHubPusherAgent());
    this.agents.set('netlify-deployer', new NetlifyDeployerAgent());
    this.agents.set('e2e-test-runner', new E2ETestRunnerAgent());
    this.agents.set('issue-resolver', new IssueResolverAgent());
    this.agents.set('document-parser', new DocumentParserAgent());
    this.agents.set('database-initializer', new DatabaseInitializerAgent());
  }

  async start() {
    const eventBus = getEventBus();
    console.log('[Orchestrator] Starting orchestrator...');
    console.log('[Orchestrator] EventBus instance:', eventBus);
    console.log('[Orchestrator] Available agents:', Array.from(this.agents.keys()));

    // magic.start 이벤트 리스닝
    await eventBus.subscribe('magic.start', async (data: MagicStartEvent) => {
      console.log('[Orchestrator] ========== RECEIVED magic.start event ==========');
      console.log('[Orchestrator] Project:', data.project.name);
      console.log('[Orchestrator] Project ID:', data.projectId);
      console.log('[Orchestrator] Files:', data.files?.length || 0);
      console.log('[Orchestrator] Has survey:', !!data.survey);
      await this.runMagic(data);
      console.log('[Orchestrator] ========== runMagic completed ==========');
    });

    console.log('[Orchestrator] ✅ Subscribed to magic.start event');
    console.log('✅ Magic Orchestrator started and listening for magic.start events');
  }

  /**
   * 개발 일시정지
   */
  public async pauseDevelopment(projectId: string): Promise<void> {
    console.log(`[Orchestrator] ⏸️ Development paused for project ${projectId}`);
    this.paused.set(projectId, true);
    this.activeDevelopmentLoops.delete(projectId);  // 활성 루프에서 제거하여 UI가 일시정지 상태를 인식하게 함

    // 현재 실행 중인 AgentExecution 상태를 PAUSED로 업데이트
    const runningExecution = await prisma.agentExecution.findFirst({
      where: {
        projectId,
        status: 'RUNNING',
      },
      orderBy: { startedAt: 'desc' },
    });

    if (runningExecution) {
      await prisma.agentExecution.update({
        where: { id: runningExecution.id },
        data: { status: 'PAUSED' },
      });
      console.log(`[Orchestrator] ✅ Updated agent execution ${runningExecution.id} to PAUSED`);
    }
  }

  /**
   * 개발 재개
   */
  public resumeDevelopment(projectId: string): void {
    console.log(`[Orchestrator] ▶️ Development resumed for project ${projectId}`);
    this.paused.set(projectId, false);
  }

  /**
   * 개발 초기화 (처음부터 다시)
   * 요구사항 분석, Epic & Story는 유지하고 개발 관련 에이전트만 삭제
   */
  public async resetDevelopment(projectId: string): Promise<void> {
    console.log(`[Orchestrator] 🔄 Resetting development for project ${projectId}`);

    try {
      // 활성 개발 루프에서 제거
      this.activeDevelopmentLoops.delete(projectId);
      this.paused.delete(projectId);

      // 개발 관련 AgentExecution 삭제 (요구사항 분석, Epic & Story 제외)
      const deletedExecutions = await prisma.agentExecution.deleteMany({
        where: {
          projectId,
          agentId: {
            in: ['scrum-master', 'developer', 'file-generator', 'code-reviewer', 'tester'],
          },
        },
      });

      console.log(`[Orchestrator] ✅ Deleted ${deletedExecutions.count} development-related executions`);

      console.log(`[Orchestrator] ✅ Development reset completed for ${projectId}`);
      console.log(`[Orchestrator] 📋 Preserved: requirement-analyzer, epic-story executions`);
    } catch (error) {
      console.error(`[Orchestrator] ❌ Error resetting development:`, error);
      throw error;
    }
  }

  /**
   * 일시정지 상태 확인
   */
  public isPaused(projectId: string): boolean {
    return this.paused.get(projectId) || false;
  }

  /**
   * 개발 루프 활성 상태 확인
   */
  public isDevelopmentActive(projectId: string): boolean {
    return this.activeDevelopmentLoops.has(projectId);
  }

  /**
   * 일시정지 대기 (일시정지 상태가 풀릴 때까지 대기)
   */
  private async waitForResume(projectId: string): Promise<void> {
    while (this.isPaused(projectId)) {
      console.log(`[Orchestrator] ⏸️ Development is paused for project ${projectId}, waiting...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log(`[Orchestrator] ▶️ Development resumed for project ${projectId}`);
  }

  public async runMagic(data: MagicStartEvent) {
    const { projectId, project, files, survey } = data;
    console.log('[Orchestrator] ========== runMagic START ==========');
    console.log('[Orchestrator] Project ID:', projectId);
    console.log('[Orchestrator] Project name:', project.name);

    let selectedPRD: any = null;
    let epicStoryOutput: any = null;
    let scrumMasterOutput: any = null;
    let developerOutput: any = null;
    let codeReviewOutput: any = null;
    let testerOutput: any = null;
    let promptBuilderOutput: any = null;
    let codeGeneratorOutput: any = null;
    let githubPusherOutput: any = null;
    let netlifyDeployerOutput: any = null;

    try {
      // 1. Deployment 레코드 생성
      console.log('[Orchestrator] Creating deployment record...');
      const deployment = await prisma.deployment.create({
        data: {
          projectId,
          status: 'PENDING',
          githubRepoUrl: '', // Will be updated by GitHubPusherAgent
          githubBranch: 'main',
        },
      });
      console.log('[Orchestrator] Deployment record created:', deployment.id);

      // ============================================================
      // PHASE 1: 분석 및 설계 (Analysis & Design)
      // ============================================================

      // 1.1 RequirementAnalyzerAgent - PRD 생성 (3개 옵션)
      console.log('[Orchestrator] Phase 1.1: Starting RequirementAnalyzerAgent...');
      const requirementResult = await this.runAgent('requirement-analyzer', projectId, {
        projectId,
        project,
        files,
        survey,
      });
      if (requirementResult.status !== 'COMPLETED') {
        throw new Error('Requirement analysis failed');
      }
      console.log('[Orchestrator] ✅ RequirementAnalyzerAgent completed');

      // 기본 PRD 선택 (표준형: index 1)
      const prdOptions = (requirementResult.output as any).prdOptions;
      selectedPRD = prdOptions[1]; // 표준형 선택
      console.log('[Orchestrator] Selected PRD:', selectedPRD.id);

      // 1.2 EpicStoryAgent - Epic & Story 생성
      console.log('[Orchestrator] Phase 1.2: Starting EpicStoryAgent...');
      const epicStoryResult = await this.runAgent('epic-story', projectId, {
        projectId,
        project,
        files,
        survey,
        selectedPRD,
      });
      if (epicStoryResult.status !== 'COMPLETED') {
        throw new Error('Epic & Story creation failed');
      }
      epicStoryOutput = epicStoryResult.output;
      console.log('[Orchestrator] ✅ EpicStoryAgent completed');
      console.log('[Orchestrator] Epics created:', epicStoryOutput.epics?.length);
      console.log('[Orchestrator] Stories created:', epicStoryOutput.stories?.length);

      // 1.3 ScrumMasterAgent - Task 관리
      console.log('[Orchestrator] Phase 1.3: Starting ScrumMasterAgent...');
      const scrumMasterResult = await this.runAgent('scrum-master', projectId, {
        projectId,
        project,
        epicStory: epicStoryOutput,
        selectedPRD,
      });
      if (scrumMasterResult.status !== 'COMPLETED') {
        throw new Error('Scrum Master task management failed');
      }
      scrumMasterOutput = scrumMasterResult.output;
      console.log('[Orchestrator] ✅ ScrumMasterAgent completed');

      // 1.4 DocumentParserAgent - 문서 파싱 (병렬 실행 가능)
      if (files && files.length > 0) {
        console.log('[Orchestrator] Phase 1.4: Starting DocumentParserAgent...');
        const documentParserResult = await this.runAgent('document-parser', projectId, {
          projectId,
          files,
        });
        console.log('[Orchestrator] ✅ DocumentParserAgent completed');
      }

      // ============================================================
      // PHASE 2: 개발 (Development)
      // ============================================================

      // 2.1 DeveloperAgent - 코드 개발
      console.log('[Orchestrator] Phase 2.1: Starting DeveloperAgent...');
      const developerResult = await this.runAgent('developer', projectId, {
        projectId,
        project,
        epicStory: epicStoryOutput,
        scrumMaster: scrumMasterOutput,
        selectedPRD,
      });
      if (developerResult.status !== 'COMPLETED') {
        throw new Error('Development failed');
      }
      developerOutput = developerResult.output;
      console.log('[Orchestrator] ✅ DeveloperAgent completed');
      console.log('[Orchestrator] Files generated:', developerOutput.generatedFiles?.length);

      // 2.2 CodeReviewerAgent - 코드 리뷰
      console.log('[Orchestrator] Phase 2.2: Starting CodeReviewerAgent...');
      const codeReviewResult = await this.runAgent('code-reviewer', projectId, {
        projectId,
        developerOutput,
      });
      if (codeReviewResult.status !== 'COMPLETED') {
        throw new Error('Code review failed');
      }
      codeReviewOutput = codeReviewResult.output;
      console.log('[Orchestrator] ✅ CodeReviewerAgent completed');

      // 2.3 TesterAgent - 테스트
      console.log('[Orchestrator] Phase 2.3: Starting TesterAgent...');
      const testerResult = await this.runAgent('tester', projectId, {
        projectId,
        developerOutput,
        codeReviewOutput,
      });
      if (testerResult.status !== 'COMPLETED') {
        throw new Error('Testing failed');
      }
      testerOutput = testerResult.output;
      console.log('[Orchestrator] ✅ TesterAgent completed');

      // ============================================================
      // PHASE 3: 빌드 및 배포 (Build & Deploy)
      // ============================================================

      // 3.1 PromptBuilderAgent - 프롬프트 빌딩
      console.log('[Orchestrator] Phase 3.1: Starting PromptBuilderAgent...');
      const promptBuilderResult = await this.runAgent('prompt-builder', projectId, {
        projectId,
        project,
        requirementOutput: requirementResult.output,
        epicStory: epicStoryOutput,
        developerOutput,
      });
      if (promptBuilderResult.status !== 'COMPLETED') {
        throw new Error('Prompt building failed');
      }
      promptBuilderOutput = promptBuilderResult.output;
      console.log('[Orchestrator] ✅ PromptBuilderAgent completed');

      // 3.2 CodeGeneratorAgent - 코드 생성
      console.log('[Orchestrator] Phase 3.2: Starting CodeGeneratorAgent...');
      const codeGeneratorResult = await this.runAgent('code-generator', projectId, {
        projectId,
        promptBuilder: promptBuilderOutput,
        developerOutput,
      });
      if (codeGeneratorResult.status !== 'COMPLETED') {
        throw new Error('Code generation failed');
      }
      codeGeneratorOutput = codeGeneratorResult.output;
      console.log('[Orchestrator] ✅ CodeGeneratorAgent completed');

      // 3.3 GitHubPusherAgent - GitHub 푸시
      console.log('[Orchestrator] Phase 3.3: Starting GitHubPusherAgent...');
      const githubPusherResult = await this.runAgent('github-pusher', projectId, {
        projectId,
        codeDirectory: process.cwd(), // 프로젝트 루트 디렉토리
        githubRepoUrl: '', // 사용자 입력으로 받아야 함
        githubPat: process.env.GITHUB_PAT,
        commitMessage: `feat: initial MVP generated by MAGIC WAND 🪄\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>`,
      });
      if (githubPusherResult.status !== 'COMPLETED') {
        console.log('[Orchestrator] ⚠️ GitHubPusherAgent skipped (GitHub repo not configured)');
      } else {
        githubPusherOutput = githubPusherResult.output;
        console.log('[Orchestrator] ✅ GitHubPusherAgent completed');
      }

      // 3.4 NetlifyDeployerAgent - Netlify 배포
      if (githubPusherOutput) {
        console.log('[Orchestrator] Phase 3.4: Starting NetlifyDeployerAgent...');
        const netlifyDeployerResult = await this.runAgent('netlify-deployer', projectId, {
          projectId,
          githubRepoUrl: githubPusherOutput.repoUrl,
          githubBranch: 'main',
          subdomain: `${project.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`,
          netlifyAuthToken: process.env.NETLIFY_AUTH_TOKEN,
        });
        if (netlifyDeployerResult.status !== 'COMPLETED') {
          console.log('[Orchestrator] ⚠️ NetlifyDeployerAgent failed');
        } else {
          netlifyDeployerOutput = netlifyDeployerResult.output;
          console.log('[Orchestrator] ✅ NetlifyDeployerAgent completed');
        }
      }

      // ============================================================
      // PHASE 4: 테스트 및 유지보수 (Test & Maintenance)
      // ============================================================

      // 4.1 E2ETestRunnerAgent - E2E 테스트
      if (netlifyDeployerOutput) {
        console.log('[Orchestrator] Phase 4.1: Starting E2ETestRunnerAgent...');
        const e2eTestResult = await this.runAgent('e2e-test-runner', projectId, {
          projectId,
          deploymentUrl: netlifyDeployerOutput.deploymentUrl,
        });
        if (e2eTestResult.status !== 'COMPLETED') {
          console.log('[Orchestrator] ⚠️ E2ETestRunnerAgent failed');
        } else {
          console.log('[Orchestrator] ✅ E2ETestRunnerAgent completed');
        }
      }

      // ============================================================
      // 완료
      // ============================================================

      console.log(`[Orchestrator] ✅✅✅ ALL AGENTS COMPLETED for project: ${projectId}`);

      // Deployment 상태 업데이트
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: 'DEPLOYED',
          githubRepoUrl: githubPusherOutput?.repoUrl || '',
          logs: {
            completedAt: new Date().toISOString(),
            summary: {
              totalAgents: 13,
              completedAgents: 13,
              deploymentUrl: netlifyDeployerOutput?.deploymentUrl || null,
            },
          } as any,
        },
      });

    } catch (error: any) {
      console.error(`[Orchestrator] ❌ Magic orchestration failed for project ${projectId}:`, error);
      console.error('[Orchestrator] Error stack:', error.stack);

      // 실패 기록
      try {
        await prisma.deployment.update({
          where: { projectId },
          data: {
            status: 'FAILED',
            logs: {
              error: error.message,
              stack: error.stack,
              timestamp: new Date().toISOString(),
            } as any,
          },
        });
      } catch (updateError) {
        console.error('[Orchestrator] Failed to update deployment:', updateError);
      }

      // IssueResolverAgent 트리거 (선택사항)
      console.log('[Orchestrator] Triggering IssueResolverAgent...');
      try {
        await this.runAgent('issue-resolver', projectId, {
          projectId,
          error: {
            message: error.message,
            stack: error.stack,
          },
          context: {
            phase: 'magic-orchestration',
            lastCompletedAgent: 'unknown', // TODO: 추적 필요
          },
        });
      } catch (resolverError) {
        console.error('[Orchestrator] IssueResolverAgent also failed:', resolverError);
      }

      throw error; // Re-throw to let caller know
    }

    console.log('[Orchestrator] ========== runMagic END ==========');
  }

  public async runAgent(agentId: string, projectId: string, input: any) {
    console.log(`[Orchestrator] ========== runAgent START: ${agentId} ==========`);

    const agent = this.agents.get(agentId);
    if (!agent) {
      console.error(`[Orchestrator] Agent not found: ${agentId}`);
      console.error('[Orchestrator] Available agents:', Array.from(this.agents.keys()));
      throw new Error(`Agent not found: ${agentId}`);
    }

    console.log(`[Orchestrator] Found agent: ${agentId}`);
    console.log(`[Orchestrator] Agent name:`, agent.getName());

    // Agent 실행 시작 기록
    console.log('[Orchestrator] Creating agent execution record...');
    const execution = await prisma.agentExecution.create({
      data: {
        projectId,
        agentId,
        agentName: agent.getName(),
        status: 'RUNNING',
        input: input as any,
      },
    });

    console.log(`[Orchestrator] Agent execution record created: ${execution.id}`);

    // executionId를 input에 추가 (Agent가 자신의 execution ID를 알 수 있도록)
    const inputWithExecutionId = {
      ...input,
      executionId: execution.id,
    };

    try {
      // Agent 실행
      console.log(`[Orchestrator] About to execute agent ${agentId}...`);
      console.log(`[Orchestrator] Agent input type:`, typeof input);
      console.log(`[Orchestrator] Agent has execute method:`, typeof agent.execute);

      const result = await agent.execute(inputWithExecutionId);

      console.log(`[Orchestrator] Agent ${agentId} execution completed`);
      console.log(`[Orchestrator] Agent result status:`, result.status);
      console.log(`[Orchestrator] Agent has output:`, !!result.output);

      // 결과 업데이트
      console.log('[Orchestrator] Updating agent execution record...');
      await prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: result.status,
          output: result.output as any,
          error: result.error as any,
          completedAt: new Date(),
        },
      });

      console.log(`[Orchestrator] ✅ Agent completed: ${agentId} - ${result.status}`);

      console.log(`[Orchestrator] ========== runAgent END: ${agentId} ==========`);
      return result;
    } catch (error: any) {
      console.error(`[Orchestrator] Agent ${agentId} failed:`, error);
      console.error(`[Orchestrator] Error message:`, error.message);
      console.error(`[Orchestrator] Error stack:`, error.stack);

      // 실패 기록
      try {
        await prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: 'FAILED',
            error: {
              message: error.message,
              stackTrace: error.stack,
            } as any,
            completedAt: new Date(),
          },
        });
      } catch (updateError) {
        console.error('[Orchestrator] Failed to update agent execution:', updateError);
      }

      console.log(`[Orchestrator] ========== runAgent FAILED: ${agentId} ==========`);
      throw error;
    }
  }

  /**
   * 개발 단계 실행 (Scrum Master → Developer → Code Reviewer → Tester)
   */
  public async runDevelopmentPhase(projectId: string) {
    console.log('[Orchestrator] ========== Starting Development Phase ==========');

    try {
      // 1. 프로젝트 정보 조회
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          sessionFiles: true,
          surveyAnswer: true,
          agentExecutions: {
            orderBy: { startedAt: 'desc' },
          },
        },
      });

      if (!project) {
        throw new Error('Project not found');
      }

      // 2. Epic & Story 결과 가져오기
      const epicStoryExecution = project.agentExecutions.find(
        (e: any) => e.agentId === 'epic-story' && e.status === 'COMPLETED'
      );

      if (!epicStoryExecution) {
        throw new Error('Epic & Story가 완료되지 않았습니다');
      }

      const epicStoryOutput = epicStoryExecution.output;
      console.log('[Orchestrator] Found Epic & Story output');

      // 3. PRD 가져오기
      const requirementExecution = project.agentExecutions.find(
        (e: any) => e.agentId === 'requirement-analyzer' && e.status === 'COMPLETED'
      );

      if (!requirementExecution) {
        throw new Error('PRD가 완료되지 않았습니다');
      }

      const selectedPRD = (requirementExecution.output as any).prdOptions?.[1];
      console.log('[Orchestrator] Found PRD');

      // 4. Scrum Master 실행 (이미 완료된 경우 스킵)
      let scrumMasterOutput = null;
      const scrumMasterExecution = project.agentExecutions.find(
        (e: any) => e.agentId === 'scrum-master' && e.status === 'COMPLETED'
      );

      if (scrumMasterExecution) {
        console.log('[Orchestrator] Scrum Master already completed, skipping...');
        scrumMasterOutput = scrumMasterExecution.output;
      } else {
        console.log('[Orchestrator] Phase 1: Running Scrum Master...');
        const scrumMasterResult = await this.runAgent('scrum-master', projectId, {
          projectId,
          project: {
            name: project.name,
            description: project.description,
            wizardLevel: project.wizardLevel,
          },
          epicStory: epicStoryOutput,
          selectedPRD,
        });

        if (scrumMasterResult.status !== 'COMPLETED') {
          throw new Error('Scrum Master execution failed');
        }

        scrumMasterOutput = scrumMasterResult.output;
        console.log('[Orchestrator] ✅ Scrum Master completed');
      }

      // 5. 전체 개발 및 테스트 워크플로우 실행
      console.log('[Orchestrator] Phase 2: Running complete development & test workflow...');

      const workflowResult = await this.runCompleteDevelopmentWorkflow({
        projectId,
        project,
        epicStoryOutput,
        selectedPRD,
        scrumMasterOutput,
      });

      console.log('[Orchestrator] ✅✅✅ Development Phase completed');
      return workflowResult;
    } catch (error: any) {
      console.error('[Orchestrator] ❌ Development Phase failed:', error);
      throw error;
    }
  }

  /**
   * 전체 개발 및 테스트 워크플로우 실행
   *
   * 워크플로우:
   * 1. 각 Task에 대해 Developer → Code Reviewer → Tester 순환
   * 2. Epic 완료 시 Epic 단위 테스트
   * 3. 모든 Epic 완료 시 통합 테스트
   * 4. Fail 시 대응 Task 생성 및 재시도
   */
  private async runCompleteDevelopmentWorkflow(params: {
    projectId: string;
    project: any;
    epicStoryOutput: any;
    selectedPRD: any;
    scrumMasterOutput: any;
  }): Promise<any> {
    const { projectId, project, epicStoryOutput, selectedPRD, scrumMasterOutput } = params;

    const totalEpics = epicStoryOutput.epics?.length || 0;
    let currentEpicOrder = 1;

    // Epic 루프
    while (currentEpicOrder <= totalEpics) {
      console.log(`[Orchestrator] 📚 Epic ${currentEpicOrder}/${totalEpics} 시작`);

      // Epic 내 모든 Story 개발 완료될 때까지 루프
      let epicCompleted = false;
      let epicRetryCount = 0;
      const maxEpicRetries = 5;

      while (!epicCompleted && epicRetryCount < maxEpicRetries) {
        // Step 1: Developer → Code Reviewer → Tester 순환 루프
        const devResult = await this.runDevelopmentLoop({
          projectId,
          project,
          epicStoryOutput,
          selectedPRD,
          currentEpicOrder,
        });

        if (!devResult.success) {
          console.log('[Orchestrator] ❌ Development loop failed');
          throw new Error('Development loop failed');
        }

        // Step 2: Epic 단위 테스트
        console.log(`[Orchestrator] 🧪 Epic ${currentEpicOrder} 단위 테스트 시작`);
        const epicTestResult = await this.runEpicTest({
          projectId,
          project,
          epicStoryOutput,
          currentEpicOrder,
        });

        if (epicTestResult.pass) {
          console.log(`[Orchestrator] ✅ Epic ${currentEpicOrder} 단위 테스트 PASS`);
          epicCompleted = true;
        } else {
          console.log(`[Orchestrator] ❌ Epic ${currentEpicOrder} 단위 테스트 FAIL`);
          console.log(`[Orchestrator] 실패 사유: ${epicTestResult.reason}`);

          // Scrum Master가 대응 Task 생성
          await this.generateFixTasks({
            projectId,
            project,
            epicStoryOutput,
            selectedPRD,
            testResult: epicTestResult,
            testType: 'epic',
            epicOrder: currentEpicOrder,
          });

          epicRetryCount++;
          console.log(`[Orchestrator] Epic ${currentEpicOrder} 재시도 ${epicRetryCount}/${maxEpicRetries}`);

          if (epicRetryCount >= maxEpicRetries) {
            throw new Error(`Epic ${currentEpicOrder} 단위 테스트 ${maxEpicRetries}회 실패로 중단`);
          }

          // 잠시 대기 후 재시도
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      currentEpicOrder++;
    }

    // 모든 Epic 완료 후 통합 테스트
    console.log('[Orchestrator] 🧪 모든 Epic 완료. 통합 테스트 시작');
    let integrationTestPassed = false;
    let integrationRetryCount = 0;
    const maxIntegrationRetries = 5;

    while (!integrationTestPassed && integrationRetryCount < maxIntegrationRetries) {
      const integrationTestResult = await this.runIntegrationTest({
        projectId,
        project,
        epicStoryOutput,
      });

      if (integrationTestResult.pass) {
        console.log('[Orchestrator] ✅ 통합 테스트 PASS');
        integrationTestPassed = true;
      } else {
        console.log('[Orchestrator] ❌ 통합 테스트 FAIL');
        console.log(`[Orchestrator] 실패 사유: ${integrationTestResult.reason}`);

        // Scrum Master가 대응 Task 생성
        await this.generateFixTasks({
          projectId,
          project,
          epicStoryOutput,
          selectedPRD,
          testResult: integrationTestResult,
          testType: 'integration',
        });

        integrationRetryCount++;
        console.log(`[Orchestrator] 통합 테스트 재시도 ${integrationRetryCount}/${maxIntegrationRetries}`);

        if (integrationRetryCount >= maxIntegrationRetries) {
          throw new Error(`통합 테스트 ${maxIntegrationRetries}회 실패로 중단`);
        }

        // 대응 Task 개발
        await this.runDevelopmentLoop({
          projectId,
          project,
          epicStoryOutput,
          selectedPRD,
          currentEpicOrder: -1, // -1 = 모든 Epic 대상
        });

        // 잠시 대기 후 재시도
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    console.log('[Orchestrator] 🎉 모든 개발 및 테스트 완료!');
    return {
      status: 'COMPLETED',
      phase: 'all-complete',
    };
  }

  /**
   * Developer → Code Reviewer → Tester 순환 루프
   * 현재 Epic의 모든 Task가 완료될 때까지 실행
   */
  public async runDevelopmentLoop(params: {
    projectId: string;
    project: any;
    epicStoryOutput: any;
    selectedPRD: any;
    currentEpicOrder: number;
    failureContexts?: any[]; // 실패 컨텍스트 (재시도 시)
  }): Promise<{ success: boolean; tasksCompleted: number }> {
    const { projectId, project, epicStoryOutput, selectedPRD, currentEpicOrder, failureContexts } = params;

    // 활성 개발 루프로 등록
    this.activeDevelopmentLoops.add(projectId);
    console.log(`[Orchestrator] 🔄 Development loop started for ${projectId}, active loops: ${this.activeDevelopmentLoops.size}`);
    if (failureContexts && failureContexts.length > 0) {
      console.log(`[Orchestrator] 📋 Failure contexts provided for ${failureContexts.length} tasks`);
    }

    try {
      let tasksCompleted = 0;
      let maxIterations = 100; // 무한 루프 방지
      let iteration = 0;

      // 작업별 재시도 횟수 추적
      const taskRetryCount = new Map<string, number>();
      const MAX_TASK_RETRIES = 3;

      // 실패 컨텍스트를 맵으로 변환 (taskId -> failureContext)
      const failureContextMap = new Map<string, any>();
      if (failureContexts) {
        for (const fc of failureContexts) {
          failureContextMap.set(fc.taskId, fc);
        }
      }

      while (iteration < maxIterations) {
      iteration++;

      // 일시정지 상태 확인 및 대기
      await this.waitForResume(projectId);

      // Scrum Master 실행 결과 로드
      const scrumMasterExec = await prisma.agentExecution.findFirst({
        where: { projectId, agentId: 'scrum-master' },
        orderBy: { startedAt: 'desc' },
      });

      if (!scrumMasterExec || !scrumMasterExec.output) {
        throw new Error('Scrum Master 결과를 찾을 수 없습니다');
      }

      const scrumMasterOutput = scrumMasterExec.output as any;

      // 실패한 Task 확인 -> 개발 루프 중단
      const failedTasks = scrumMasterOutput.tasks?.filter((t: any) => t.status === 'failed') || [];
      if (failedTasks.length > 0) {
        console.log(`[Orchestrator] ❌ Story 개발 실패: ${failedTasks.length}개의 Task가 실패하여 개발 루프를 중단합니다.`);
        console.log(`[Orchestrator] 실패한 Task:`, failedTasks.map((t: any) => t.title));

        // 활성 개발 루프에서 제거
        this.activeDevelopmentLoops.delete(projectId);

        return {
          success: false,
          tasksCompleted,
        };
      }

      // 현재 Epic의 pending Task 찾기 (currentEpicOrder가 -1이면 모든 Epic)
      const pendingTasks = scrumMasterOutput.tasks?.filter((t: any) => {
        if (t.status !== 'pending') return false;
        if (currentEpicOrder === -1) return true; // 모든 Epic 대상
        return t.epicOrder === currentEpicOrder;
      }) || [];

      // 완료된 Task 확인
      const completedTasks = scrumMasterOutput.tasks?.filter((t: any) => {
        if (t.status !== 'completed') return false;
        if (currentEpicOrder === -1) return true;
        return t.epicOrder === currentEpicOrder;
      }) || [];

      // 모든 Task가 완료된 경우 - 다음 Story로 넘어가기 위해 Scrum Master 재실행
      if (pendingTasks.length === 0) {
        console.log(`[Orchestrator] ✅ All ${completedTasks.length} tasks completed for Epic ${currentEpicOrder}`);

        if (completedTasks.length > 0) {
          // 다음 Story의 Task List를 생성하기 위해 Scrum Master 재실행
          console.log('[Orchestrator] 다음 Story의 Task List를 생성하기 위해 Scrum Master 재실행...');

          const scrumMasterResult = await this.runAgent('scrum-master', projectId, {
            projectId,
            project: {
              name: project.name,
              description: project.description,
              wizardLevel: project.wizardLevel,
            },
            epicStory: epicStoryOutput,
            selectedPRD,
          });

          if (scrumMasterResult.status !== 'COMPLETED') {
            console.error('[Orchestrator] ❌ Scrum Master 재실행 실패');
            this.activeDevelopmentLoops.delete(projectId);
            console.log(`[Orchestrator] 🔄 Development loop completed for ${projectId}, remaining active loops: ${this.activeDevelopmentLoops.size}`);
            return { success: false, tasksCompleted: completedTasks.length };
          }

          const newScrumMasterOutput = scrumMasterResult.output as any;
          const newTasks = newScrumMasterOutput.tasks || [];

          // 새로운 pending Task가 있는지 확인
          const newPendingTasks = newTasks.filter((t: any) => t.status === 'pending');

          if (newPendingTasks.length === 0) {
            // 진짜로 모든 Story/Epic 완료
            console.log('[Orchestrator] 🎉 모든 Story/Epic 완료!');
            this.activeDevelopmentLoops.delete(projectId);
            console.log(`[Orchestrator] 🔄 Development loop completed for ${projectId}, remaining active loops: ${this.activeDevelopmentLoops.size}`);
            return { success: true, tasksCompleted: completedTasks.length };
          }

          console.log(`[Orchestrator] ✅ 다음 Story의 Task List 생성됨: ${newPendingTasks.length} tasks`);
          // 다음 iteration에서 새로운 Task들을 처리함
          continue;
        } else {
          // Task가 없는 경우 (최초 시작)
          console.log('[Orchestrator] ⚠️ Task가 없습니다. Scrum Master를 먼저 실행해주세요.');
          this.activeDevelopmentLoops.delete(projectId);
          console.log(`[Orchestrator] 🔄 Development loop completed for ${projectId}, remaining active loops: ${this.activeDevelopmentLoops.size}`);
          return { success: true, tasksCompleted: 0 };
        }
      }

      console.log(`[Orchestrator] Iteration ${iteration}: ${pendingTasks.length} pending tasks (Epic ${currentEpicOrder})`);

      // 첫 번째 pending Task 실행
      const task = pendingTasks[0];
      const retryCount = taskRetryCount.get(task.id) || 0;

      // 최대 재시도 횟수 초과 확인
      if (retryCount >= MAX_TASK_RETRIES) {
        console.error(`[Orchestrator] ❌ Task ${task.id} 최대 재시도 횟수(${MAX_TASK_RETRIES}) 초과로 영구 실패 처리`);
        await this.updateTaskStatus(projectId, task.id, 'failed');
        continue;
      }

      // Developer 실행
      console.log(`[Orchestrator] 📝 Developer: Task ${task.id} - ${task.title} (시도 ${retryCount + 1}/${MAX_TASK_RETRIES + 1})`);

      // 실패 컨텍스트 확인 (Ralph 방식)
      const taskFailureContext = failureContextMap.get(task.id) || task.lastFailure;
      if (taskFailureContext) {
        console.log(`[Orchestrator] 📋 Failure context found for task ${task.id}:`);
        console.log(`[Orchestrator]   - Errors: ${taskFailureContext.errors?.length || 0}`);
        taskFailureContext.errors?.forEach((err: any, idx: number) => {
          console.log(`[Orchestrator]   [${idx}] ${err.agentName}: ${err.error?.message || 'Unknown error'}`);
        });
      }

      let developerResult;
      try {
        developerResult = await this.runAgent('developer', projectId, {
          projectId,
          project: {
            name: project.name,
            description: project.description,
            wizardLevel: project.wizardLevel,
          },
          epicStory: epicStoryOutput,
          scrumMaster: scrumMasterOutput,
          selectedPRD,
          failureContext: taskFailureContext, // 실패 컨텍스트 전달
        });
      } catch (error: any) {
        console.log(`[Orchestrator] ⚠️ Developer 실패: ${error.message}`);
        console.log('[Orchestrator] 🔄 Task를 다시 시도를 위해 pending 상태로 유지');
        taskRetryCount.set(task.id, retryCount + 1);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      if (developerResult.status !== 'COMPLETED') {
        console.log('[Orchestrator] ⚠️ Developer 상태가 COMPLETED가 아님, 다음 Task로 이동');
        taskRetryCount.set(task.id, retryCount + 1);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      // Developer 성공 시 재시도 횟수 초기화
      taskRetryCount.delete(task.id);

      const developerOutput = developerResult.output as any;

      // 2단계: FileGeneratorAgent로 실제 코드 생성
      console.log(`[Orchestrator] 📝 File Generator: Task ${task.id}, specs: ${developerOutput.codeSpecifications?.length || 0}`);

      let fileGeneratorResult;
      try {
        fileGeneratorResult = await this.runAgent('file-generator', projectId, {
          projectId,
          project: {
            name: project.name,
            description: project.description,
          },
          task: {
            id: task.id,
            title: task.title,
            description: task.description,
          },
          codeSpecifications: developerOutput.codeSpecifications || [],
          prd: selectedPRD,
          story: epicStoryOutput,
        });
      } catch (error: any) {
        console.log(`[Orchestrator] ⚠️ File Generator 실패: ${error.message}`);
        console.log('[Orchestrator] 🔄 Task를 다시 시도를 위해 pending 상태로 유지');
        taskRetryCount.set(task.id, retryCount + 1);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      if (fileGeneratorResult.status !== 'COMPLETED') {
        console.log('[Orchestrator] ⚠️ File Generator 상태가 COMPLETED가 아님, 다음 Task로 이동');
        taskRetryCount.set(task.id, retryCount + 1);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      // FileGenerator의 결과를 developerOutput에 병합
      const fileGenOutput = fileGeneratorResult.output as any;
      developerOutput.generatedFiles = fileGenOutput.generatedFiles || [];
      developerOutput.summary.filesCreated = fileGenOutput.summary?.totalFiles || 0;

      console.log(`[Orchestrator] ✅ File Generator 완료: ${developerOutput.summary.filesCreated}개 파일 생성`);

      // Code Reviewer 실행
      console.log(`[Orchestrator] 🔍 Code Reviewer: Task ${task.id}`);
      const reviewerResult = await this.runAgent('code-reviewer', projectId, {
        projectId,
        project: {
          name: project.name,
          description: project.description,
          wizardLevel: project.wizardLevel,
        },
      });

      // ✅ 엄격한 상태 확인
      if (reviewerResult.status !== 'COMPLETED') {
        const errorMsg = `Code Reviewer 실행 실패 (status: ${reviewerResult.status})`;
        console.log(`[Orchestrator] ❌ ${errorMsg}`);
        taskRetryCount.set(task.id, retryCount + 1);
        await this.updateTaskStatus(projectId, task.id, 'pending');
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      const reviewOutput = reviewerResult.output || {};
      if (reviewOutput.reviewResult === 'fail') {
        console.log('[Orchestrator] ❌ Code Review FAIL - marking task for retry');
        taskRetryCount.set(task.id, retryCount + 1);
        await this.updateTaskStatus(projectId, task.id, 'pending'); // Reset to pending
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      // ✅ Code Reviewer 결과가 DB에 저장될 때까지 대기
      console.log('[Orchestrator] ⏳ Waiting for Code Reviewer result to be saved to DB...');
      await this.waitForAgentResultInDB(projectId, 'code-reviewer');
      console.log('[Orchestrator] ✅ Code Reviewer result confirmed in DB');

      // Tester 실행
      console.log(`[Orchestrator] 🧪 Tester: Task ${task.id}`);
      const testerResult = await this.runAgent('tester', projectId, {
        projectId,
        project: {
          name: project.name,
          description: project.description,
          wizardLevel: project.wizardLevel,
        },
      });

      if (testerResult.status !== 'COMPLETED') {
        console.log('[Orchestrator] ⚠️ Tester failed, continuing anyway');
      }

      const testOutput = testerResult.output || {};
      if (testOutput.testResult === 'fail') {
        console.log('[Orchestrator] ❌ Test FAIL - marking task for retry');
        await this.updateTaskStatus(projectId, task.id, 'pending'); // Reset to pending
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      // 모두 통과하면 Task 완료
      console.log(`[Orchestrator] ✅ Task ${task.id} completed (Dev + Review + Test PASS)`);
      tasksCompleted++;

      // 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`[Orchestrator] ⚠️ Reached max iterations (${maxIterations})`);
    this.activeDevelopmentLoops.delete(projectId);
    console.log(`[Orchestrator] 🔄 Development loop ended for ${projectId}, remaining active loops: ${this.activeDevelopmentLoops.size}`);
    return { success: false, tasksCompleted };
  } catch (error) {
    console.error(`[Orchestrator] ❌ Development loop error for ${projectId}:`, error);
    this.activeDevelopmentLoops.delete(projectId);
    console.log(`[Orchestrator] 🔄 Development loop error cleanup for ${projectId}, remaining active loops: ${this.activeDevelopmentLoops.size}`);
    throw error;
  }
  }

  /**
   * Epic 단위 테스트 실행
   */
  private async runEpicTest(params: {
    projectId: string;
    project: any;
    epicStoryOutput: any;
    currentEpicOrder: number;
  }): Promise<{ pass: boolean; reason?: string }> {
    const { projectId, project, epicStoryOutput, currentEpicOrder } = params;

    const currentEpic = epicStoryOutput.epics[currentEpicOrder - 1];

    // Tester Agent에게 Epic 단위 테스트 요청
    const testerResult = await this.runAgent('tester', projectId, {
      projectId,
      project: {
        name: project.name,
        description: project.description,
        wizardLevel: project.wizardLevel,
      },
      testScope: {
        type: 'epic',
        epicOrder: currentEpicOrder,
        epicTitle: currentEpic.title,
      },
    });

    if (testerResult.status !== 'COMPLETED') {
      return {
        pass: false,
        reason: 'Tester Agent 실행 실패',
      };
    }

    const output = testerResult.output || {};

    // Scrum Master에 Epic 테스트 결과 저장
    await this.updateScrumMasterEpicTestResult(projectId, currentEpicOrder, output);

    return {
      pass: output.testResult === 'pass',
      reason: output.failureReason || '테스트 실패',
    };
  }

  /**
   * 통합 테스트 실행
   */
  private async runIntegrationTest(params: {
    projectId: string;
    project: any;
    epicStoryOutput: any;
  }): Promise<{ pass: boolean; reason?: string }> {
    const { projectId, project, epicStoryOutput } = params;

    // Tester Agent에게 통합 테스트 요청
    const testerResult = await this.runAgent('tester', projectId, {
      projectId,
      project: {
        name: project.name,
        description: project.description,
        wizardLevel: project.wizardLevel,
      },
      testScope: {
        type: 'integration',
        totalEpics: epicStoryOutput.epics.length,
      },
    });

    if (testerResult.status !== 'COMPLETED') {
      return {
        pass: false,
        reason: 'Tester Agent 실행 실패',
      };
    }

    const output = testerResult.output || {};

    // Scrum Master에 통합 테스트 결과 저장
    await this.updateScrumMasterIntegrationTestResult(projectId, output);

    return {
      pass: output.testResult === 'pass',
      reason: output.failureReason || '테스트 실패',
    };
  }

  /**
   * 실패 시 Scrum Master가 대응 Task 생성
   */
  private async generateFixTasks(params: {
    projectId: string;
    project: any;
    epicStoryOutput: any;
    selectedPRD: any;
    testResult: any;
    testType: 'epic' | 'integration';
    epicOrder?: number;
  }): Promise<void> {
    const { projectId, project, epicStoryOutput, selectedPRD, testResult, testType, epicOrder } = params;

    console.log(`[Orchestrator] 🔧 Scrum Master: 대응 Task 생성 (${testType} test fail)`);

    // Scrum Master에게 실패 분석 및 대응 Task 생성 요청
    const scrumMasterResult = await this.runAgent('scrum-master', projectId, {
      projectId,
      project: {
        name: project.name,
        description: project.description,
        wizardLevel: project.wizardLevel,
      },
      epicStory: epicStoryOutput,
      selectedPRD,
      failureContext: {
        type: testType,
        epicOrder,
        testResult,
      },
    });

    if (scrumMasterResult.status !== 'COMPLETED') {
      throw new Error('Scrum Master 대응 Task 생성 실패');
    }

    console.log('[Orchestrator] ✅ 대응 Task 생성 완료');
  }

  /**
   * Task 상태 업데이트
   */
  private async updateTaskStatus(projectId: string, taskId: string, status: string): Promise<void> {
    const scrumMasterExec = await prisma.agentExecution.findFirst({
      where: { projectId, agentId: 'scrum-master' },
      orderBy: { startedAt: 'desc' },
    });

    if (!scrumMasterExec || !scrumMasterExec.output) return;

    const output = scrumMasterExec.output as any;
    const task = output.tasks?.find((t: any) => t.id === taskId);

    if (task) {
      task.status = status;
      await prisma.agentExecution.update({
        where: { id: scrumMasterExec.id },
        data: { output: output as any },
      });
    }
  }

  /**
   * Scrum Master에 Epic 테스트 결과 저장
   */
  private async updateScrumMasterEpicTestResult(
    projectId: string,
    epicOrder: number,
    testResult: any
  ): Promise<void> {
    const scrumMasterExec = await prisma.agentExecution.findFirst({
      where: { projectId, agentId: 'scrum-master' },
      orderBy: { startedAt: 'desc' },
    });

    if (!scrumMasterExec || !scrumMasterExec.output) return;

    const output = scrumMasterExec.output as any;
    output.epicTestResult = {
      epicOrder,
      result: testResult.testResult || 'fail',
      testDate: new Date().toISOString(),
      failures: testResult.failures || [],
    };

    await prisma.agentExecution.update({
      where: { id: scrumMasterExec.id },
      data: { output: output as any },
    });
  }

  /**
   * Agent 실행 결과가 DB에 저장될 때까지 대기
   */
  private async waitForAgentResultInDB(
    projectId: string,
    agentId: string,
    maxWaitMs: number = 10000
  ): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 500; // 0.5초마다 확인

    while (Date.now() - startTime < maxWaitMs) {
      const execution = await prisma.agentExecution.findFirst({
        where: {
          projectId,
          agentId,
        },
        orderBy: {
          startedAt: 'desc',
        },
      });

      if (execution && execution.output) {
        // 결과가 DB에 저장됨
        return;
      }

      // 결과가 아직 없으면 대기 후 재시도
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    throw new Error(`${agentId} 결과가 ${maxWaitMs}ms 동안 DB에 저장되지 않았습니다`);
  }

  /**
   * Scrum Master에 통합 테스트 결과 저장
   */
  private async updateScrumMasterIntegrationTestResult(projectId: string, testResult: any): Promise<void> {
    const scrumMasterExec = await prisma.agentExecution.findFirst({
      where: { projectId, agentId: 'scrum-master' },
      orderBy: { startedAt: 'desc' },
    });

    if (!scrumMasterExec || !scrumMasterExec.output) return;

    const output = scrumMasterExec.output as any;
    output.integrationTestResult = {
      result: testResult.testResult || 'fail',
      testDate: new Date().toISOString(),
      failures: testResult.failures || [],
    };

    await prisma.agentExecution.update({
      where: { id: scrumMasterExec.id },
      data: { output: output as any },
    });
  }
}

// 싱글톤 인스턴스
let orchestrator: MagicOrchestrator | null = null;

export function getOrchestrator() {
  if (!orchestrator) {
    orchestrator = new MagicOrchestrator();
  }
  return orchestrator;
}
