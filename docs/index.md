# MAGIC WAND - 프로젝트 문서

## 프로젝트 개요

**타입:** Monorepo (2개 부분)
**주요 언어:** TypeScript
**아키텍처:** Full-stack Web Application (API + Web)

## 빠른 참조

### apps/api (Backend)
- **타입:** backend
- **기술 스택:** Express, TypeScript, Prisma, PostgreSQL, Redis
- **루트:** apps/api
- **진입점:** src/index.ts

### apps/web (Frontend)
- **타입:** web
- **기술 스택:** Next.js 14, React, TypeScript, Tailwind CSS, Zustand
- **루트:** apps/web
- **진입점:** src/app/page.tsx

## 생성된 문서

- [프로젝트 개요](./project-overview.md) _(To be generated)_
- [아키텍처 - API](./architecture-api.md) _(To be generated)_
- [아키텍처 - Web](./architecture-web.md) _(To be generated)_
- [소스 트리 분석](./source-tree-analysis.md) _(To be generated)_
- [API 계약](./api-contracts-api.md) _(To be generated)_
- [데이터 모델](./data-models.md) _(To be generated)_
- [개발 가이드](./development-guide.md) _(To be generated)_
- [배포 가이드](./deployment-guide.md) _(To be generated)_
- [통합 아키텍처](./integration-architecture.md) _(To be generated)_

## 기존 문서

- [README](../README.md) - 프로젝트 개요, 구조, 시작 가이드
- [PRD](../PRD.md) - 제품 요구사항 문서

## 시작하기

### 필수 조건
- Node.js >= 20.0.0
- pnpm >= 8.0.0
- PostgreSQL (또는 Docker)
- Redis (선택사항)

### 설치

```bash
# 의존성 설치
pnpm install

# 환경변수 설정
cp .env.example .env
# .env 파일에 필요한 값 입력

# 데이터베이스 시작
docker-compose up -d

# Prisma 설정
pnpm db:generate
pnpm db:push

# 개발 서버 실행
pnpm dev
```

### 서비스

- **API:** http://localhost:4000
- **Web:** http://localhost:3000
- **API Health Check:** http://localhost:4000/health

## 기술 스택 요약

### Backend (apps/api)
- Express 4.18.2
- TypeScript 5.3.3
- Prisma ORM
- PostgreSQL
- Redis + Bull (큐)
- Anthropic Claude SDK
- AWS SDK (S3)
- Slack Bolt

### Frontend (apps/web)
- Next.js 14.1.0
- React 18.2.0
- TypeScript 5.3.3
- Tailwind CSS
- Radix UI
- Zustand
- React Hook Form

### 데이터베이스
- PostgreSQL (Prisma ORM)
- Redis (메시징/큐)

### AI/자동화
- Claude Code CLI
- Anthropic Claude API
- 업스테이지 API (문서 파싱)
- GitHub API
- Netlify API

## 패키지 구조

### packages/
- **db** - Prisma 데이터베이스 스키마
- **shared** - 공유 타입 및 유틸리티
- **agent-framework** - Agent 실행 프레임워크
- **agents** - AI 에이전트들
- **claude-orchestrator** - Claude Code 오케스트레이터
- **document-parser** - 업스테이지 문서 파서
- **netlify-deployer** - Netlify 배포 자동화

## 문서화 날짜

생성일: 2026-01-18
스캔 레벨: Exhaustive
총 파일: 22개 소스 파일
총 라인: 5,571 라인
