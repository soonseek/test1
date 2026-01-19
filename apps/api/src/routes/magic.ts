import { Router } from 'express';
import { prisma } from '@magic-wand/db';
import { getEventBus } from '@magic-wand/agent-framework';
import { getOrchestrator } from '../orchestrator';

const router = Router();

// POST /api/magic/start - "마법 시작" (MVP 생성 트리거)
router.post('/start', async (req, res) => {
  try {
    const { projectId } = req.body;
    console.log('[Magic API] Received request for projectId:', projectId);

    if (!projectId) {
      console.error('[Magic API] Missing projectId');
      return res.status(400).json({
        error: { message: 'projectId is required' },
      });
    }

    // 프로젝트 조회
    console.log('[Magic API] Fetching project...');
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        sessionFiles: true,
        surveyAnswer: true,
      },
    });

    if (!project) {
      console.error('[Magic API] Project not found:', projectId);
      return res.status(404).json({
        error: { message: 'Project not found' },
      });
    }

    console.log('[Magic API] Project found:', project.name);

    // 설문조사 완료 확인
    if (!project.surveyAnswer) {
      console.error('[Magic API] Survey not completed');
      return res.status(400).json({
        error: { message: 'Survey must be completed before starting magic' },
      });
    }

    // Event Bus 대신 Orchestrator 직접 호출
    console.log('[Magic API] Calling orchestrator directly...');
    console.log('[Magic API] Event data:', {
      projectId,
      projectName: project.name,
      filesCount: project.sessionFiles.length,
      hasSurvey: !!project.surveyAnswer,
    });

    try {
      const orchestrator = getOrchestrator();
      console.log('[Magic API] Orchestrator instance:', orchestrator);

      // 비동기 실행 (응답은 즉시 전송)
      orchestrator.runMagic({
        projectId,
        project: {
          name: project.name,
          description: project.description,
          wizardLevel: project.wizardLevel,
        },
        files: project.sessionFiles,
        survey: project.surveyAnswer,
      }).catch(error => {
        console.error('[Magic API] Orchestrator execution failed:', error);
      });

      console.log('[Magic API] Orchestrator triggered successfully');
    } catch (orchError) {
      console.error('[Magic API] Failed to trigger orchestrator:', orchError);
    }

    // 즉시 응답 전송
    res.json({
      message: 'Magic started! 🪄',
      projectId,
      status: 'processing',
    });
  } catch (error: any) {
    console.error('[Magic API] Error starting magic:', error);
    res.status(500).json({
      error: {
        message: 'Failed to start magic',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// GET /api/magic/status/:projectId - 진행 상황 조회
router.get('/status/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    console.log('[Magic API] Status check for projectId:', projectId);

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        agentExecutions: {
          orderBy: { startedAt: 'desc' },
        },
        deployment: true,
      },
    });

    if (!project) {
      console.error('[Magic API] Project not found in status check');
      return res.status(404).json({
        error: { message: 'Project not found' },
      });
    }

    const orchestrator = getOrchestrator();
    const isDevelopmentActive = orchestrator.isDevelopmentActive(projectId);
    const isPaused = orchestrator.isPaused(projectId);

    // Agent 실행 상태 집계
    const agentStatus = {
      total: project.agentExecutions.length,
      completed: project.agentExecutions.filter((e: any) => e.status === 'COMPLETED').length,
      running: project.agentExecutions.filter((e: any) => e.status === 'RUNNING').length,
      failed: project.agentExecutions.filter((e: any) => e.status === 'FAILED').length,
      pending: project.agentExecutions.filter((e: any) => e.status === 'IDLE' || e.status === 'WAITING').length,
    };

    console.log('[Magic API] Agent status:', agentStatus);
    console.log('[Magic API] Development active:', isDevelopmentActive, 'Paused:', isPaused);

    res.json({
      projectId: project.id,
      projectName: project.name,
      agentStatus,
      deployment: project.deployment,
      currentAgent: project.agentExecutions.find((e: any) => e.status === 'RUNNING'),
      development: {
        active: isDevelopmentActive,
        paused: isPaused,
      },
      overallStatus: agentStatus.running > 0 ? 'processing' :
                     agentStatus.failed > 0 ? 'failed' :
                     agentStatus.total === agentStatus.completed ? 'completed' : 'pending',
    });
  } catch (error: any) {
    console.error('[Magic API] Error fetching magic status:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch magic status',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// GET /api/magic/logs/:projectId - 실시간 로그 (SSE)
router.get('/logs/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;

    // SSE 헤더 설정
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Agent 실행 로그 전송
    const sendLogs = async () => {
      const agentExecutions = await prisma.agentExecution.findMany({
        where: { projectId },
        orderBy: { startedAt: 'desc' },
      });

      agentExecutions.forEach((execution: any) => {
        res.write(`data: ${JSON.stringify({
          agentId: execution.agentId,
          agentName: execution.agentName,
          status: execution.status,
          timestamp: execution.startedAt,
          output: execution.output,
          error: execution.error,
        })}\n\n`);
      });
    };

    // 초기 로그 전송
    await sendLogs();

    // 주기적으로 업데이트 (실제로는 Event Bus를 통해 구현)
    const interval = setInterval(sendLogs, 5000);

    // 연결 종료 시 정리
    req.on('close', () => {
      clearInterval(interval);
    });
  } catch (error: any) {
    console.error('Error streaming logs:', error);
    res.status(500).json({
      error: {
        message: 'Failed to stream logs',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// GET /api/magic/agents/:projectId - Agent 실행 내역 조회
router.get('/agents/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    console.log('[Magic API] Fetching agent executions for:', projectId);

    const executions = await prisma.agentExecution.findMany({
      where: { projectId },
      orderBy: { startedAt: 'desc' },
    });

    console.log('[Magic API] Found executions:', executions.length);

    res.json({ executions });
  } catch (error: any) {
    console.error('[Magic API] Error fetching agents:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch agent executions',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// GET /api/magic/activity/:projectId - 현재 실행 중인 에이전트의 활동 로그 가져오기
router.get('/activity/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    console.log('[Magic API] Fetching activity log for:', projectId);

    // 현재 실행 중인 에이전트 찾기
    const runningAgent = await prisma.agentExecution.findFirst({
      where: {
        projectId,
        status: 'RUNNING',
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    if (!runningAgent) {
      return res.json({
        activity: null,
        agentName: null,
      });
    }

    // activityLogUrl이 있으면 S3에서 로그 내용 가져오기
    let activitySnippet = '';
    if (runningAgent.activityLogUrl) {
      try {
        const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

        const region = process.env.AWS_REGION;
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

        if (region && accessKeyId && secretAccessKey) {
          const s3Client = new S3Client({
            region,
            credentials: {
              accessKeyId,
              secretAccessKey,
            },
          });

          // S3 URL에서 키 추출
          const s3Key = runningAgent.activityLogUrl.split('.amazonaws.com/')[1];
          const command = new GetObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: s3Key,
          });

          const response = await s3Client.send(command);
          const logContent = await response.Body?.transformToString();

          if (logContent) {
            // 마지막 1000자 정도만 가져오기 (최근 활동)
            const lines = logContent.split('\n');
            const recentLines = lines.slice(-20); // 마지막 20줄
            activitySnippet = recentLines.join('\n').substring(0, 500); // 최대 500자
          }
        }
      } catch (s3Error) {
        console.error('[Magic API] Failed to fetch activity log from S3:', s3Error);
        // S3 실패해도 응답은 계속 진행
      }
    }

    // 활동 로그가 없으면 에이전트 이름만 반환
    res.json({
      activity: activitySnippet || null,
      agentName: runningAgent.agentName,
      agentId: runningAgent.agentId,
    });
  } catch (error: any) {
    console.error('[Magic API] Error fetching activity:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch activity log',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/magic/restart/:projectId/:agentId - Agent 재시작
router.post('/restart/:projectId/:agentId', async (req, res) => {
  try {
    const { projectId, agentId } = req.params;
    console.log(`[Magic API] Restarting agent ${agentId} for project ${projectId}`);

    // Orchestrator 직접 호출
    const orchestrator = getOrchestrator();
    console.log('[Magic API] Orchestrator instance:', orchestrator);

    // 프로젝트 정보 조회
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        sessionFiles: true,
        surveyAnswer: true,
        agentExecutions: {
          orderBy: { startedAt: 'desc' },
        },
      },
    });

    if (!project) {
      return res.status(404).json({
        error: { message: 'Project not found' },
      });
    }

    console.log('[Magic API] Project found:', project.name);
    console.log('[Magic API] Agent executions found:', project.agentExecutions.length);

    // Epic & Story 결과 추출 (Scrum Master를 위한)
    let epicStoryOutput = null;
    const epicStoryExecution = project.agentExecutions.find(
      (e: any) => e.agentId === 'epic-story' && e.status === 'COMPLETED'
    );

    if (epicStoryExecution && epicStoryExecution.output) {
      epicStoryOutput = epicStoryExecution.output;
      console.log('[Magic API] Found Epic & Story output:', {
        epicsCount: epicStoryOutput.epics?.length || 0,
        storiesCount: epicStoryOutput.stories?.length || 0,
      });
    }

    console.log('[Magic API] Calling orchestrator.runAgent...');

    // Developer 에이전트인 경우 개발 단계 전체 실행
    if (agentId === 'developer') {
      console.log('[Magic API] Running full development phase...');
      orchestrator.runDevelopmentPhase(projectId).catch(error => {
        console.error('[Magic API] Development phase failed:', error);
      });
    } else {
      // 비동기 Agent 실행
      orchestrator.runAgent(agentId, projectId, {
        projectId,
        project: {
          name: project.name,
          description: project.description,
          wizardLevel: project.wizardLevel,
        },
        files: project.sessionFiles,
        survey: project.surveyAnswer,
        epicStory: epicStoryOutput, // Epic & Story 결과 추가
      }).catch(error => {
        console.error(`[Magic API] Agent execution failed for ${agentId}:`, error);
      });
    }

    console.log(`[Magic API] Agent ${agentId} restart triggered`);

    res.json({
      message: 'Agent restart initiated',
      agentId,
      projectId,
    });
  } catch (error: any) {
    console.error(`[Magic API] Error restarting agent ${agentId}:`, error);
    res.status(500).json({
      error: {
        message: 'Failed to restart agent',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/magic/select-prd/:projectId - PRD 선택 및 확정
router.post('/select-prd/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { prdId } = req.body;
    console.log(`[Magic API] Selecting PRD ${prdId} for project ${projectId}`);

    // 프로젝트 조회
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        agentExecutions: {
          where: { agentId: 'requirement-analyzer' },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!project) {
      return res.status(404).json({
        error: { message: 'Project not found' },
      });
    }

    const lastExecution = project.agentExecutions[0];
    if (!lastExecution || !lastExecution.output) {
      return res.status(400).json({
        error: { message: 'No requirement analysis found' },
      });
    }

    const prdOptions = (lastExecution.output as any).prdOptions;
    if (!prdOptions || !prdOptions.find((p: any) => p.id === prdId)) {
      return res.status(400).json({
        error: { message: 'Invalid PRD ID' },
      });
    }

    // 선택된 PRD를 output에 저장
    const updatedOutput = {
      ...(lastExecution.output as any),
      selectedPRDId: prdId,
      selectedPRD: prdOptions.find((p: any) => p.id === prdId),
    };

    await prisma.agentExecution.update({
      where: { id: lastExecution.id },
      data: {
        output: updatedOutput as any,
      },
    });

    console.log(`[Magic API] PRD ${prdId} selected successfully`);

    res.json({
      message: 'PRD selected successfully',
      selectedPRDId: prdId,
    });
  } catch (error: any) {
    console.error(`[Magic API] Error selecting PRD:`, error);
    res.status(500).json({
      error: {
        message: 'Failed to select PRD',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/magic/github/create-repo/:projectId - GitHub 레포지토리 생성 및 푸시
router.post('/github/create-repo/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repoName } = req.body;

    console.log(`[Magic API] Creating GitHub repo for project ${projectId}, repo: ${repoName}`);

    if (!repoName || !repoName.trim()) {
      return res.status(400).json({
        error: { message: '레포지토리 이름은 필수입니다' },
      });
    }

    const trimmedRepoName = repoName.trim();

    // 레포지토리명 밸리데이션 (영문 소문자, 숫자, 하이픈만 허용)
    const repoNameRegex = /^[a-z0-9-]+$/;
    if (!repoNameRegex.test(trimmedRepoName)) {
      return res.status(400).json({
        error: { message: '레포지토리 이름은 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다' },
      });
    }

    // 프로젝트 정보 조회
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return res.status(404).json({
        error: { message: 'Project not found' },
      });
    }

    // GitHub 레포지토리 URL 생성
    // GITHUB_ORG가 있으면 조직 사용, 없으면 개인 사용자명(GITHUB_USERNAME) 사용
    const githubOrg = process.env.GITHUB_ORG;
    const githubUsername = process.env.GITHUB_USERNAME || 'your-username';

    // GitHub API용 owner 형식 (조직: orgs/ORG_NAME, 개인: username)
    let githubOwner: string;
    if (githubOrg) {
      githubOwner = `orgs/${githubOrg}`;  // 조직 API 형식: orgs/Studio-Burganova
    } else {
      githubOwner = githubUsername;  // 개인 사용자 형식: username
    }

    // Git clone용 URL (조직/개인 모두 github.com/OWNER/repo.git 형식)
    const githubRepoUrl = `https://github.com/${githubOrg || githubUsername}/${trimmedRepoName}.git`;

    // Orchestrator를 통해 GitHubPusherAgent 실행
    const orchestrator = getOrchestrator();

    // GitHubPusherAgent 실행 (githubOwner를 별도로 전달)
    orchestrator.runAgent('github-pusher', projectId, {
      projectId,
      codeDirectory: process.cwd(), // 프로젝트 루트 디렉토리
      githubRepoUrl,
      githubOwner, // API 호출용 owner (orgs/ORG_NAME 또는 username)
      githubPat: process.env.GITHUB_PAT,
      commitMessage: `feat: initial MVP generated by MAGIC WAND 🪄\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>`,
    }).catch(error => {
      console.error('[Magic API] GitHub pusher execution failed:', error);
    });

    res.json({
      message: 'GitHub 레포지토리 생성 및 푸시를 시작했습니다. 완료까지 몇 분 정도 소요됩니다.',
      repoName: trimmedRepoName,
      repoUrl: githubRepoUrl.replace('.git', ''),
    });
  } catch (error: any) {
    console.error('[Magic API] Error creating GitHub repo:', error);
    res.status(500).json({
      error: {
        message: 'Failed to create GitHub repository',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/magic/deploy/:projectId - Netlify 배포
router.post('/deploy/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;

    console.log(`[Magic API] Deploying project ${projectId} to Netlify`);

    // 프로젝트 정보 조회
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        deployment: true,
      },
    });

    if (!project) {
      return res.status(404).json({
        error: { message: 'Project not found' },
      });
    }

    // GitHub 레포지토리 정보 확인
    if (!project.deployment || !project.deployment.githubRepoUrl) {
      return res.status(400).json({
        error: { message: 'GitHub 레포지토리가 먼저 생성되어야 합니다. GitHub 푸시 버튼을 먼저 실행해주세요.' },
      });
    }

    // Orchestrator를 통해 NetlifyDeployerAgent 실행
    const orchestrator = getOrchestrator();

    // 레포지토리 이름에서 서브도메인 생성 (레포지토리명-난수3자)
    const repoNameMatch = project.deployment.githubRepoUrl.match(/github\.com\/([^\/]+)/);
    const repoName = repoNameMatch ? repoNameMatch[1] : project.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const subdomain = `${repoName}-${randomSuffix}`;

    // NetlifyDeployerAgent 실행
    orchestrator.runAgent('netlify-deployer', projectId, {
      projectId,
      githubRepoUrl: project.deployment.githubRepoUrl,
      githubBranch: project.deployment.githubBranch || 'main',
      subdomain,
      netlifyAuthToken: process.env.NETLIFY_AUTH_TOKEN,
    }).catch(error => {
      console.error('[Magic API] Netlify deployer execution failed:', error);
    });

    res.json({
      message: 'Netlify 배포 시작',
      deploymentUrl: `https://${subdomain}.netlify.app`,
      subdomain,
    });
  } catch (error: any) {
    console.error('[Magic API] Error deploying to Netlify:', error);
    res.status(500).json({
      error: {
        message: 'Failed to deploy to Netlify',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// GET /api/magic/logs - 서버 로그 실시간 조회
router.get('/logs', async (req, res) => {
  try {
    const { lines = 100 } = req.query;

    // Claude Code가 작성한 백그라운드 태스크 출력 파일 경로
    const fs = require('fs');
    const path = require('path');

    // 백그라운드 태스크 출력 파일이 있는 디렉토리 (고정 경로 사용)
    const tasksDir = 'C:\\tmp\\claude\\tasks';

    // 가장 최근의 출력 파일 찾기
    let latestLogFile: string | null = null;
    let latestTime = 0;

    try {
      if (fs.existsSync(tasksDir)) {
        const files = fs.readdirSync(tasksDir);
        files.forEach(file => {
          if (file.endsWith('.output')) {
            const filePath = path.join(tasksDir, file);
            const stats = fs.statSync(filePath);
            if (stats.mtimeMs > latestTime) {
              latestTime = stats.mtimeMs;
              latestLogFile = filePath;
            }
          }
        });
      }
    } catch (error) {
      console.error('[Magic API] Error reading tasks directory:', error);
    }

    if (!latestLogFile || !fs.existsSync(latestLogFile)) {
      return res.json({
        logs: ['서버 로그 파일을 찾을 수 없습니다. API 서버가 실행 중인지 확인해주세요.'],
        lastModified: null,
      });
    }

    // 로그 파일 읽기
    const content = fs.readFileSync(latestLogFile, 'utf-8');
    const logLines = content.split('\n');

    // 요청한 라인 수만큼 반환 (기본값: 100)
    const lineCount = parseInt(lines as string) || 100;
    const requestedLines = logLines.slice(-lineCount);

    res.json({
      logs: requestedLines.filter(line => line.trim()),
      lastModified: latestTime,
      totalLines: logLines.length,
    });
  } catch (error: any) {
    console.error('[Magic API] Error fetching logs:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch logs',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/magic/pause - 개발 일시정지
router.post('/pause', async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({
        error: { message: 'projectId is required' },
      });
    }

    console.log('[Magic API] Pausing development for projectId:', projectId);

    const orchestrator = getOrchestrator();
    orchestrator.pauseDevelopment(projectId);

    res.json({
      message: 'Development paused',
      projectId,
      paused: true,
    });
  } catch (error: any) {
    console.error('[Magic API] Error pausing development:', error);
    res.status(500).json({
      error: {
        message: 'Failed to pause development',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/magic/start-development - 개발 루프 시작
router.post('/start-development', async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({
        error: { message: 'projectId is required' },
      });
    }

    console.log('[Magic API] Starting development loop for projectId:', projectId);

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return res.status(404).json({
        error: { message: 'Project not found' },
      });
    }

    const orchestrator = getOrchestrator();

    // Epic Story와 Scrum Master 결과 로드
    const epicStoryExec = await prisma.agentExecution.findFirst({
      where: { projectId, agentId: 'epic-story' },
      orderBy: { startedAt: 'desc' },
    });

    const scrumMasterExec = await prisma.agentExecution.findFirst({
      where: { projectId, agentId: 'scrum-master' },
      orderBy: { startedAt: 'desc' },
    });

    if (!epicStoryExec || !epicStoryExec.output) {
      return res.status(400).json({
        error: { message: 'Epic Story must be completed first' },
      });
    }

    if (!scrumMasterExec || !scrumMasterExec.output) {
      return res.status(400).json({
        error: { message: 'Scrum Master must be completed first' },
      });
    }

    // 비동기로 개발 루프 시작 (즉시 응답 전송)
    orchestrator.runDevelopmentLoop({
      projectId,
      project: {
        name: project.name,
        description: project.description,
        wizardLevel: project.wizardLevel,
      },
      epicStoryOutput: epicStoryExec.output,
      selectedPRD: null, // PRD는 필요 없음
      currentEpicOrder: -1, // 모든 Epic 대상
    }).catch(error => {
      console.error('[Magic API] Development loop error:', error);
    });

    res.json({
      message: 'Development loop started',
      projectId,
      status: 'running',
    });
  } catch (error: any) {
    console.error('[Magic API] Error starting development:', error);
    res.status(500).json({
      error: {
        message: 'Failed to start development',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/magic/resume - 개발 재개
router.post('/resume', async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({
        error: { message: 'projectId is required' },
      });
    }

    console.log('[Magic API] Resuming development for projectId:', projectId);

    const orchestrator = getOrchestrator();

    // 1. 일시정지 상태 해제
    orchestrator.resumeDevelopment(projectId);

    // 2. 실패한 작업을 다시 pending 상태로 변경
    try {
      const scrumMasterExec = await prisma.agentExecution.findFirst({
        where: { projectId, agentId: 'scrum-master' },
        orderBy: { startedAt: 'desc' },
      });

      if (scrumMasterExec && scrumMasterExec.output) {
        const output = scrumMasterExec.output as any;
        const tasks = output.tasks || [];

        // 실패한 작업을 다시 pending 상태로 변경
        let updated = false;
        for (const task of tasks) {
          if (task.status === 'failed') {
            task.status = 'pending';
            updated = true;
            console.log(`[Magic API] Resetting failed task ${task.id} to pending`);
          }
        }

        if (updated) {
          await prisma.agentExecution.update({
            where: { id: scrumMasterExec.id },
            data: { output: output as any },
          });
          console.log('[Magic API] Failed tasks reset to pending');
        }
      }
    } catch (error) {
      console.error('[Magic API] Error resetting failed tasks:', error);
    }

    // 3. 개발 루프가 실행 중인지 확인 후, 실행 중이 아니면 시작
    const isActive = orchestrator.isDevelopmentActive(projectId);

    if (!isActive) {
      console.log('[Magic API] No active development loop, starting new one...');

      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        return res.status(404).json({
          error: { message: 'Project not found' },
        });
      }

      // Epic Story와 Scrum Master 결과 로드
      const epicStoryExec = await prisma.agentExecution.findFirst({
        where: { projectId, agentId: 'epic-story' },
        orderBy: { startedAt: 'desc' },
      });

      const scrumMasterExec = await prisma.agentExecution.findFirst({
        where: { projectId, agentId: 'scrum-master' },
        orderBy: { startedAt: 'desc' },
      });

      if (!epicStoryExec || !epicStoryExec.output) {
        return res.status(400).json({
          error: { message: 'Epic Story must be completed first' },
        });
      }

      if (!scrumMasterExec || !scrumMasterExec.output) {
        return res.status(400).json({
          error: { message: 'Scrum Master must be completed first' },
        });
      }

      // 비동기로 개발 루프 시작
      orchestrator.runDevelopmentLoop({
        projectId,
        project: {
          name: project.name,
          description: project.description,
          wizardLevel: project.wizardLevel,
        },
        epicStoryOutput: epicStoryExec.output,
        selectedPRD: null,
        currentEpicOrder: -1,
      }).catch(error => {
        console.error('[Magic API] Development loop error:', error);
      });

      console.log('[Magic API] Development loop started');
    } else {
      console.log('[Magic API] Development loop already active, just resumed');
    }

    res.json({
      message: 'Development resumed',
      projectId,
      paused: false,
      active: true,
    });
  } catch (error: any) {
    console.error('[Magic API] Error resuming development:', error);
    res.status(500).json({
      error: {
        message: 'Failed to resume development',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

export default router;
