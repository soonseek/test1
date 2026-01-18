# MAGIC WAND - 소스 트리 분석

## 프로젝트 루트

```
magic-wand/
├── apps/                        # 애플리케이션들
│   ├── api/                    # Express 백엔드 API (Part: api)
│   │   ├── src/
│   │   │   ├── routes/         # REST API 엔드포인트
│   │   │   │   ├── projects.ts         # 프로젝트 CRUD
│   │   │   │   ├── magic.ts            # MVP 생성 워크플로우
│   │   │   │   ├── survey.ts           # 설문조사 관리
│   │   │   │   ├── survey-chat.ts      # AI 채팅 설문조사
│   │   │   │   ├── upload.ts           # 파일 업로드 (S3)
│   │   │   │   ├── issues.ts           # 이슈 리포트 (Slack)
│   │   │   │   └── projects-from-prompt.ts  # 프롬프트로 프로젝트 생성
│   │   │   ├── controllers/     # 비즈니스 로직 컨트롤러
│   │   │   ├── middleware/      # Express 미들웨어
│   │   │   ├── services/        # 서비스 계층
│   │   │   ├── orchestrator.ts  # Agent 오케스트레이터 → Calls agents/
│   │   │   └── index.ts         # 서버 진입점 → Port 4000
│   │   └── package.json
│   │
│   └── web/                    # Next.js 프론트엔드 (Part: web)
│       ├── src/
│       │   ├── app/            # Next.js App Router
│       │   │   ├── layout.tsx           # 루트 레이아웃
│       │   │   ├── page.tsx             # 홈 페이지
│       │   │   ├── project/
│       │   │   │   ├── [id]/
│       │   │   │   │   ├── survey/      # 설문조사 페이지
│       │   │   │   │   ├── magic/       # MVP 생성 진행 페이지
│       │   │   │   │   │   └── components/  # Magic 페이지 컴포넌트들
│       │   │   │   │   │       ├── EpicStoryView.tsx
│       │   │   │   │   │       ├── DevelopmentView.tsx
│       │   │   │   │   │       ├── DebuggingView.tsx
│       │   │   │   │   │       └── FeatureAdditionView.tsx
│       │   │   │   │   └── new/         # 새 프로젝트 생성
│       │   │   ├── globals.css          # 전역 스타일
│       │   │   └── favicon.ico
│       │   ├── components/      # 재사용 컴포넌트
│       │   │   ├── HeroSection.tsx
│       │   │   ├── ProjectCard.tsx
│       │   │   └── ProjectCardSkeleton.tsx
│       │   └── types/           # TypeScript 타입 정의
│       │       └── global.d.ts
│       ├── public/              # 정적 리소스
│       ├── next.config.js       # Next.js 설정
│       ├── tailwind.config.ts   # Tailwind CSS 설정
│       └── package.json
│
├── packages/                    # 공유 패키지 (Monorepo)
│   ├── db/                     # Prisma 스키마
│   │   └── prisma/
│   │       └── schema.prisma   # 데이터베이스 모델 정의
│   ├── shared/                 # 공유 타입 및 유틸리티
│   ├── agent-framework/        # Agent 실행 프레임워크
│   ├── agents/                 # AI 에이전트 구현
│   │   └── src/
│   │       └── agents/
│   │           ├── DeveloperAgent.ts
│   │           ├── EpicStoryAgent.ts
│   │           ├── RequirementAnalyzerAgent.ts
│   │           ├── ScrumMasterAgent.ts
│   │           ├── TesterAgent.ts
│   │           └── ... (기타 에이전트들)
│   ├── claude-orchestrator/    # Claude Code 오케스트레이터
│   ├── document-parser/        # 문서 파싱 (업스테이지)
│   └── netlify-deployer/       # Netlify 배포 자동화
│
├── docs/                       # 프로젝트 문서 (이 폴더)
├── _bmad/                      # BMAD 워크플로우 설정
├── _bmad-output/               # BMAD 출력물
├── .env.example                # 환경변수 예제
├── docker-compose.yml          # PostgreSQL + Redis
├── pnpm-workspace.yaml         # PNPM 워크스페이스
├── package.json                # 루트 패키지 설정
├── tsconfig.json               # TypeScript 설정
├── README.md                   # 프로젝트 개요
└── PRD.md                      # 제품 요구사항 문서
```

## 핵심 디렉토리 설명

### apps/api/src/routes/
**용도:** REST API 엔드포인트 정의
**주요 파일:**
- `projects.ts` - 프로젝트 CRUD (7개 엔드포인트)
- `magic.ts` - MVP 생성 워크플로우 (9개 엔드포인트)
- `survey.ts` - 설문조사 관리 (5개 엔드포인트)
- `upload.ts` - S3 파일 업로드 (3개 엔드포인트)

### apps/web/src/app/
**용도:** Next.js App Router 페이지
**주요 파일:**
- `page.tsx` - 홈 페이지 (프로젝트 목록)
- `project/[id]/magic/page.tsx` - MVP 생성 진행 상황

### packages/db/prisma/
**용도:** 데이터베이스 스키마 정의
**모델:** Project, SessionFile, SurveyAnswer, Deployment, IssueReport, AgentExecution

## 진입점

### API
- **파일:** `apps/api/src/index.ts`
- **포트:** 4000
- **경로:** `/api/*`

### Web
- **파일:** `apps/web/src/app/page.tsx`
- **포트:** 3000
- **경로:** `/*`

## 통합 포인트

### API → Web 통신
- Web은 `http://localhost:4000/api/*`로 API 호출
- API는 Express, Web는 Next.js 별도 서버
- 공통 데이터: PostgreSQL DB (Prisma)

### Agent 오케스트레이션
1. Web → API: `/api/magic/start` (MVP 생성 시작)
2. API → Orchestrator: `orchestrator.runMagic()`
3. Orchestrator → Agents: 순차적 Agent 실행
4. Agents → DB: 결과 저장 (AgentExecution 테이블)
5. Web → API: 주기적 상태 조회 (`/api/magic/status/:projectId`)

## 배포 아키텍처

### 개발 환경
- API: localhost:4000
- Web: localhost:3000
- DB: localhost:5432 (PostgreSQL)
- Redis: localhost:6379

### 프로덕션 (Netlify)
- Web: Netlify Edge Functions
- API: 별도 서버 필요 (또는 Netlify Functions)
- DB: Netlify DB (Neon Postgres) - 자동 생성
- Redis: 외부 서비스 (예: Upstash Redis)
