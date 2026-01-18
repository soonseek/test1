# MAGIC WAND - 데이터 모델

## 데이터베이스 스키마 개요

**ORM:** Prisma
**데이터베이스:** PostgreSQL
**스키마 파일:** `packages/db/prisma/schema.prisma`

---

## 모델 목록

1. **Project** - 프로젝트 정보
2. **SessionFile** - 세션 파일 (업로드된 문서)
3. **SurveyAnswer** - 설문조사 답변
4. **Deployment** - 배포 정보
5. **IssueReport** - 이슈 리포트
6. **AgentExecution** - Agent 실행 기록

---

## Project

프로젝트 기본 정보와 상태를 저장합니다.

**필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (CUID) | 기본 키 |
| name | String | 프로젝트 이름 |
| description | Text | 프로젝트 설명 |
| wizardLevel | Enum | 마법사 레벨 (APPRENTICE, SKILLED, ARCHMAGE) |
| isArchived | Boolean | 아카이브 여부 |
| epicMarkdown | Text? | Epic.md 내용 |
| storyFiles | Json? | Story 파일들 배열 |
| createdAt | DateTime | 생성일 |
| updatedAt | DateTime | 수정일 |

**관계:**
- `sessionFiles` → SessionFile[] (일대다)
- `surveyAnswer` → SurveyAnswer? (일대일)
- `deployment` → Deployment? (일대일)
- `issueReports` → IssueReport[] (일대다)
- `agentExecutions` → AgentExecution[] (일대다)

**인덱스:**
- `createdAt`
- `isArchived`

---

## SessionFile

사용자가 업로드한 파일 정보와 파싱 결과를 저장합니다.

**필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (CUID) | 기본 키 |
| projectId | String | 프로젝트 ID (FK) |
| s3Key | String (Unique) | S3 키 |
| fileName | String | 파일 이름 |
| fileType | String | 파일 타입 (MIME) |
| fileSize | Int | 파일 크기 (bytes) |
| parsedText | String? | 업스테이지 파싱 텍스트 |
| parsedLayout | Json? | 파싱된 레이아웃 |
| parsedTables | Json? | 파싱된 테이블 |
| confidence | Float? | 파싱 신뢰도 |
| description | Text | 사용자 설명 |
| uploadedAt | DateTime | 업로드일 |

**관계:**
- `project` → Project (다대일)

**인덱스:**
- `projectId`

---

## SurveyAnswer

설문조사 답변을 저장합니다.

**필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (CUID) | 기본 키 |
| projectId | String (Unique) | 프로젝트 ID (FK) |
| designTemplate | String? | 디자인 템플릿 (인턴 마법사) |
| colorTheme | String | 색상 테마 |
| designStyle | Enum | 디자인 스타일 |
| referenceSiteUrl | String? | 참고 사이트 URL |
| authType | Enum | 인증 타입 |
| requiredPages | String[] | 필요한 페이지 |
| databaseTables | String[] | 데이터베이스 테이블 |
| externalApis | String[] | 외부 API |
| specialRequests | String? | 특별 요구사항 |
| answers | Json | 전체 응답 (JSON) |
| createdAt | DateTime | 생성일 |
| updatedAt | DateTime | 수정일 |

**관계:**
- `project` → Project (일대일)

---

## Deployment

배포 정보를 저장합니다.

**필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (CUID) | 기본 키 |
| projectId | String (Unique) | 프로젝트 ID (FK) |
| githubRepoUrl | String | GitHub 레포지토리 URL |
| githubBranch | String | GitHub 브랜치 (기본: main) |
| netlifyUrl | String? | Netlify URL |
| netlifySiteId | String? | Netlify 사이트 ID |
| status | Enum | 배포 상태 |
| logs | Json? | 배포 로그 |
| estimatedTime | Int? | 예상 시간 (분) |
| estimatedMuggleMandays | String? | 머글 기준 공수 |
| startedAt | DateTime? | 시작일 |
| completedAt | DateTime? | 완료일 |
| createdAt | DateTime | 생성일 |
| updatedAt | DateTime | 수정일 |

**관계:**
- `project` → Project (일대일)

**인덱스:**
- `status`

---

## IssueReport

이슈 리포트를 저장합니다 (Slack에서 수신).

**필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (CUID) | 기본 키 |
| projectId | String | 프로젝트 ID (FK) |
| slackMessageId | String? | Slack 메시지 ID |
| slackChannel | String | Slack 채널 |
| slackTs | String | Slack 타임스탬프 |
| issue | Text | 이슈 내용 |
| status | Enum | 상태 (OPEN, IN_PROGRESS, FIXED, CANNOT_FIX) |
| fixAttempts | Int | 수정 시도 횟수 |
| fixLogs | Json? | 수정 로그 |
| createdAt | DateTime | 생성일 |
| updatedAt | DateTime | 수정일 |

**관계:**
- `project` → Project (다대일)

**인덱스:**
- `projectId`
- `status`

---

## AgentExecution

Agent 실행 기록을 저장합니다.

**필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (CUID) | 기본 키 |
| projectId | String | 프로젝트 ID (FK) |
| agentId | String | Agent ID |
| agentName | String | Agent 이름 |
| status | Enum | 상태 |
| startedAt | DateTime | 시작일 |
| completedAt | DateTime? | 완료일 |
| retryCount | Int | 재시도 횟수 |
| input | Json | 입력 데이터 |
| output | Json? | 출력 데이터 |
| error | Json? | 에러 정보 |
| attachments | Json? | 첨부파일 배열 |
| comments | Json? | 코멘트 배열 |
| activityLogUrl | String? | 활동 로그 S3 URL |

**관계:**
- `project` → Project (다대일)

**인덱스:**
- `projectId`
- `agentId`
- `status`

---

## Enumerations

### WizardLevel
```prisma
enum WizardLevel {
  APPRENTICE    // 인턴 마법사
  SKILLED       // 숙련자 마법사
  ARCHMAGE      // 대마법사
}
```

### DesignStyle
```prisma
enum DesignStyle {
  MINIMAL
  MODERN
  PLAYFUL
  COLORFUL
  CUSTOM
}
```

### AuthType
```prisma
enum AuthType {
  NONE
  EMAIL
  SOCIAL
}
```

### DeploymentStatus
```prisma
enum DeploymentStatus {
  PENDING
  IN_PROGRESS
  DEPLOYED
  FAILED
}
```

### IssueStatus
```prisma
enum IssueStatus {
  OPEN
  IN_PROGRESS
  FIXED
  CANNOT_FIX
}
```

### AgentStatus
```prisma
enum AgentStatus {
  IDLE
  RUNNING
  WAITING
  COMPLETED
  FAILED
  RETRYING
  CANCELLED
}
```

---

## 관계 다이어그램

```
Project (1) ----< (1) SurveyAnswer
Project (1) ----< (1) Deployment
Project (1) ----< (*) SessionFile
Project (1) ----< (*) IssueReport
Project (1) ----< (*) AgentExecution
```

---

## 데이터베이스 마이그레이션

### 마이그레이션 생성
```bash
pnpm db:generate  # Prisma Client 생성
pnpm db:push      # 스키마 푸시 (개발)
pnpm db:migrate   # 마이그레이션 생성 및 적용
```

### Prisma Studio
```bash
pnpm db:studio    # 데이터베이스 GUI
```
