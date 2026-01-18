# MAGIC WAND - 배포 가이드

## 배포 아키텍처 개요

**개발 환경:**
- API: localhost:4000
- Web: localhost:3000
- DB: 로컬 PostgreSQL

**프로덕션 환경:**
- Web: Netlify Edge Functions
- API: 별도 서버 또는 Netlify Functions
- DB: Netlify DB (Neon Postgres) - 자동 생성
- Redis: Upstash Redis (외부 서비스)

---

## Netlify 배포

### 1. Netlify DB 자동 설정

이 프로젝트는 `@netlify/neon` 패키지를 통해 배포 시 자동으로 Netlify DB를 생성합니다.

**과정:**
1. 사용자가 "🚀 배포" 버튼 클릭
2. `netlify build` 실행
3. `@netlify/neon`이 Netlify DB (Neon Postgres) 자동 생성
4. `DATABASE_URL` 환경변수 자동 설정
5. Next.js 빌드 및 배포

**Netlify DB 특징:**
- ✅ 7일 무료 체험
- ✅ 자동 프로비저닝
- ✅ 프로덕션 준비 서버리스 Postgres
- ⚠️ 7일 후 Neon 계정으로 Claim 필요

### 2. 배포 과정

#### Step 1: GitHub 레포지토리 생성

```bash
# API 호출
POST /api/magic/github/create-repo/:projectId

# Request
{
  "repoName": "my-project"
}

# Response
{
  "message": "GitHub 레포지토리 생성 및 푸시 시작",
  "repoName": "my-project",
  "repoUrl": "https://github.com/username/my-project"
}
```

**GitHubPusherAgent:**
1. GitHub 레포지토리 생성
2. 로컬 코드 푸시
3. 배포 레코드 업데이트

#### Step 2: Netlify 배포

```bash
# API 호출
POST /api/magic/deploy/:projectId

# Response
{
  "message": "Netlify 배포 시작",
  "deploymentUrl": "https://my-project-123.netlify.app",
  "subdomain": "my-project-123"
}
```

**NetlifyDeployerAgent:**
1. Netlify 사이트 생성
2. GitHub 레포지토리 연결
3. 배포 트리거
4. 배포 상태 업데이트

### 3. 환경변수 설정

**Netlify 환경변수:**

```bash
# Site Settings > Environment Variables
DATABASE_URL=<자동으로 설정됨>
ANTHROPIC_API_KEY=your-key
UPSTAGE_API_KEY=your-key
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-key
S3_BUCKET=magic-wand-uploads
GITHUB_PAT=your-token
NETLIFY_AUTH_TOKEN=your-token
SLACK_SIGNING_SECRET=your-secret
SLACK_BOT_TOKEN=your-token
REDIS_URL=redis://your-redis-url
```

---

## 수동 배포

### API 서버 배포

#### 옵션 A: Railway/Render/Vercel

**Railway:**
1. PostgreSQL 생성
2. Redis 생성
3. New Project → Deploy from GitHub
4. 루트 디렉토리: `apps/api`
5. 시작 명령어: `pnpm start`
6. 환경변수 설정

**Render:**
1. Web Service 생성
2. Build Command: `cd apps/api && pnpm build`
3. Start Command: `cd apps/api && pnpm start`
4. 환경변수 설정

#### 옵션 B: Docker

**Dockerfile (apps/api/Dockerfile):**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json pnpm-lock.yaml ./
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 4000
CMD ["pnpm", "start"]
```

**빌드 및 실행:**
```bash
docker build -t magic-wand-api ./apps/api
docker run -p 4000:4000 --env-file .env magic-wand-api
```

### Web (Next.js) 배포

#### Netlify (권장)

**netlify.toml:**
```toml
[build]
  command = "cd apps/web && pnpm build"
  publish = "apps/web/.next"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[functions]
  directory = "apps/web/.netlify/functions"
```

**배포:**
```bash
# Netlify CLI
npm install -g netlify-cli
netlify deploy --prod

# 또는 GitHub 연동 자동 배포
```

#### Vercel

**배포:**
1. Vercel 대시보드 → New Project
2. GitHub 레포지토리 import
3. 루트 디렉토리: `apps/web`
4. 빌드 명령어: `pnpm build`
5. 출력 디렉토리: `.next`
6. 환경변수 설정

---

## CI/CD 설정

### GitHub Actions

**.github/workflows/deploy.yml:**
```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - run: pnpm install
      - run: pnpm build
      - name: Deploy to Railway
        run: railway login
        run: railway up

  deploy-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - run: cd apps/web && pnpm install
      - run: cd apps/web && pnpm build
      - name: Deploy to Netlify
        uses: netlify/actions/cli@master
        with:
          args: deploy --prod
        env:
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
```

---

## 환경별 설정

### 개발 (Development)

```bash
# .env.development
DATABASE_URL="postgresql://localhost:5432/magic_wand"
API_URL="http://localhost:4000"
WEB_URL="http://localhost:3000"
NODE_ENV="development"
```

### 스테이징 (Staging)

```bash
# .env.staging
DATABASE_URL="postgresql://staging-db..."
API_URL="https://api-staging.magicwand.com"
WEB_URL="https://staging.magicwand.com"
NODE_ENV="production"
```

### 프로덕션 (Production)

```bash
# .env.production
DATABASE_URL="postgresql://production-db..."
API_URL="https://api.magicwand.com"
WEB_URL="https://magicwand.com"
NODE_ENV="production"
```

---

## 모니터링

### 로그

**Netlify:**
```bash
netlify logs
```

**Railway:**
```bash
railway logs
```

### 상태 확인

**API Health:**
```bash
curl https://api.magicwand.com/health
```

**Web:**
```bash
curl https://magicwand.com
```

---

## 문제 해결

### 배포 실패

1. **빌드 에러:**
   - 패키지 버전 확인
   - Node.js 버전 확인 (20.x)
   - 환경변수 확인

2. **데이터베이스 연결 실패:**
   - DATABASE_URL 확인
   - PostgreSQL 상태 확인
   - 방화벽 규칙 확인

3. **CORS 에러:**
   - API CORS 설정 확인
   - Web 도메인 허용 목록에 추가

### 성능 최적화

**Next.js:**
```javascript
// next.config.js
module.exports = {
  reactStrictMode: true,
  swcMinify: true,
  compress: true,
  images: {
    domains: ['example.com'],
  },
}
```

**API:**
```typescript
// 압축 미들웨어
app.use(compression());

// 캐싱
app.use('/api', cache('5 minutes'));
```

---

## 롤백

### Netlify

```bash
# 이전 배포로 롤백
netlify deploy --prod --previous
```

### Railway

```bash
# 이전 커밋으로 롤백
railway rollback
```

---

## 보안

### 환경변수 관리

- 절대 .env를 커밋하지 않기
- .env.example에 필요한 변수만 나열
- GitHub Secrets 사용 (CI/CD)
- Netlify Environment Variables 사용 (배포)

### API 키 관리

- GitHub PAT: 만료 날짜 설정
- AWS IAM: 최소 권한 부여
- Slack Tokens: rotating tokens 사용

---

## 참고 자료

- [Netlify Docs](https://docs.netlify.com/)
- [Neon Console](https://console.neon.tech/)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Prisma Deployment](https://www.prisma.io/docs/guides/deployment)
