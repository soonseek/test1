# MAGIC WAND - Agent 상세 가이드

## Agent 개요

**총 Agent:** 13개
**실행 순서:** 순차적 실행 (이벤트 기반 트리거)
**오케스트레이션:** MagicOrchestrator (apps/api/src/orchestrator.ts)

---

## Agent 실행 파이프라인

```
1. RequirementAnalyzerAgent (요구사항 분석)
   ↓ survey.submitted 이벤트

2. EpicStoryAgent (Epic & Story 생성)
   ↓ requirement.completed 이벤트

3. ScrumMasterAgent (Task 관리)
   ↓ epic-story.completed 이벤트

4. DeveloperAgent (개발)
   ↓ task.assigned 이벤트

5. CodeReviewerAgent (코드 리뷰)
   ↓ development.completed 이벤트

6. TesterAgent (테스트)
   ↓ code-review.completed 이벤트

7. PromptBuilderAgent (프롬프트 빌딩)
   ↓ testing.completed 이벤트

8. CodeGeneratorAgent (코드 생성)
   ↓ prompt-built 이벤트

9. GitHubPusherAgent (GitHub 푸시)
   ↓ code.generated 이벤트

10. NetlifyDeployerAgent (Netlify 배포)
    ↓ github.pushed 이벤트

11. E2ETestRunnerAgent (E2E 테스트)
    ↓ deployment.completed 이벤트

12. IssueResolverAgent (이슈 해결)
    ↓ issue.reported 이벤트 (이슈 발생 시)

13. DocumentParserAgent (문서 파싱)
    ↓ file.uploaded 이벤트
```

---

## 개별 Agent 상세

### 1. RequirementAnalyzerAgent

**파일:** `packages/agents/src/agents/RequirementAnalyzerAgent.ts`

**역할:**
- 프로젝트 요구사항 심층 분석
- PRD (제품 요구사항 문서) 생성
- 복잡도 및 예상 시간 산정

**입력:**
```typescript
{
  projectId: string
  project: {
    name: string
    description: string
    wizardLevel: WizardLevel
  }
  files: UploadedFile[]
  survey?: SurveyAnswer
}
```

**출력:**
```typescript
{
  prdOptions: [
    {
      id: 'conservative'
      name: '보수형 (MVP)'
      description: '핵심 기능에 집중하여 빠르게 출시'
      analysisMarkdown: string  // 전체 PRD 마크다운
      analysis: {
        businessRequirements: {...}
        functionalRequirements: [...]
        nonFunctionalRequirements: {...}
        technicalRequirements: {...}
        riskAssessment: [...]
      }
    },
    {
      id: 'standard'
      name: '표준형 (Standard)'
      ...
    },
    {
      id: 'aggressive'
      name: '적극형 (Full-featured)'
      ...
    }
  ]
  summary: {
    complexityScore: number
    estimatedTime: {
      minutes: number
      muggleEquivalent: string
    }
    totalRequirements: number
  }
}
```

**LLM:** Claude Opus 4.5
**타임아웃:** 10분
**최대 재시도:** 3회

**특징:**
- 3개의 다른 PRD 옵션 생성
- 기술 스택 고정 (Next.js 14+, shadcn/ui, Prisma + PostgreSQL, Netlify)
- 복잡도 점수화 (1-100)
- 예상 시간 계산 (머글 기준 공수)

---

### 2. EpicStoryAgent

**파일:** `packages/agents/src/agents/EpicStoryAgent.ts`

**역할:**
- Epic 생성 (큰 기능 그룹)
- Story 생성 (2-5분 태스크)
- Markdown 문서 생성

**입력:**
```typescript
{
  projectId: string
  project: {...}
  selectedPRD: PRDOption
}
```

