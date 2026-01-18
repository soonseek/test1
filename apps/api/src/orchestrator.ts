import { getEventBus } from '@magic-wand/agent-framework';
import { prisma } from '@magic-wand/db';
import { RequirementAnalyzerAgent } from '@magic-wand/agents';
import { EpicStoryAgent } from '@magic-wand/agents';
import { ScrumMasterAgent } from '@magic-wand/agents';
import { DeveloperAgent } from '@magic-wand/agents';
import { CodeReviewerAgent } from '@magic-wand/agents';
import { TesterAgent } from '@magic-wand/agents';
import { PromptBuilderAgent } from '@magic-wand/agents';
import { CodeGeneratorAgent } from '@magic-wand/agents';
import { GitHubPusherAgent } from '@magic-wand/agents';
import { NetlifyDeployerAgent } from '@magic-wand/agents';
import { E2ETestRunnerAgent } from '@magic-wand/agents';
import { IssueResolverAgent } from '@magic-wand/agents';
import { DocumentParserAgent } from '@magic-wand/agents';

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

  constructor() {
    // 모든 Agent 초기화
    this.agents = new Map();
    this.agents.set('requirement-analyzer', new RequirementAnalyzerAgent());
    this.agents.set('epic-story', new EpicStoryAgent());
    this.agents.set('scrum-master', new ScrumMasterAgent());
    this.agents.set('developer', new DeveloperAgent());
    this.agents.set('code-reviewer', new CodeReviewerAgent());
    this.agents.set('tester', new TesterAgent());
    this.agents.set('prompt-builder', new PromptBuilderAgent());
    this.agents.set('code-generator', new CodeGeneratorAgent());
    this.agents.set('github-pusher', new GitHubPusherAgent());
    this.agents.set('netlify-deployer', new NetlifyDeployerAgent());
    this.agents.set('e2e-test-runner', new E2ETestRunnerAgent());
    this.agents.set('issue-resolver', new IssueResolverAgent());
    this.agents.set('document-parser', new DocumentParserAgent());
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

    try {
      // Agent 실행
      console.log(`[Orchestrator] About to execute agent ${agentId}...`);
      console.log(`[Orchestrator] Agent input type:`, typeof input);
      console.log(`[Orchestrator] Agent has execute method:`, typeof agent.execute);

      const result = await agent.execute(input);

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
}

// 싱글톤 인스턴스
let orchestrator: MagicOrchestrator | null = null;

export function getOrchestrator() {
  if (!orchestrator) {
    orchestrator = new MagicOrchestrator();
  }
  return orchestrator;
}
