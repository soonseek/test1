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

      // 2. 첫 번째 Agent 실행 (RequirementAnalyzer)
      console.log('[Orchestrator] About to start first agent: requirement-analyzer');
      const agentResult = await this.runAgent('requirement-analyzer', projectId, {
        projectId,
        project,
        files,
        survey,
      });
      console.log('[Orchestrator] First agent result:', agentResult);

      console.log(`✅ Magic orchestration started for project: ${projectId}`);
    } catch (error: any) {
      console.error(`[Orchestrator] Magic orchestration failed for project ${projectId}:`, error);
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
