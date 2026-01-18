# MAGIC WAND - 통합 아키텍처

## 시스템 아키텍처 개요

**아키텍처 타입:** Monorepo (pnpm workspace)
**프로젝트 유형:** Full-stack Web Application
**배포:** Netlify (Web) + 별도 서버 (API)

---

## 고수준 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                        사용자                                │
│                  (Web Browser)                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ HTTPS
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Netlify Edge (CDN)                              │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Next.js 14 App (Static + Serverless Functions)      │  │
│  │                                                       │  │
│  │  - React 18 Components                               │  │
│  │  - Tailwind CSS + shadcn/ui                          │  │
│  │  - Zustand (State)                                   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ API Calls (/api/*)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              API Server (Express)                           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  REST API Routes                                     │  │
│  │                                                       │  │
│  │  - /api/projects (CRUD)                              │  │
│  │  - /api/magic/* (MVP 워크플로우)                       │  │
│  │  - /api/survey/* (설문조사)                          │  │
│  │  - /api/upload/* (파일 업로드)                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  MagicOrchestrator (Agent 오케스트레이터)            │  │
│  │                                                       │  │
│  │  - Agent 실행 스케줄링                              │  │
│  │  - 상태 관리                                         │  │
│  │  - 에러 핸들링                                       │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
  ┌─────────┐  ┌─────────┐  ┌─────────────┐
  │Prisma ORM│  │  Redis  │  │ AWS S3      │
  │         │  │  (Bull) │  │             │
  └────┬────┘  └────┬────┘  └─────────────┘
       │            │
       ▼            ▼
  ┌──────────────────────────┐
  │    PostgreSQL            │
  │    (Netlify DB)          │
  │                          │
  │  - Projects              │
  │  - SessionFiles          │
  │  - SurveyAnswers         │
  │  - Deployments           │
  │  - IssueReports          │
  │  - AgentExecutions       │
  └──────────────────────────┘
```

---

## 컴포넌트 상세

### 1. Web Frontend (apps/web)

**기술 스택:**
- Next.js 14.1.0 (App Router)
- React 18.2.0
- TypeScript 5.3.3
- Tailwind CSS
- Radix UI
- Zustand
- React Hook Form

**주요 컴포넌트:**

```
apps/web/src/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # 루트 레이아웃
│   ├── page.tsx                  # 홈 페이지
│   ├── project/[id]/
│   │   ├── survey/               # 설문조사 페이지
│   │   └── magic/                # MVP 생성 진행 페이지
│   └── globals.css              # 전역 스타일
├── components/                   # 재사용 컴포넌트
│   ├── HeroSection.tsx
│   ├── ProjectCard.tsx
│   └── ProjectCardSkeleton.tsx
└── types/                        # 타입 정의
    └── global.d.ts
```

**상태 관리:**
- React useState (로컬 상태)
- Zustand (전역 상태 - 추후 추가 예정)

**API 통신:**
- Fetch API
- WebSocket (SSE - Server-Sent Events) for real-time updates

---

### 2. API Backend (apps/api)

**기술 스택:**
- Express 4.18.2
- TypeScript 5.3.3
- Prisma ORM
- PostgreSQL
- Redis (Bull Queue)

**주요 라우트:**

```
apps/api/src/
├── routes/
│   ├── projects.ts              # 프로젝트 CRUD
│   ├── magic.ts                 # MVP 생성 워크플로우
│   ├── survey.ts                # 설문조사 관리
│   ├── survey-chat.ts           # AI 채팅 설문조사
│   ├── upload.ts                # S3 파일 업로드
│   ├── issues.ts                # 이슈 리포트
│   └── projects-from-prompt.ts # 프롬프트로 프로젝트 생성
├── orchestrator.ts              # Agent 오케스트레이터
└── index.ts                     # 서버 진입점
```

**미들웨어:**
- Helmet (보안)
- CORS
- Compression
- Body Parser

---

### 3. Agent System

**Agent Framework:**
- 베이스 Agent 클래스
- 이벤트 버스
- 오케스트레이터

**13개 Agents:**
1. RequirementAnalyzer - PRD 생성
2. EpicStory - Epic & Story 생성
3. ScrumMaster - Task 관리
4. Developer - 코드 개발
5. CodeReviewer - 코드 리뷰
6. Tester - 테스트
7. PromptBuilder - 프롬프트 빌딩
8. CodeGenerator - 코드 생성
9. GitHubPusher - GitHub 푸시
10. NetlifyDeployer - Netlify 배포
11. E2ETestRunner - E2E 테스트
12. IssueResolver - 이슈 해결
13. DocumentParser - 문서 파싱

**Agent 실행 순서:**
```
RequirementAnalyzer
  ↓
EpicStory
  ↓
ScrumMaster
  ↓
Developer → CodeReviewer → Tester
  ↓
PromptBuilder → CodeGenerator
  ↓
GitHubPusher
  ↓
NetlifyDeployer
  ↓
E2ETestRunner
```

---

### 4. Database Layer

**ORM:** Prisma
**데이터베이스:** PostgreSQL

**주요 모델:**

```prisma
model Project {
  id            String   @id @default(cuid())
  name          String
  description   String   @db.Text
  wizardLevel   WizardLevel @default(APPRENTICE)
  isArchived    Boolean  @default(false)

  epicMarkdown  String?  @db.Text
  storyFiles    Json?

  sessionFiles  SessionFile[]
  surveyAnswer  SurveyAnswer?
  deployment    Deployment?
  issueReports  IssueReport[]
  agentExecutions AgentExecution[]

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model AgentExecution {
  id              String   @id @default(cuid())
  projectId       String

  agentId         String
  agentName       String
  status          AgentStatus @default(RUNNING)

  startedAt       DateTime @default(now())
  completedAt     DateTime?
  retryCount      Int      @default(0)

  input           Json
  output          Json?
  error           Json?

  project         Project  @relation(fields: [projectId], references: [id])
}
```

---

### 5. External Services

**AWS S3:**
- 파일 업로드 (Presigned URL)
- 문서 저장
- 정적 리소스

**Anthropic Claude:**
- PRD 분석
- Epic/Story 생성
- 코드 생성
- AI 채팅

**Upstage:**
- 문서 파싱 (PDF, 이미지)
- 텍스트 추출
- 레이아웃 분석

**GitHub:**
- 레포지토리 생성
- 코드 푸시
- 형상관리

**Netlify:**
- 사이트 배포
- Serverless Functions
- Netlify DB (PostgreSQL)

**Slack:**
- 이슈 리포트 수신
- 알림 발송

---

## 데이터 흐름

### 1. 프로젝트 생성 흐름

```
1. 사용자가 프롬프트 입력
   ↓
2. POST /api/projects/from-prompt
   ↓
3. Claude가 프로젝트명/설명 생성
   ↓
4. Prisma에 Project 저장
   ↓
5. 사용자를 설문조사 페이지로 리다이렉트
```

### 2. MVP 생성 흐름

```
1. 사용자가 설문조사 완료
   ↓
2. POST /api/magic/start
   ↓
3. Orchestrator가 Agent 순차적 실행
   ↓
4. Agent 실행 결과를 DB에 저장
   ↓
5. Web이 주기적으로 상태 조회 (3초마다)
   ↓
6. 진행 상황을 실시간 표시
```

### 3. 배포 흐름

```
1. 개발 완료
   ↓
2. POST /api/magic/github/create-repo
   ↓
3. GitHubPusherAgent가 레포지토리 생성 및 코드 푸시
   ↓
4. POST /api/magic/deploy
   ↓
5. NetlifyDeployerAgent가 사이트 생성 및 배포
   ↓
6. 배포 URL 반환
```

---

## 통신 패턴

### 1. Web → API 통신

**HTTP/REST:**
```typescript
// 프로젝트 목록 조회
const response = await fetch('http://localhost:4000/api/projects');
const data = await response.json();
```

**SSE (Server-Sent Events):**
```typescript
// 실시간 Agent 상태 업데이트
const eventSource = new EventSource('http://localhost:4000/api/magic/logs/:projectId');
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Agent status:', data);
};
```

### 2. Agent → Agent 통신

**이벤트 기반:**
```typescript
// Event Bus를 통한 Agent 간 통신
await eventBus.publish('requirement.completed', {
  projectId,
  prdOptions
});
```

**직접 호출:**
```typescript
// Orchestrator를 통한 직접 실행
await orchestrator.runAgent('developer', projectId, inputData);
```

### 3. API → Database

**Prisma ORM:**
```typescript
// 프로젝트 조회
const project = await prisma.project.findUnique({
  where: { id: projectId },
  include: {
    sessionFiles: true,
    surveyAnswer: true,
    agentExecutions: true,
  },
});
```

---

## 보안 아키텍처

### 1. 인증/인가

**현재:** 구현되지 않음 (추후 예정)

**계획:**
- JWT 토큰 기반 인증
- RBAC (Role-Based Access Control)

### 2. 데이터 보호

**전송:**
- HTTPS (TLS 1.3+)

**저장:**
- PostgreSQL 암호화
- 환경변수로 API 키 관리

### 3. 입력 검증

**백엔드:**
- Zod 스키마 검증
- SQL Injection 방지 (Prisma ORM)
- XSS 방지

---

## 확장성

### 1. 수평 확장

**Web:**
- Netlify Edge Functions (자동 스케일링)
- CDN (전 세계 분산)

**API:**
- Kubernetes (추후 지원)
- Docker 컨테이너

### 2. 수직 확장

**Database:**
- PostgreSQL Read Replicas
- Connection Pooling

**Queue:**
- Redis Cluster
- Bull Queue 레플리카

---

## 모니터링

### 1. 로그

**Pino Logger:**
- 구조화된 로그
- 로그 레벨 (debug, info, warn, error)
- 파일 출력 (추후)

### 2. 메트릭

**계획:**
- Agent 실행 시간
- API 응답 시간
- 에러율
- 리소스 사용량

---

## 다음 단계

- [API 계약](./api-contracts-api.md)
- [데이터 모델](./data-models.md)
- [배포 가이드](./deployment-guide.md)
