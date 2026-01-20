import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { PrismaClient } from '@magic-wand/db';
import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

interface DatabaseInitializerInput {
  projectId: string;
  projectDir: string;
  environment?: 'local' | 'netlify' | 'auto-detect';
  skipMigration?: boolean;
  forceReset?: boolean;
  verbose?: boolean;
}

interface DatabaseInitializerOutput {
  skipped: boolean;
  skipReason?: string;
  connectionStatus?: 'connected' | 'failed';
  environment?: 'local' | 'netlify';
  migrationStatus?: 'up-to-date' | 'pending' | 'executed' | 'failed';
  databaseInfo?: {
    host: string;
    port: number;
    database: string;
    provider: 'postgresql' | 'mysql' | 'sqlite';
  };
  healthCheck?: {
    reachable: boolean;
    latency: number;
    version?: string;
  };
  recommendations?: string[];
  errors?: string[];
}

/**
 * Prisma 에러 코드 매핑
 * https://www.prisma.io/docs/reference/api-reference/error-reference
 */
const PRISMA_ERROR_MESSAGES: Record<string, string> = {
  P1001: "데이터베이스 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.",
  P1002: "데이터베이스 서버에 연결할 수 없어 시간이 초과되었습니다.",
  P1003: "데이터베이스 인증에 실패했습니다. 사용자명과 비밀번호를 확인하세요.",
  P1004: "데이터베이스를 찾을 수 없습니다.",
  P1005: "데이터베이스가 이미 존재합니다.",
  P1006: "데이터베이스 연결 풀이 소진되었습니다.",
  P1008: "데이터베이스 연결을 열 수 없습니다 (Operations timeout).",
  P1009: "데이터베이스가 존재하지 않습니다.",
  P1010: "Raw database access이 비활성화되어 있습니다.",
  P1011: "데이터베이스 마이그레이션 오류가 발생했습니다.",
  P1012: "데이터베이스 쿼리 유효성 검사 오류가 발생했습니다.",
  P1013: "데이터베이스 쿼리에서 오류가 발생했습니다.",
  P1014: "데이터베이스 마이그레이션을 찾을 수 없습니다.",
  P1015: "데이터베이스 마이그레이션의 이름 충돌이 발생했습니다.",
  P1016: "Raw query 실행 오류가 발생했습니다.",
  P1017: "서버 연결 시간 초과가 발생했습니다.",
};

export class DatabaseInitializerAgent extends Agent {
  private prisma: PrismaClient;
  private magicWandRoot: string;

  constructor() {
    super({
      agentId: 'database-initializer',
      name: '데이터베이스 초기화 담당자',
      role: '데이터베이스 연결 설정 및 마이그레이션 전문 관리',
      trigger: {
        type: 'event', // 개발자가 명시적으로 호출하거나 orchestrator에서 조건부 호출
        event: 'database.initialize',
      },
      completionMode: CompletionMode.AUTO_CLOSE,
      maxRetries: 2,
      timeout: 180, // 3분
      dependencies: [],
      contextSharing: {
        sharesTo: ['developer', 'issue-resolver'],
        data: ['databaseInfo', 'connectionStatus'],
      },
    });

    this.prisma = new PrismaClient();
    this.magicWandRoot = process.cwd();
  }