**출력:**
```typescript
{
  epics: [
    {
      id: 'epic-1-user-authentication'
      fileName: 'epic-1-user-authentication.md'
      title: '사용자 인증 및 계정 관리'
      description: string
      priority: 'high' | 'medium' | 'low'
      order: 1
      markdown: string  // Epic.md 내용
    }
  ]
  stories: [
    {
      id: 'story-1-1-login-page'
      fileName: 'story-1-1-login-page.md'
      epicId: 'epic-1'
      title: '로그인 페이지 구현'
      description: string
      acceptanceCriteria: string[]
      storyPoints: number
      priority: 'high' | 'medium' | 'low'
      order: 1
      epicOrder: 1
      markdown: string  // Story.md 내용
    }
  ]
  summary: {
    totalEpics: number
    totalStories: number
    totalStoryPoints: number
  }
}
```

**LLM:** Claude Sonnet 4.5
**타임아웃:** 30분
**최대 재시도:** 3회

**특징:**
- 실시간 진행 상황 업데이트
- Epic 생성 후 즉시 UI 반영
- 각 Epic마다 Story 생성
- 파일 시스템에 Epic.md, Story 파일들 저장
- BMad Method + Moai ADK 기반 Story 분해

---

### 3. ScrumMasterAgent

**역할:**
- Task 목록 생성
- Task 우선순위 지정
- Story → Task 변환

**입력:**
- Epic & Story 결과
- PRD

**출력:**
```typescript
{
  tasks: [
    {
      id: 'task-1'
      storyId: 'story-1-1'
      title: string
      description: string
      priority: 'high' | 'medium' | 'low'
      status: 'pending' | 'in_progress' | 'completed' | 'failed'
      estimatedMinutes: number
      dependencies: string[]
    }
  ]
  summary: {
    totalTasks: number
    totalEstimatedMinutes: number
  }
}
```

---

### 4. DeveloperAgent

**파일:** `packages/agents/src/agents/DeveloperAgent.ts`

**역할:**
- Task 수행
- 코드 개발
- 파일 생성/수정

**입력:**
```typescript
{
  projectId: string
  project: {...}
}
```

**출력:**
```typescript
{
  currentPhase: 'development' | 'completed'
  currentTask?: {
    id: string
    title: string
    description: string
  }
  completedTasks: string[]
  generatedFiles: [
    {
      path: string  // apps/web/src/app/login/page.tsx
      content: string
      type: 'component' | 'page' | 'api' | 'util' | 'other'
    }
  ]
  changes: [
    {
      file: string
      diff: string
    }
  ]
  summary: {
    totalTasksCompleted: number
    filesCreated: number
    filesModified: number
  }
}
```

**LLM:** Claude Sonnet 4.5
**타임아웃:** 60분
**최대 재시도:** 3회

**특징:**
- Scrum Master가 생성한 Task 목록 로드
- pending 상태인 첫 번째 Task 선택
- PRD, Story 컨텍스트 기반 코드 생성
- shadcn/ui 컴포넌트 활용
- 파일 시스템에 코드 저장
- diff 생성

**프로젝트 구조:**
```
projects/<projectId>/
  apps/
    web/
      src/
        app/          # Next.js App Router pages
        components/   # React components
        lib/          # Utilities
    api/
      src/
        routes/       # API routes
        lib/          # Utilities
  docs/               # Documentation
```

---

### 5. CodeReviewerAgent

**역할:**
- 생성된 코드 리뷰
- 버그 발견
- 개선사항 제안

---

### 6. TesterAgent

**역할:**
- 테스트 계획 수립
- 테스트 케이스 생성
- 테스트 수행

---

### 7. PromptBuilderAgent

**역할:**
- 개발 컨텍스트를 프롬프트로 변환
- Code Generator를 위한 입력 생성

---

### 8. CodeGeneratorAgent

**역할:**
- 최종 코드 생성
- 템플릿 적용
- 최적화

---

### 9. GitHubPusherAgent

**역할:**
- GitHub 레포지토리 생성
- 코드 푸시
- 커밋 생성

