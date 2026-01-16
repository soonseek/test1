import { AgentConfig, AgentContext, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/shared';
import Pino from 'pino';

// Re-export types and enums for convenience
export type { AgentConfig, AgentContext, AgentExecutionResult };
export { AgentStatus, CompletionMode };

const logger = Pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

export abstract class Agent {
  protected config: AgentConfig;
  protected status: AgentStatus = AgentStatus.IDLE;
  protected retryCount: number = 0;
  protected context: Map<string, any> = new Map();

  constructor(config: AgentConfig) {
    this.config = config;
  }

  abstract execute(input: any): Promise<AgentExecutionResult>;

  getId(): string {
    return this.config.agentId;
  }

  getName(): string {
    return this.config.name;
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  setStatus(status: AgentStatus): void {
    this.status = status;
    logger.info({
      agent: this.getId(),
      status,
    }, 'Agent status changed');
  }

  getConfig(): AgentConfig {
    return this.config;
  }

  getCompletionMode(): CompletionMode {
    return this.config.completionMode;
  }

  protected async log(message: string, data?: any): Promise<void> {
    logger.info({
      agent: this.getId(),
      message,
      data,
    });
  }

  protected async logError(error: Error, data?: any): Promise<void> {
    logger.error({
      agent: this.getId(),
      error: error.message,
      stack: error.stack,
      data,
    });
  }

  protected shareContext(toAgents: string[], key: string, data: any): void {
    // Context는 Event Bus를 통해 공유
    // 이 부분은 Orchestrator에서 처리
  }
}
