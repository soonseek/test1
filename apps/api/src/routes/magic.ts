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

    // Agent 실행 상태 집계
    const agentStatus = {
      total: project.agentExecutions.length,
      completed: project.agentExecutions.filter((e: any) => e.status === 'COMPLETED').length,
      running: project.agentExecutions.filter((e: any) => e.status === 'RUNNING').length,
      failed: project.agentExecutions.filter((e: any) => e.status === 'FAILED').length,
      pending: project.agentExecutions.filter((e: any) => e.status === 'IDLE' || e.status === 'WAITING').length,
    };

    console.log('[Magic API] Agent status:', agentStatus);

    res.json({
      projectId: project.id,
      projectName: project.name,
      agentStatus,
      deployment: project.deployment,
      currentAgent: project.agentExecutions.find((e: any) => e.status === 'RUNNING'),
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
      },
    });

    if (!project) {
      return res.status(404).json({
        error: { message: 'Project not found' },
      });
    }

    console.log('[Magic API] Project found:', project.name);
    console.log('[Magic API] Calling orchestrator.runAgent...');

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
    }).catch(error => {
      console.error(`[Magic API] Agent execution failed for ${agentId}:`, error);
    });

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

export default router;