  async execute(input: DatabaseInitializerInput): Promise<AgentExecutionResult> {
    await this.log('데이터베이스 초기화 시작', {
      projectId: input.projectId,
      environment: input.environment || 'auto-detect',
    });

    try {
      // 1. 프로젝트가 DB를 필요로 하는지 확인
      const dbRequirement = await this.checkDatabaseRequirement(input.projectDir);

      if (!dbRequirement.required) {
        await this.log('데이터베이스가 필요 없는 프로젝트, 건너뜀', {
          reason: dbRequirement.reason,
        });

        const output: DatabaseInitializerOutput = {
          skipped: true,
          skipReason: dbRequirement.reason,
        };

        return {
          status: AgentStatus.COMPLETED,
          output,
        };
      }

      await this.log('데이터베이스 필요함 확인', {
        reason: dbRequirement.reason,
      });

      // 2. 환경 감지
      const environment = input.environment || 'auto-detect';
      const detectedEnv = environment === 'auto-detect'
        ? await this.detectEnvironment(input.projectDir)
        : environment;

      await this.log('환경 감지 완료', { environment: detectedEnv });

      // 3. .env 파일에서 DATABASE_URL 확인 및 검증
      const dbUrl = await this.getAndValidateDatabaseUrl(input.projectDir);

      if (!dbUrl) {
        const errorMsg = 'DATABASE_URL이 .env 파일에 없습니다. 데이터베이스 연결이 필요한 프로젝트인 경우 .env 파일에 DATABASE_URL을 설정해주세요.';

        await this.logError(new Error(errorMsg));

        const output: DatabaseInitializerOutput = {
          skipped: false,
          connectionStatus: 'failed',
          recommendations: [
            '1. .env 파일을 확인하세요',
            '2. DATABASE_URL을 추가하세요 (예: postgresql://user:password@localhost:5432/dbname)',
            '3. 데이터베이스가 필요하지 않은 프로젝트라면 이 메시지를 무시하세요',
          ],
          errors: [errorMsg],
        };

        return {
          status: AgentStatus.FAILED,
          error: {
            message: errorMsg,
            retryable: false,
          },
        };
      }

      // 4. DATABASE_URL 파싱
      const dbInfo = this.parseDatabaseUrl(dbUrl);

      if (!dbInfo) {
        const errorMsg = 'DATABASE_URL 파싱 실패';

        await this.logError(new Error(errorMsg));

        const output: DatabaseInitializerOutput = {
          skipped: false,
          connectionStatus: 'failed',
          recommendations: ['DATABASE_URL 형식을 확인하세요'],
          errors: [errorMsg],
        };

        return {
          status: AgentStatus.FAILED,
          error: {
            message: errorMsg,
            retryable: false,
          },
        };
      }

      await this.log('DATABASE_URL 파싱 완료', {
        host: dbInfo.host,
        port: dbInfo.port,
        database: dbInfo.database,
      });

      // 5. 연결 테스트 (Health Check)
      const healthCheck = await this.testConnection(dbUrl);

      if (!healthCheck.reachable) {
        const errorMsg = `데이터베이스 연결 실패: ${healthCheck.error}`;

        await this.logError(new Error(errorMsg));

        const output: DatabaseInitializerOutput = {
          skipped: false,
          connectionStatus: 'failed',
          databaseInfo: dbInfo,
          recommendations: this.getRecommendationsForConnectionError(healthCheck.errorCode),
          errors: [errorMsg],
        };

        return {
          status: AgentStatus.FAILED,
          error: {
            message: errorMsg,
            retryable: this.isRetryableError(healthCheck.errorCode),
          },
        };
      }

      await this.log('데이터베이스 연결 성공', {
        latency: healthCheck.latency,
        version: healthCheck.version,
      });

      // 6. 마이그레이션 상태 확인
      let migrationStatus: 'up-to-date' | 'pending' | 'executed' | 'failed' = 'up-to-date';
      const recommendations: string[] = [];

      if (!input.skipMigration) {
        const migrationResult = await this.handleMigrations(input.projectDir, input.forceReset);

        migrationStatus = migrationResult.status;

        if (migrationResult.status === 'failed') {
          await this.logError(new Error(`마이그레이션 실패: ${migrationResult.error}`));

          const output: DatabaseInitializerOutput = {
            skipped: false,
            connectionStatus: 'connected',
            environment: detectedEnv,
            migrationStatus: 'failed',
            databaseInfo: dbInfo,
            healthCheck,
            recommendations: migrationResult.recommendations || [],
            errors: migrationResult.error ? [migrationResult.error] : ['마이그레이션 실패'],
          };

          return {
            status: AgentStatus.FAILED,
            error: {
              message: migrationResult.error || '마이그레이션 실패',
              retryable: false,
            },
          };
        }

        if (migrationResult.recommendations) {
          recommendations.push(...migrationResult.recommendations);
        }
      }

      // 7. 성공 응답
      await this.log('데이터베이스 초기화 완료', {
        connectionStatus: 'connected',
        migrationStatus,
      });

      const output: DatabaseInitializerOutput = {
        skipped: false,
        connectionStatus: 'connected',
        environment: detectedEnv,
        migrationStatus,
        databaseInfo: dbInfo,
        healthCheck,
        recommendations: recommendations.length > 0 ? recommendations : undefined,
      };

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
          retryable: this.isRetryableError(error.code),
        },
      };
    }
  }

  /**
   * 프로젝트가 데이터베이스를 필요로 하는지 확인
   */
  private async checkDatabaseRequirement(projectDir: string): Promise<{ required: boolean; reason?: string }> {
    // 1. Prisma 스키마 파일 존재 확인
    const prismaSchemaPath = path.join(projectDir, 'prisma', 'schema.prisma');
    const hasPrismaSchema = await fs.pathExists(prismaSchemaPath);

    if (hasPrismaSchema) {
      return { required: true, reason: 'Prisma 스키마 파일 존재' };
    }

    // 2. package.json에서 Prisma 의존성 확인
    const packageJsonPath = path.join(projectDir, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      const hasPrisma = (
        packageJson.dependencies?.['@prisma/client'] ||
        packageJson.devDependencies?.['prisma']
      );

      if (hasPrisma) {
        return { required: true, reason: 'Prisma 패키지 의존성 존재' };
      }
    }

    // 3. .env 파일에 DATABASE_URL이 있는지 확인
    const envPath = path.join(projectDir, '.env');
    if (await fs.pathExists(envPath)) {
      const envContent = await fs.readFile(envPath, 'utf-8');
      if (envContent.includes('DATABASE_URL') && !envContent.includes('DATABASE_URL=')) {
        return { required: true, reason: '.env에 DATABASE_URL 설정 존재' };
      }
    }

    return { required: false, reason: 'Prisma 스키마 또는 DATABASE_URL 없음 - DB 미사용 프로젝트' };
  }

  /**
   * 환경 자동 감지 (Local vs Netlify DB)
   */
  private async detectEnvironment(projectDir: string): Promise<'local' | 'netlify'> {
    // Netlify DB 패키지 확인
    const packageJsonPath = path.join(projectDir, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      if (packageJson.dependencies?.['@netlify/neon']) {
        return 'netlify';
      }
    }

    // .env에서 Netlify 관련 환경 변수 확인
    const envPath = path.join(projectDir, '.env');
    if (await fs.pathExists(envPath)) {
      const envContent = await fs.readFile(envPath, 'utf-8');
      if (envContent.includes('NETLIFY') || envContent.includes('neon.tech')) {
        return 'netlify';
      }
    }

    return 'local';
  }

  /**
   * .env 파일에서 DATABASE_URL 확인 및 검증
   */
  private async getAndValidateDatabaseUrl(projectDir: string): Promise<string | null> {
    const envPath = path.join(projectDir, '.env');

    if (!await fs.pathExists(envPath)) {
      await this.log('.env 파일 없음');
      return null;
    }

    const envContent = await fs.readFile(envPath, 'utf-8');
    const match = envContent.match(/DATABASE_URL\s*=\s*["']?([^"'\n]+)["']?/);

    if (!match || !match[1]) {
      await this.log('DATABASE_URL 없음');
      return null;
    }

    const dbUrl = match[1].trim();

    // URL 형식 검증
    if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('mysql://') && !dbUrl.startsWith('file:')) {
      await this.log('잘못된 DATABASE_URL 형식', { url: dbUrl.substring(0, 20) + '...' });
      return null;
    }

    return dbUrl;
  }

  /**
   * DATABASE_URL 파싱
   */
  private parseDatabaseUrl(dbUrl: string): DatabaseInitializerOutput['databaseInfo'] | null {
    try {
      if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('mysql://')) {
        const url = new URL(dbUrl);
        return {
          host: url.hostname,
          port: parseInt(url.port) || (dbUrl.startsWith('postgresql://') ? 5432 : 3306),
          database: url.pathname.substring(1), // remove leading /
          provider: dbUrl.startsWith('postgresql://') ? 'postgresql' : 'mysql',
        };
      }

      // SQLite
      return {
        host: 'local',
        port: 0,
        database: dbUrl.replace('file:', ''),
        provider: 'sqlite',
      };
    } catch (error) {
      console.error('[DatabaseInitializer] DATABASE_URL 파싱 오류:', error);
      return null;
    }
  }

  /**
   * 데이터베이스 연결 테스트 (Health Check)
   */
  private async testConnection(dbUrl: string): Promise<{
    reachable: boolean;
    latency: number;
    version?: string;
    error?: string;
    errorCode?: string;
  }> {
    const startTime = Date.now();

    try {
      // Prisma Client로 연결 테스트
      await this.prisma.$connect();

      const latency = Date.now() - startTime;

      // 버전 확인
      let version: string | undefined;
      try {
        const result = await this.prisma.$queryRaw`SELECT version()` as any[];
        if (result && result[0]) {
          version = String(result[0]).substring(0, 50);
        }
      } catch (e) {
        // 버전 확인 실패해도 연결 성공으로 간주
      }

      await this.prisma.$disconnect();

      return {
        reachable: true,
        latency,
        version,
      };
    } catch (error: any) {
      await this.prisma.$disconnect();

      const errorCode = error.code;
      const errorMessage = PRISMA_ERROR_MESSAGES[errorCode] || error.message || '알 수 없는 연결 오류';

      return {
        reachable: false,
        latency: Date.now() - startTime,
        error: errorMessage,
        errorCode,
      };
    }
  }

  /**
   * 마이그레이션 처리
   */
  private async handleMigrations(
    projectDir: string,
    forceReset?: boolean
  ): Promise<{ status: 'up-to-date' | 'pending' | 'executed' | 'failed'; error?: string; recommendations?: string[] }> {
    try {
      // 1. Prisma 클라이언트 생성 상태 확인
      const prismaDir = path.join(projectDir, 'prisma');

      if (!await fs.pathExists(prismaDir)) {
        return {
          status: 'failed',
          error: 'prisma 디렉토리가 존재하지 않습니다. 먼저 `npx prisma init`을 실행하세요.',
          recommendations: ['npx prisma init 실행'],
        };
      }

      // 2. 마이그레이션 파일 확인
      const migrationsDir = path.join(prismaDir, 'migrations');
      const hasMigrations = await fs.pathExists(migrationsDir);

      if (!hasMigrations) {
        await this.log('마이그레이션 파일 없음, 건너뜀');
        return { status: 'up-to-date' };
      }

      // 3. 마이그레이션 상태 확인
      try {
        const { stdout } = await execa('npx', ['prisma', 'migrate', 'status'], {
          cwd: projectDir,
          timeout: 30000,
        });

        if (stdout.includes('No pending migrations')) {
          await this.log('마이그레이션 최신 상태');
          return { status: 'up-to-date' };
        }
      } catch (error) {
        // migrate status 실패는 진행으로 간주
      }

      // 4. 마이그레이션 실행
      await this.log('마이그레이션 실행 시작');

      if (forceReset) {
        await execa('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-generate'], {
          cwd: projectDir,
          timeout: 60000,
        });
      } else {
        await execa('npx', ['prisma', 'migrate', 'deploy', '--skip-generate'], {
          cwd: projectDir,
          timeout: 60000,
        });
      }

      await this.log('마이그레이션 실행 완료');
      return { status: 'executed' };
    } catch (error: any) {
      await this.logError(error);

      return {
        status: 'failed',
        error: error.message || '마이그레이션 실행 실패',
        recommendations: [
          '1. Prisma 스키마를 확인하세요',
          '2. 데이터베이스 연결이 정상적인지 확인하세요',
          '3. `npx prisma migrate dev`로 수동 실행해 보세요',
        ],
      };
    }
  }

  /**
   * 연결 오류에 대한 권장 사항 반환
   */
  private getRecommendationsForConnectionError(errorCode?: string): string[] {
    if (errorCode === 'P1001' || errorCode === 'P1002' || errorCode === 'P1017') {
      return [
        '1. 데이터베이스 서버가 실행 중인지 확인하세요',
        '2. 호스트와 포트가 올바른지 확인하세요',
        '3. 방화벽 설정을 확인하세요',
        '4. 네트워크 연결을 확인하세요',
      ];
    }

    if (errorCode === 'P1003') {
      return [
        '1. DATABASE_URL의 사용자명과 비밀번호를 확인하세요',
        '2. 데이터베이스 사용자가 존재하는지 확인하세요',
        '3. 사용자 권한을 확인하세요',
      ];
    }

    if (errorCode === 'P1004' || errorCode === 'P1009') {
      return [
        '1. 데이터베이스가 존재하는지 확인하세요',
        '2. `createdb` 명령어로 데이터베이스를 생성하세요',
        '3. DATABASE_URL의 데이터베이스 이름을 확인하세요',
      ];
    }

    return [
      '1. DATABASE_URL을 확인하세요',
      '2. 데이터베이스 서버 상태를 확인하세요',
      '3. Prisma 스키마를 확인하세요',
    ];
  }

  /**
   * 재시도 가능한 에러인지 확인
   */
  private isRetryableError(errorCode?: string): boolean {
    if (!errorCode) return false;

    // 네트워크 관련 에러는 재시도 가능
    const retryableErrors = ['P1001', 'P1002', 'P1006', 'P1008', 'P1017'];
    return retryableErrors.includes(errorCode);
  }
}
