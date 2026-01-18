# MAGIC WAND - 개발 가이드

## 필수 조건

- **Node.js:** >= 20.0.0
- **pnpm:** >= 8.0.0
- **PostgreSQL:** (Docker 또는 로컬)
- **Redis:** (선택사항, 메시징 큐)

---

## 환경 설정

### 1. 저장소 클론

```bash
git clone <repository-url>
cd magic-wand
```

### 2. 의존성 설치

```bash
pnpm install
```

### 3. 환경변수 설정

```bash
cp .env.example .env
```

**.env 필수 변수:**

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/magic_wand?schema=public"

# AWS S3 (파일 업로드)
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
S3_BUCKET="magic-wand-uploads"

# Anthropic Claude (AI)
ANTHROPIC_API_KEY="your-anthropic-api-key"

# Upstage (문서 파싱)
UPSTAGE_API_KEY="your-upstage-api-key"

# GitHub (코드 푸시)
GITHUB_USERNAME="your-github-username"
GITHUB_PAT="your-github-personal-access-token"

# Netlify (배포)
NETLIFY_AUTH_TOKEN="your-netlify-token"

# Slack (이슈 리포트)
SLACK_SIGNING_SECRET="your-slack-signing-secret"
SLACK_BOT_TOKEN="your-slack-bot-token"

# Redis (선택사항)
REDIS_URL="redis://localhost:6379"
```

### 4. 데이터베이스 시작

**옵션 A: Docker 사용 (권장)**

```bash
docker-compose up -d
```

**옵션 B: 로컬 PostgreSQL**

```bash
# 데이터베이스 생성
createdb magic_wand

# .env 파일에 DATABASE_URL 설정
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/magic_wand?schema=public"
```

### 5. Prisma 설정

```bash
# Prisma Client 생성
pnpm db:generate

# 데이터베이스 스키마 푸시
pnpm db:push
```

---

## 개발 서버 실행

### 모든 서비스 실행

```bash
pnpm dev
```

이 명령은 다음을 실행합니다:
- API 서버 (포트 4000)
- Web 서버 (포트 3000)

### 개별 서비스 실행

**API 서버:**
```bash
pnpm api:dev
# 또는
cd apps/api && pnpm dev
```

**Web 서버:**
```bash
pnpm web:dev
# 또는
cd apps/web && pnpm dev
```

---

## 개발 작업 흐름

### 1. 새 기능 개발

**Backend (apps/api):**
```bash
cd apps/api

# 라우트 추가
# src/routes/new-feature.ts 생성

# Prisma 스키마 수정 (필요시)
cd packages/db
# prisma/schema.prisma 수정
pnpm db:generate
pnpm db:push
```

**Frontend (apps/web):**
```bash
cd apps/web

# 페이지 추가
# src/app/new-page/page.tsx 생성

# 컴포넌트 추가
# src/components/NewComponent.tsx 생성
```

### 2. 공유 패키지 수정

**공유 타입 (packages/shared):**
```bash
cd packages/shared
# 타입 정의 수정
pnpm build
```

**Agent 추가 (packages/agents):**
```bash
cd packages/agents
# src/agents/NewAgent.ts 생성

# orchestrator.ts에 Agent 등록
```

### 3. 빌드 및 테스트

```bash
# 전체 빌드
pnpm build

# 개별 빌드
cd apps/api && pnpm build
cd apps/web && pnpm build

# 테스트
pnpm test
```

---

## 데이터베이스 작업

### Prisma Studio (GUI)

```bash
pnpm db:studio
```

### 마이그레이션

```bash
# 마이그레이션 생성
pnpm db:migrate

# 스키마 푸시 (개발 환경)
pnpm db:push

# Prisma Client 재생성
pnpm db:generate
```

### 시드 데이터

```bash
# Prisma 시드 실행
cd packages/db
pnpm prisma db seed
```

---

## API 테스트

### Health Check

```bash
curl http://localhost:4000/health
```

### API 엔드포인트 테스트

**프로젝트 목록:**
```bash
curl http://localhost:4000/api/projects
```

**프로젝트 생성:**
```bash
curl -X POST http://localhost:4000/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-project",
    "description": "Test project",
    "wizardLevel": "APPRENTICE"
  }'
```

---

## 트러블슈팅

### API 서버가 시작되지 않음

1. 포트 충돌 확인:
```bash
lsof -i :4000
```

2. 환경변수 확인:
```bash
cat .env | grep DATABASE_URL
```

3. PostgreSQL 연결 확인:
```bash
docker ps | grep postgres
# 또
psql -h localhost -U postgres -d magic_wand
```

### Web 서버 에러

1. Next.js �시 삭제:
```bash
cd apps/web
rm -rf .next
pnpm dev
```

2. API 연결 확인:
```bash
curl http://localhost:4000/health
```

### Prisma 에러

```bash
# Prisma Client 재생성
pnpm db:generate

# 스키마 재동기화
pnpm db:push
```

---

## 코드 스타일

### TypeScript

```bash
# 타입 검사
pnpm -r run type-check

# Lint
pnpm -r run lint
```

### 포맷팅

```bash
# Prettier
pnpm prettier --write "**/*.{ts,tsx,js,jsx,json,md}"
```

---

## 유용한 명령어

### 패키지 관리

```bash
# 의존성 추가
pnpm add <package> -w  # 루트
pnpm add <package> --filter @magic-wand/api
pnpm add <package> --filter @magic-wand/web

# 개발 의존성 추가
pnpm add -D <package> --filter @magic-wand/api
```

### 스크립트

```bash
pnpm dev          # 모든 서비스 실행
pnpm build        # 모든 패키지 빌드
pnpm test         # 모든 테스트 실행
pnpm lint         # 모든 Lint 실행
pnpm clean        # 모든 빌드 제거
```

### 데이터베이스

```bash
pnpm db:generate  # Prisma Client 생성
pnpm db:push      # 스키마 푸시
pnpm db:migrate   # 마이그레이션
pnpm db:studio    # Prisma Studio
```

---

## 개발 모범 사례

### 1. 에러 핸들링

**API Routes:**
```typescript
try {
  // 작업 수행
} catch (error: any) {
  console.error('[API] Error:', error);
  res.status(500).json({
    error: {
      message: 'Failed to...',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    },
  });
}
```

### 2. 환경변수 사용

```typescript
const region = process.env.AWS_REGION;
if (!region) {
  throw new Error('AWS_REGION is not configured');
}
```

### 3. Prisma 사용

```typescript
import { prisma } from '@magic-wand/db';

const project = await prisma.project.findUnique({
  where: { id: projectId },
  include: {
    sessionFiles: true,
    surveyAnswer: true,
  },
});
```

### 4. Agent 오케스트레이션

```typescript
import { getOrchestrator } from './orchestrator';

const orchestrator = getOrchestrator();
orchestrator.runAgent('agent-id', projectId, inputData);
```

---

## 다음 단계

- [API 문서](./api-contracts-api.md) - API 엔드포인트 상세
- [데이터 모델](./data-models.md) - 데이터베이스 스키마
- [아키텍처](./architecture-api.md) - 시스템 아키텍처
