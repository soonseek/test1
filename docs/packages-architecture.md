# MAGIC WAND - 패키지 아키텍처

## 패키지 구조 개요

**총 패키지:** 7개
- **db** - Prisma 데이터베이스 스키마
- **shared** - 공유 타입 및 유틸리티
- **agent-framework** - Agent 실행 프레임워크
- **agents** - 13개 AI 에이전트 구현
- **claude-orchestrator** - Claude Code 오케스트레이터
- **document-parser** - 업스테이지 문서 파싱
- **netlify-deployer** - Netlify 배포 자동화

---

## 1. packages/db

**용도:** Prisma ORM 데이터베이스 스키마 정의

**구조:**
```
packages/db/
├── prisma/
│   └── schema.prisma    # 전체 데이터베이스 모델
└── package.json
```

**모델:**
- Project
- SessionFile
- SurveyAnswer
- Deployment
- IssueReport
- AgentExecution

**주요 기능:**
- PostgreSQL 스키마 정의
- 타입스크립트 타입 자동 생성
- 데이터베이스 마이그레이션

---

## 2. packages/shared

**용도:** 전체 프로젝트에서 사용하는 공유 타입 정의

**파일:**
- `src/types.ts` - 모든 공유 타입
- `src/index.ts` - 타입 내보내기

**주요 타입:**

### Enumerations
```typescript
enum WizardLevel {
  APPRENTICE    // 인턴 마법사
  SKILLED       // 숙련자 마법사
  ARCHMAGE      // 대마법사
}

enum DesignStyle {
  MINIMAL, MODERN, PLAYFUL, COLORFUL, CUSTOM
}

enum AuthType {
  NONE, EMAIL, SOCIAL
}

enum AgentStatus {
  IDLE, RUNNING, WAITING, COMPLETED, FAILED, RETRYING, CANCELLED
}

enum CompletionMode {
  AUTO_CLOSE, REQUIRES_REVIEW
}
```

### 인터페이스
```typescript
interface AgentConfig {
  agentId: string
  name: string
  role: string
  trigger: AgentTrigger
  completionMode: CompletionMode
  maxRetries: number
  timeout: number
  dependencies: string[]
  contextSharing: ContextSharing
}

interface AgentExecutionResult {
  status: AgentStatus
  output?: any
  error?: {
    message: string
    stackTrace?: string
    retryable: boolean
  }
  attachments?: Attachment[]
  comments?: Comment[]
}

interface UploadedFile {
  id: string
  s3Key: string
  fileName: string
  fileType: string
  fileSize: number
  description: string
  parsedText?: string
  parsedLayout?: any
  parsedTables?: any
  confidence?: number
}
```

---

## 3. packages/agent-framework

**용도:** Agent 실행을 위한 코어 프레임워크

**파일:**
- `src/agent.ts` - Agent 베이스 클래스
- `src/event-bus.ts` - 이벤트 버스
- `src/orchestrator.ts` - Agent 오케스트레이터
- `src/index.ts` - 내보내기

### Agent 베이스 클래스

```typescript
export abstract class Agent {
  protected config: AgentConfig
  protected status: AgentStatus
  protected retryCount: number
  protected context: Map<string, any>

  abstract execute(input: any): Promise<AgentExecutionResult>

  getId(): string
  getName(): string
  getStatus(): AgentStatus
  setStatus(status: AgentStatus): void
  getConfig(): AgentConfig
  getCompletionMode(): CompletionMode
}
```

**주요 기능:**
- Agent 라이프사이클 관리
- 상태 추적 (IDLE → RUNNING → COMPLETED/FAILED)
- 로깅 (Pino)
- 재시도 로직
- 컨텍스트 공유

---

## 4. packages/agents

**용도:** 13개 AI 에이전트 구현

**구조:**
```
packages/agents/
└── src/
    └── agents/
        ├── RequirementAnalyzerAgent.ts   # PRD 분석
        ├── EpicStoryAgent.ts             # Epic & Story 생성
        ├── ScrumMasterAgent.ts           # Task 관리
        ├── DeveloperAgent.ts             # 코드 개발
        ├── CodeReviewerAgent.ts          # 코드 리뷰
        ├── TesterAgent.ts                # 테스트
        ├── PromptBuilderAgent.ts         # 프롬프트 빌딩
        ├── CodeGeneratorAgent.ts         # 코드 생성
        ├── GitHubPusherAgent.ts          # GitHub 푸시
        ├── NetlifyDeployerAgent.ts       # Netlify 배포
        ├── E2ETestRunnerAgent.ts         # E2E 테스트
        ├── IssueResolverAgent.ts         # 이슈 해결
        └── DocumentParserAgent.ts        # 문서 파싱
```

### Agent 실행 흐름

