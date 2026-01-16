# MAGIC WAND 🪄

프리랜서 웹 개발자를 위한 MVP 자동 생성 플랫폼

## 📁 프로젝트 구조

```
magic-wand/
├── apps/
│   ├── web/              # Next.js 모바일 웹 프론트엔드
│   └── api/              # Express 백엔드 API 서버
├── packages/
│   ├── db/               # Prisma 데이터베이스 스키마
│   ├── shared/           # 공유 타입 및 유틸리티
│   ├── agent-framework/  # Agent 실행 프레임워크
│   ├── document-parser/  # 업스테이지 문서 파서
│   ├── claude-orchestrator/ # Claude Code 오케스트레이터
│   └── netlify-deployer/ # Netlify 배포 자동화
├── .env                  # 환경변수 (직접 생성 필요)
├── pnpm-workspace.yaml   # PNPM 워크스페이스 설정
└── package.json          # 루트 패키지 설정
```

## 🚀 시작하기

### 1. 환경변수 설정

```bash
cp .env.example .env
# .env 파일에 실제 값 입력
```

### 2. 의존성 설치

```bash
pnpm install
```

### 3. Docker로 데이터베이스 & Redis 시작

```bash
# Postgres와 Redis 컨테이너 시작
docker-compose up -d

# 확인
docker ps
```

### 4. 데이터베이스 설정

```bash
# Prisma Client 생성
cd packages/db
pnpm prisma generate

# 데이터베이스 스키마 푸시
# (해당 위치에 .env 파일 만든 후 DATABASE_URL 입력)
pnpm prisma db push
```

### 5. 개발 서버 실행

```bash
# API 서버 (Port 4000)
pnpm api:dev

# Web 서버 (Port 3000)
pnpm web:dev

# 또는 모두 한 번에
pnpm dev
```

## 🏗️ 기술 스택

### Frontend
- Next.js 14 (App Router)
- shadcn/ui
- Tailwind CSS
- TypeScript

### Backend
- Express
- Prisma
- Postgres
- Redis
- TypeScript

### AI/Automation
- Claude Code CLI
- 업스테이지 API (문서 파싱)
- GitHub API
- Netlify API
- Slack API

## 📖 문서

- [PRD](./PRD.md) - 제품 요구사항 문서
- [Architecture](./docs/ARCHITECTURE.md) - 아키텍처 (준비 중)
- [API Docs](./docs/API.md) - API 문서 (준비 중)

## 🤝 기여

이 프로젝트는 개인용으로 개발되었습니다.

## 📄 라이선스

MIT
