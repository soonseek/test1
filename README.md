# MAGIC WAND 🪄

모두를 위한 MVP 자동 생성 플랫폼

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

### 3. 데이터베이스 & Redis 시작

#### 옵션 A: Docker 사용 (권장)

```bash
# Postgres와 Redis 컨테이너 시작
docker-compose up -d

# 확인
docker ps
```

#### 옵션 B: 로컬 PostgreSQL 사용

이미 로컬에 PostgreSQL이 설치되어 있는 경우:

```bash
# 데이터베이스 생성
createdb magic_wand

# .env 파일에 DATABASE_URL 설정
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/magic_wand?schema=public"
```

### 4. Prisma 설정

```bash
# Prisma Client 생성
cd packages/db
pnpm prisma generate

# 데이터베이스 스키마 푸시
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
- Anthropic Claude API
- 업스테이지 API (문서 파싱)
- GitHub API
- Netlify API (Netlify DB 지원)
- Slack API

## 🚢 배포 가이드

### Netlify 배포 시 DB 설정

이 프로젝트는 **@netlify/neon** 패키지를 통해 Netlify DB를 자동으로 설정합니다.

#### 배포 과정

1. **배포 버튼 클릭**: Magic 페이지에서 "🚀 배포" 버튼 클릭
2. **자동 DB 생성**: @netlify/neon 패키지가 Netlify DB (Neon Postgres) 자동 생성
3. **환경변수 설정**: `DATABASE_URL` 환경변수가 자동으로 설정됨
4. **빌드 및 배포**: Next.js 빌드 후 Netlify에 배포

#### Netlify DB 특징

- ✅ **7일 무료 체험**: 초기 7일간 무료로 사용 가능
- ✅ **자동 프로비저닝**: `netlify build` 시 자동으로 DB 생성
- ✅ **프로덕션 준비**: Neon 기반 서버리스 Postgres
- ⚠️ **7일 후 Claim**: Netlify UI에서 Neon 계정으로 Claim 필요

#### 자세한 내용

- [Netlify DB 공식 문서](https://docs.netlify.com/build/data-and-storage/netlify-db/)
- [Neon Console](https://console.neon.tech/): DB 관리 및 모니터링

### 개발 환경 vs 프로덕션 환경

| 환경 | DB 설정 | DATABASE_URL |
|------|---------|--------------|
| **개발 (Local)** | 로컬 PostgreSQL 또는 Docker | `postgresql://postgres:postgres@localhost:5432/magic_wand` |
| **프로덕션 (Netlify)** | Netlify DB (Neon) 자동 생성 | 자동으로 설정됨 |

## 📖 문서

- [PRD](./PRD.md) - 제품 요구사항 문서
- [Architecture](./docs/ARCHITECTURE.md) - 아키텍처 (준비 중)
- [API Docs](./docs/API.md) - API 문서 (준비 중)

## 🤝 기여

이 프로젝트는 개인용으로 개발되었습니다.

## 📄 라이선스

MIT
