# MAGIC WAND - API 계약서

## 기본 정보

**Base URL:** `http://localhost:4000`
**API Prefix:** `/api`
**Content-Type:** `application/json`

---

## 프로젝트 관리 (/api/projects)

### GET /api/projects
전체 프로젝트 목록 조회

**Query Parameters:**
- `includeArchived` (boolean, optional) - 아카이브된 프로젝트 포함

**Response:**
```json
{
  "projects": [
    {
      "id": "cmkglyjd60001v9w620l3pumt",
      "name": "my-project",
      "description": "프로젝트 설명",
      "wizardLevel": "APPRENTICE",
      "status": "pending",
      "statusMessage": "설문조사 대기 중",
      "createdAt": "2026-01-18T00:00:00.000Z",
      "filesCount": 3,
      "executionsCount": 5,
      "deployment": null
    }
  ]
}
```

### POST /api/projects
새 프로젝트 생성

**Request Body:**
```json
{
  "name": "project-name",
  "description": "프로젝트 설명",
  "wizardLevel": "APPRENTICE"
}
```

**Response:**
```json
{
  "project": {
    "id": "cmkglyjd60001v9w620l3pumt",
    "name": "project-name",
    "description": "프로젝트 설명",
    "wizardLevel": "APPRENTICE",
    "isArchived": false,
    "createdAt": "2026-01-18T00:00:00.000Z"
  }
}
```

### GET /api/projects/:id
프로젝트 상세 조회

**Response:**
```json
{
  "project": {
    "id": "...",
    "name": "...",
    "description": "...",
    "sessionFiles": [...],
    "surveyAnswer": {...},
    "deployment": {...}
  }
}
```

### PUT /api/projects/:id
프로젝트 수정

### PATCH /api/projects/:id/archive
프로젝트 아카이브

### DELETE /api/projects/:id
프로젝트 삭제

---

## MVP 생성 (/api/magic)

### POST /api/magic/start
"MVP 생성" 시작 (마법 시작)

**Request Body:**
```json
{
  "projectId": "cmkglyjd60001v9w620l3pumt"
}
```

**Response:**
```json
{
  "message": "Magic started! 🪄",
  "projectId": "cmkglyjd60001v9w620l3pumt",
  "status": "processing"
}
```

### GET /api/magic/status/:projectId
진행 상황 조회

**Response:**
```json
{
  "projectId": "cmkglyjd60001v9w620l3pumt",
  "projectName": "my-project",
  "agentStatus": {
    "total": 12,
    "completed": 3,
    "running": 1,
    "failed": 0,
    "pending": 8
  },
  "deployment": {...},
  "currentAgent": {
    "agentId": "epic-story",
    "agentName": "Epic & Story Agent",
    "status": "RUNNING"
  },
  "overallStatus": "processing"
}
```

### GET /api/magic/agents/:projectId
Agent 실행 내역 조회

**Response:**
```json
{
  "executions": [
    {
      "id": "...",
      "agentId": "requirement-analyzer",
      "agentName": "Requirement Analyzer",
      "status": "COMPLETED",
      "startedAt": "2026-01-18T00:00:00.000Z",
      "completedAt": "2026-01-18T00:01:00.000Z",
      "output": {...}
    }
  ]
}
```

### GET /api/magic/activity/:projectId
현재 실행 중인 에이전트의 활동 로그

**Response:**
```json
{
  "activity": "현재 작업 내용...",
  "agentName": "Epic & Story Agent",
  "agentId": "epic-story"
}
```

### POST /api/magic/restart/:projectId/:agentId
Agent 재시작

### POST /api/magic/select-prd/:projectId
PRD 선택 및 확정

### POST /api/magic/github/create-repo/:projectId
GitHub 레포지토리 생성 및 푸시

**Request Body:**
```json
{
  "repoName": "my-project"
}
```

### POST /api/magic/deploy/:projectId
Netlify 배포 시작

---

## 설문조사 (/api/survey)

### GET/POST /api/survey/start
설문조사 시작 (스키마 반환)

**Response:**
```json
{
  "projectId": "cmkglyjd60001v9w620l3pumt",
  "wizardLevel": "APPRENTICE",
  "surveySchema": {
    "sections": [...]
  }
}
```

### GET /api/survey/:projectId
설문조사 조회

### PUT /api/survey/:projectId
설문조사 임시 저장

### POST /api/survey/:projectId/submit
설문조사 제출

---

## 파일 업로드 (/api/upload)

### POST /api/upload/presigned-url
S3 Presigned URL 발급

**Request Body:**
```json
{
  "fileName": "document.pdf",
  "fileType": "application/pdf"
}
```

**Response:**
```json
{
  "presignedUrl": "https://s3.amazonaws.com/...",
  "fileKey": "uploads/...",
  "uploadUrl": "s3://bucket-name/..."
}
```

### POST /api/upload/complete
업로드 완료 처리

**Request Body:**
```json
{
  "projectId": "cmkglyjd60001v9w620l3pumt",
  "s3Key": "uploads/...",
  "fileName": "document.pdf",
  "fileType": "application/pdf",
  "fileSize": 12345,
  "description": "요구사항 문서",
  "parseDocument": true
}
```

### GET /api/upload/:fileId
파일 조회

---

## 이슈 리포트 (/api/issues)

### POST /api/issues/slack
Slack Webhook - 이슈 리포트 수신

### GET /api/issues/:projectId
이슈 목록 조회

### GET /api/issues/detail/:issueId
이슈 상세 조회

---

## AI 채팅 설문조사 (/api/survey-chat)

### GET /api/survey-chat/:projectId
채팅 시작

### POST /api/survey-chat/:projectId
사용자 응답 처리

### POST /api/survey-chat/:projectId/complete
설문 완료

---

## Health Check

### GET /health
서버 상태 확인

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-18T00:00:00.000Z",
  "uptime": 123.456
}
```

### GET /
API 기본 정보

**Response:**
```json
{
  "message": "MAGIC WAND API",
  "version": "1.0.0"
}
```

---

## 에러 응답

모든 엔드포인트는 다음 에러 형식을 따릅니다:

```json
{
  "error": {
    "message": "Error description",
    "stack": "Error stack trace (development only)"
  }
}
```

**HTTP Status Codes:**
- 200: 성공
- 201: 생성됨
- 400: 잘못된 요청
- 404: 찾을 수 없음
- 500: 서버 오류