**입력:**
```typescript
{
  projectId: string
  codeDirectory: string
  githubRepoUrl: string
  githubPat: string
  commitMessage: string
}
```

**출력:**
```typescript
{
  repoUrl: string
  commitHash: string
  branch: string
}
```

---

### 10. NetlifyDeployerAgent

**역할:**
- Netlify 사이트 생성
- GitHub 레포지토리 연결
- 배포 트리거
- 배포 상태 모니터링

**입력:**
```typescript
{
  projectId: string
  githubRepoUrl: string
  githubBranch: string
  subdomain: string
  netlifyAuthToken: string
}
```

**출력:**
```typescript
{
  siteId: string
  deploymentUrl: string
  status: 'PENDING' | 'IN_PROGRESS' | 'DEPLOYED' | 'FAILED'
  logs: any
}
```

---

### 11. E2ETestRunnerAgent

**역할:**
- E2E 테스트 실행
- 배포 검증
- 회귀 테스트

---

### 12. IssueResolverAgent

**역할:**
- Slack에서 이슈 수신
- 이슈 분석
- 자동 수정 시도

---

### 13. DocumentParserAgent

**역할:**
- 업로드된 파일 파싱
- 텍스트 추출
- 구조 분석

**입력:**
```typescript
{
  s3Key: string
  fileType: string
}
```

**출력:**
```typescript
{
  success: boolean
  parsedDocument?: {
    text: string
    layout: any
    tables: any
    confidence: number
  }
  error?: string
}
```

---

## Agent 재시도 정책

모든 Agent는 `isRetryable()` 메서드를 구현:

```typescript
private isRetryable(error: any): boolean {
  return error.message?.includes('timeout') ||
         error.message?.includes('rate limit') ||
         error.code === 'ECONNRESET';
}
```

**재시도 가능한 에러:**
- 타임아웃
- Rate limit (429)
- 네트워크 에러 (ECONNRESET)
- 서버 에러 (500+)

**재시도 불가능한 에러:**
- 잘못된 입력 (400)
- 찾을 수 없음 (404)
- 인증 실패 (401, 403)

---

## Agent 상태 관리

### 상태 전이

```
IDLE → RUNNING → COMPLETED
                ↘ FAILED → RETRYING → RUNNING → ...
                                            ↘ FAILED
```

### 상태 모니터링

**API:** `GET /api/magic/status/:projectId`

**응답:**
```typescript
{
  agentStatus: {
    total: number
    completed: number
    running: number
    failed: number
    pending: number
  }
  currentAgent?: {
    agentId: string
    agentName: string
    status: string
  }
  overallStatus: 'processing' | 'completed' | 'failed'
}
```

---

## Agent 실행 제어

### Agent 시작

```typescript
// 전체 워크플로우 시작
POST /api/magic/start
{
  projectId: string
}

// 특정 Agent 재시작
POST /api/magic/restart/:projectId/:agentId
```

### Agent 진행 상황 조회

```typescript
// 실시간 로그 스트리밍
GET /api/magic/logs/:projectId

// 현재 실행 중인 Agent의 활동 로그
GET /api/magic/activity/:projectId
```

---

## Agent 컨텍스트 공유

Agent 간 데이터 공유를 위한 `contextSharing`:

```typescript
contextSharing: {
  sharesTo: ['epic-story', 'developer']  // 데이터를 받을 Agent들
  data: ['epics', 'stories']              // 공유할 데이터 키
}
```

**예시:**
- RequirementAnalyzer → EpicStory: `prdOptions`, `selectedPRD`
- EpicStory → Developer: `epics`, `stories`
- Developer → CodeReviewer: `generatedFiles`, `changes`

---

## 다음 단계

- [Agent 개발 튜토리얼](./agent-tutorial.md) _(To be generated)_
- [API 계약](./api-contracts-api.md)
- [패키지 아키텍처](./packages-architecture.md)
