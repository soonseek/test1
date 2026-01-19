import { Agent } from './Agent';
import { AgentConfig, AgentStatus, AgentContext } from '@magic-wand/shared';
import Pino from 'pino';

const logger = Pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

export class AgentOrchestrator {
  private agents: Map<string, Agent> = new Map();
  private executionQueue: string[] = [];
  private completedAgents: Set<string> = new Set();
  private failedAgents: Set<string> = new Set();
  private context: Map<string, any> = new Map();

  registerAgent(agent: Agent): void {
    this.agents.set(agent.getId(), agent);
    logger.info({
      agentId: agent.getId(),
      name: agent.getName(),
    }, 'Agent registered');
  }

  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  async startWorkflow(projectId: string, initialInput: any): Promise<void> {
    logger.info({ projectId }, 'Starting workflow');

    // 초기 실행 가능한 Agent 찾기
    const readyAgents = this.findReadyAgents();

    // 실행 큐에 추가
    readyAgents.forEach(agent => {
      if (!this.executionQueue.includes(agent.getId())) {
        this.executionQueue.push(agent.getId());
      }
    });

    // 워크플로우 실행
    await this.processQueue(projectId, initialInput);
  }

  private findReadyAgents(): Agent[] {
    return Array.from(this.agents.values()).filter(agent => {
      const config = agent.getConfig();
      // 의존성이 없는 Agent는 실행 가능
      return config.dependencies.length === 0;
    });
  }

  private async processQueue(projectId: string, initialInput: any): Promise<void> {
    while (this.executionQueue.length > 0) {
      const agentId = this.executionQueue.shift()!;
      const agent = this.agents.get(agentId);

      if (!agent) {
        logger.warn({ agentId }, 'Agent not found');
        continue;
      }

      // 의존성 체크
      if (!this.areDependenciesSatisfied(agent)) {
        // 나중에 다시 시도
        this.executionQueue.push(agentId);
        continue;
      }

      try {
        logger.info({ agentId, projectId }, 'Executing agent');

        agent.setStatus(AgentStatus.RUNNING);

        // 컨텍스트 수집
        const input = this.collectContext(agent, initialInput);

        // Agent 실행
        const result = await this.executeWithRetry(agent, input);

        if (result.status === AgentStatus.COMPLETED) {
          this.completedAgents.add(agentId);
          agent.setStatus(AgentStatus.COMPLETED);

          // 컨텍스트 저장
          this.storeContext(agent, result.output);

          // 다음 실행 가능한 Agent 찾기
          const nextAgents = this.findNextAgents(agent);
          nextAgents.forEach(nextAgent => {
            if (!this.executionQueue.includes(nextAgent.getId())) {
              this.executionQueue.push(nextAgent.getId());
            }
          });
        } else if (result.status === AgentStatus.FAILED) {
          this.failedAgents.add(agentId);
          agent.setStatus(AgentStatus.FAILED);

          logger.error({ agentId, error: result.error }, 'Agent failed');

          // 실패 처리 로직 (롤백 또는 계속 진행)
          await this.handleAgentFailure(agent, result);
        }
      } catch (error) {
        logger.error({ agentId, error }, 'Agent execution error');
        this.failedAgents.add(agentId);
        agent.setStatus(AgentStatus.FAILED);
      }
    }

    logger.info({ projectId, completed: this.completedAgents.size, failed: this.failedAgents.size }, 'Workflow completed');
  }

  private areDependenciesSatisfied(agent: Agent): boolean {
    const dependencies = agent.getConfig().dependencies;
    return dependencies.every((dep: string) => this.completedAgents.has(dep));
  }

  private findNextAgents(completedAgent: Agent): Agent[] {
    const completedAgentId = completedAgent.getId();

    return Array.from(this.agents.values()).filter(agent => {
      const dependencies = agent.getConfig().dependencies;
      return dependencies.includes(completedAgentId) && this.areDependenciesSatisfied(agent);
    });
  }

  private collectContext(agent: Agent, initialInput: any): any {
    const config = agent.getConfig();
    const input: any = { ...initialInput };

    // 의존하는 Agent의 컨텍스트 수집
    config.dependencies.forEach((depId: string) => {
      const depContext = this.context.get(depId);
      if (depContext) {
        input[depId] = depContext;
      }
    });

    return input;
  }

  private storeContext(agent: Agent, output: any): void {
    const agentId = agent.getId();
    this.context.set(agentId, output);

    // Context Sharing
    const config = agent.getConfig();
    config.contextSharing.sharesTo.forEach((targetAgentId: string) => {
      logger.info({ from: agentId, to: targetAgentId }, 'Context shared');
    });
  }

  private async executeWithRetry(agent: Agent, input: any): Promise<any> {
    const maxRetries = agent.getConfig().maxRetries;
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await agent.execute(input);
        return result;
      } catch (error) {
        lastError = error;
        logger.warn({ agentId: agent.getId(), attempt, error }, 'Agent execution failed, retrying');

        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  private async handleAgentFailure(agent: Agent, result: any): Promise<void> {
    // 실패 처리 로직
    // - Activity Log 저장
    // - Slack 알림
    // - 롤백 또는 계속 진행 결정

    logger.warn({
      agentId: agent.getId(),
      error: result.error,
    }, 'Handling agent failure');
  }

  reset(): void {
    this.executionQueue = [];
    this.completedAgents.clear();
    this.failedAgents.clear();
    this.context.clear();

    // 모든 Agent 상태 초기화
    this.agents.forEach(agent => {
      agent.setStatus(AgentStatus.IDLE);
    });
  }

  getStatus(): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
  } {
    const total = this.agents.size;
    const completed = this.completedAgents.size;
    const failed = this.failedAgents.size;
    const pending = total - completed - failed;

    return { total, completed, failed, pending };
  }
}