```
1. RequirementAnalyzerAgent
   ↓ (survey.submitted 이벤트)
2. EpicStoryAgent
   ↓ (requirement.completed 이벤트)
3. ScrumMasterAgent
   ↓ (epic-story.completed 이벤트)
4. DeveloperAgent → CodeReviewerAgent → TesterAgent
   ↓ (task.completed 이벤트)
5. PromptBuilderAgent → CodeGeneratorAgent
   ↓ (code.generated 이벤트)
6. GitHubPusherAgent
   ↓ (github.pushed 이벤트)
7. NetlifyDeployerAgent
   ↓ (deployment.created 이벤트)
8. E2ETestRunnerAgent
```

### 주요 Agent 상세

#### RequirementAnalyzerAgent
- **역할:** PRD (제품 요구사항 문서) 생성
- **입력:** 프로젝트 정보, 파일들, 설문조사
- **출력:** 3개 PRD 옵션 (Conservative, Standard, Aggressive)
- **LLM:** Claude Opus 4.5
- **타임아웃:** 10분

#### EpicStoryAgent
- **역할:** Epic & Story 생성
- **입력:** 선택된 PRD
- **출력:** Epic 목록, Story 목록, Markdown 파일
- **LLM:** Claude Sonnet 4.5
- **타임아웃:** 30분

#### DeveloperAgent
- **역할:** Task 수행 및 코드 개발
- **입력:** Task, PRD, Story
- **출력:** 생성된 파일, 변경사항
- **LLM:** Claude Sonnet 4.5
- **타임아웃:** 60분

#### GitHubPusherAgent
- **역할:** GitHub 레포지토리 생성 및 코드 푸시
- **입력:** 프로젝트 디렉토리, GitHub PAT
- **출력:** GitHub URL

#### NetlifyDeployerAgent
- **역할:** Netlify 배포
- **입력:** GitHub URL, Netlify Token
- **출력:** 배포 URL

---

## 5. packages/claude-orchestrator

**용도:** Claude Code CLI와 연동하여 Agent들을 오케스트레이션

**주요 기능:**
- Claude Code 프로토콜 통합
- Agent 실행 스케줄링
- 컨텍스트 관리
- 에러 핸들링 및 재시도

---

## 6. packages/document-parser

**용도:** 업스테이지 API를 통한 문서 파싱

**주요 기능:**
- PDF 파싱
- 이미지 파싱 (PNG, JPG)
- 텍스트 추출
- 레이아웃 분석
- 테이블 추출

---

## 7. packages/netlify-deployer

**용도:** Netlify 배포 자동화

**주요 기능:**
- Netlify 사이트 생성
- GitHub 레포지토리 연결
- 배포 트리거
- 배포 상태 모니터링

---

## 패키지 간 의존성

```
apps/api ─┬─→ packages/db
           ├─→ packages/shared
           ├─→ packages/agent-framework
           ├─→ packages/agents
           └─→ packages/document-parser

apps/web ─┬─→ packages/shared
           └─→ packages/db

packages/agents ─┬─→ packages/shared
                 ├─→ packages/agent-framework
                 └─→ packages/db

packages/agent-framework ─→ packages/shared

packages/document-parser ─→ packages/shared
```

---

## 공통 패턴

### Agent 구현 패턴

모든 Agent는 다음을 구현해야 합니다:

```typescript
export class MyAgent extends Agent {
  constructor() {
    super({
      agentId: 'my-agent',
      name: 'My Agent',
      role: 'Agent 설명',
      trigger: {
        type: 'event',
        event: 'event.name',
      },
      completionMode: CompletionMode.AUTO_CLOSE,
      maxRetries: 3,
      timeout: 3600,
      dependencies: ['dependency-agent'],
      contextSharing: {
        sharesTo: ['next-agent'],
        data: ['output-key'],
      },
    });
  }

  async execute(input: any): Promise<AgentExecutionResult> {
    try {
      await this.log('작업 시작');

      // 작업 수행

      await this.log('작업 완료');
      return {
        status: AgentStatus.COMPLETED,
        output: result,
      };
    } catch (error) {
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

  private isRetryable(error: any): boolean {
    return error.message?.includes('timeout') ||
           error.message?.includes('rate limit');
  }
}
```

---

## 사용 방법

### Agent 사용

```typescript
import { getOrchestrator } from '@magic-wand/agent-framework';
import { DeveloperAgent } from '@magic-wand/agents';

const orchestrator = getOrchestrator();
orchestrator.runAgent('developer', projectId, inputData);
```

### 공유 타입 사용

```typescript
import { WizardLevel, AgentStatus, UploadedFile } from '@magic-wand/shared';

const level: WizardLevel = WizardLevel.APPRENTICE;
const status: AgentStatus = AgentStatus.RUNNING;
```

### Prisma 사용

```typescript
import { prisma } from '@magic-wand/db';

const projects = await prisma.project.findMany();
```

---

## 다음 단계

- [Agent 개발 가이드](./agent-development-guide.md) _(To be generated)_
- [API 계약](./api-contracts-api.md)
- [데이터 모델](./data-models.md)
