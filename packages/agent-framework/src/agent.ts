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

  /**
   * Retry logic with exponential backoff (inspired by Ralphy)
   *
   * @param fn - Function to retry
   * @param context - Context description for logging
   * @param maxRetries - Maximum number of retry attempts (default: 3)
   * @param initialDelay - Initial delay in milliseconds (default: 5000ms = 5s)
   * @param backoffMultiplier - Multiplier for exponential backoff (default: 2)
   *
   * Retry delays:
   * - Attempt 1: Immediate
   * - Attempt 2: 5 seconds
   * - Attempt 3: 10 seconds
   * - Attempt 4: 20 seconds (if maxRetries > 3)
   */
  protected async retryWithBackoff<T>(
    fn: () => Promise<T>,
    context: string,
    maxRetries: number = 3,
    initialDelay: number = 5000,
    backoffMultiplier: number = 2
  ): Promise<T> {
    let lastError: Error | null = null;
    let delay = initialDelay;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        // Check if error is retryable
        if (!this.isRetryable(error)) {
          throw error;
        }

        // If this was the last attempt, throw the error
        if (attempt === maxRetries) {
          throw new Error(`${context} failed after ${attempt} attempts: ${error.message}`);
        }

        // Log retry attempt
        logger.warn({
          agent: this.getId(),
          context,
          attempt,
          maxRetries,
          delay,
          error: error.message,
        }, `Retry attempt ${attempt}/${maxRetries} after ${delay}ms`);

        // Wait before retrying with exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= backoffMultiplier;
      }
    }

    // Should never reach here, but TypeScript needs it
    throw lastError || new Error(`${context} failed`);
  }

  /**
   * Check if an error is retryable
   * Override this method in subclasses to customize retry logic
   */
  protected isRetryable(error: any): boolean {
    // Retry on:
    // - Network errors
    // - API rate limits (429)
    // - Server errors (5xx)
    // - Timeouts
    // - Connection resets

    if (error?.status === 429) return true; // Rate limit
    if (error?.status >= 500) return true; // Server errors
    if (error?.code === 'ECONNRESET') return true; // Connection reset
    if (error?.code === 'ETIMEDOUT') return true; // Timeout
    if (error?.code === 'ENOTFOUND') return true; // DNS lookup failed
    if (error?.message?.includes('timeout')) return true;
    if (error?.message?.includes('rate limit')) return true;
    if (error?.message?.includes('temporarily unavailable')) return true;

    return false;
  }
}
