import { Router } from 'express';
import { prisma } from '@magic-wand/db';
import { getEventBus } from '@magic-wand/agent-framework';

const router = Router();

// POST /api/issues/slack - Slack에서 이슈 리포트 수신 (Webhook)
router.post('/slack', async (req, res) => {
  try {
    const { text, user_id, channel_id, team_id } = req.body;

    if (!text) {
      return res.status(400).json({
        text: '이슈 내용을 입력해주세요. 예: `/magic-wand-issue 모바일에서 메뉴가 안 열려요`',
      });
    }

    // Slack Command인 경우 응답
    if (req.body.command) {
      // 가장 최근 배포된 프로젝트 찾기
      const latestProject = await prisma.project.findFirst({
        where: {
          deployment: {
            status: 'DEPLOYED',
          },
        },
        include: {
          deployment: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!latestProject) {
        return res.json({
          text: '배포된 프로젝트를 찾을 수 없습니다.',
        });
      }

      // 이슈 생성
      const issueReport = await prisma.issueReport.create({
        data: {
          projectId: latestProject.id,
          slackChannel: channel_id,
          slackTs: Date.now().toString(),
          issue: text,
          status: 'OPEN',
        },
      });

      // Event Bus로 이벤트 발행
      const eventBus = getEventBus();
      await eventBus.publish('issue.reported', {
        issueId: issueReport.id,
        projectId: latestProject.id,
        issue: text,
        slackChannel: channel_id,
        deployment: latestProject.deployment,
      });

      return res.json({
        text: `🔍 이슈를 분석 중입니다...\n\n프로젝트: ${latestProject.name}\n이슈: ${text}`,
      });
    }

    res.json({ ok: true });
  } catch (error: any) {
    console.error('Error handling Slack webhook:', error);
    res.status(500).json({
      error: {
        message: 'Failed to handle Slack webhook',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// GET /api/issues/:projectId - 이슈 목록 조회
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;

    const issues = await prisma.issueReport.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ issues });
  } catch (error: any) {
    console.error('Error fetching issues:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch issues',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// GET /api/issues/:issueId - 이슈 상세 조회
router.get('/detail/:issueId', async (req, res) => {
  try {
    const { issueId } = req.params;

    const issue = await prisma.issueReport.findUnique({
      where: { id: issueId },
      include: {
        project: {
          include: {
            deployment: true,
          },
        },
      },
    });

    if (!issue) {
      return res.status(404).json({
        error: { message: 'Issue not found' },
      });
    }

    res.json({ issue });
  } catch (error: any) {
    console.error('Error fetching issue:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch issue',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

export default router;
