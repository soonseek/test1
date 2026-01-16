import Redis from 'ioredis';
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

export interface EventBusEvent {
  name: string;
  data: any;
  timestamp: string;
}

export type EventHandler = (event: EventBusEvent) => void | Promise<void>;

export class EventBus {
  private publisher: Redis;
  private subscriber: Redis;
  private handlers: Map<string, EventHandler[]> = new Map();
  private isConnected: boolean = false;

  constructor(redisUrl: string = process.env.REDIS_URL || 'redis://localhost:6379') {
    this.publisher = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);

    this.setupConnectionHandlers();
  }

  private setupConnectionHandlers(): void {
    this.publisher.on('connect', () => {
      logger.info('Event Bus publisher connected');
      this.isConnected = true;
    });

    this.publisher.on('error', (error) => {
      logger.error({ error }, 'Event Bus publisher error');
      this.isConnected = false;
    });

    this.subscriber.on('connect', () => {
      logger.info('Event Bus subscriber connected');
    });

    this.subscriber.on('error', (error) => {
      logger.error({ error }, 'Event Bus subscriber error');
    });
  }

  async publish(eventName: string, data: any): Promise<void> {
    if (!this.isConnected) {
      logger.warn({ eventName }, 'Event Bus not connected, message not published');
      return;
    }

    const event: EventBusEvent = {
      name: eventName,
      data,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.publisher.publish(eventName, JSON.stringify(event));
      logger.debug({ eventName, data }, 'Event published');
    } catch (error) {
      logger.error({ eventName, error }, 'Failed to publish event');
    }
  }

  async subscribe(eventName: string, handler: EventHandler): Promise<void> {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, []);

      // 첫 구독일 때만 Redis 구독
      await this.subscriber.subscribe(eventName);
      logger.info({ eventName }, 'Subscribed to event');

      // 메시지 리스너 설정
      this.subscriber.on('message', (channel, message) => {
        if (channel === eventName) {
          this.handleMessage(eventName, message);
        }
      });
    }

    this.handlers.get(eventName)!.push(handler);
    logger.debug({ eventName, handlerCount: this.handlers.get(eventName)!.length }, 'Handler registered');
  }

  private async handleMessage(eventName: string, message: string): Promise<void> {
    try {
      const event: EventBusEvent = JSON.parse(message);
      const handlers = this.handlers.get(eventName) || [];

      logger.debug({ eventName, handlerCount: handlers.length }, 'Handling event');

      // 모든 핸들러 병렬 실행
      await Promise.all(
        handlers.map(handler => {
          try {
            return handler(event);
          } catch (error) {
            logger.error({ eventName, error }, 'Handler execution failed');
          }
        })
      );
    } catch (error) {
      logger.error({ eventName, error }, 'Failed to parse event message');
    }
  }

  async unsubscribe(eventName: string, handler: EventHandler): Promise<void> {
    const handlers = this.handlers.get(eventName);
    if (!handlers) return;

    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
      logger.debug({ eventName }, 'Handler unregistered');

      // 핸들러가 없으면 구독 취소
      if (handlers.length === 0) {
        await this.subscriber.unsubscribe(eventName);
        this.handlers.delete(eventName);
        logger.info({ eventName }, 'Unsubscribed from event');
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.publisher.quit();
    await this.subscriber.quit();
    this.isConnected = false;
    logger.info('Event Bus disconnected');
  }

  isConnectedToRedis(): boolean {
    return this.isConnected;
  }
}

// 싱글톤 인스턴스
let eventBusInstance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!eventBusInstance) {
    eventBusInstance = new EventBus();
  }
  return eventBusInstance;
}
