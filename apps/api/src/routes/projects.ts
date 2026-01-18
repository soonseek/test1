import { Router } from 'express';
import { prisma } from '@magic-wand/db';
import { WizardLevel } from '@magic-wand/shared';

const router = Router();

// GET /api/projects - 전체 프로젝트 목록 조회
router.get('/', async (req, res) => {
  try {
    const { includeArchived } = req.query;

    const projects = await prisma.project.findMany({
      where: includeArchived === 'true' ? {} : { isArchived: false },
      orderBy: { createdAt: 'desc' },
      include: {
        surveyAnswer: true,
        deployment: true,
        agentExecutions: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            sessionFiles: true,
            agentExecutions: true,
          },
        },
      },
    });

    // 각 프로젝트의 상태 계산
    const projectsWithStatus = projects.map(project => {
      const lastExecution = project.agentExecutions[0];
      let status = 'pending';
      let statusMessage = '설문조사 대기 중';

      if (project.deployment?.status === 'DEPLOYED') {
        status = 'deployed';
        statusMessage = '배포 완료';
      } else if (lastExecution) {
        switch (lastExecution.status) {
          case 'RUNNING':
            status = 'running';
            statusMessage = `${lastExecution.agentName} 실행 중`;
            break;
          case 'COMPLETED':
            status = 'completed';
            statusMessage = '개발 완료';
            break;
          case 'FAILED':
            status = 'failed';
            statusMessage = '실패';
            break;
          default:
            status = 'in_progress';
            statusMessage = '진행 중';
        }
      } else if (project.surveyAnswer) {
        status = 'ready';
        statusMessage = '마법 시작 준비 완료';
      }

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        wizardLevel: project.wizardLevel,
        status,
        statusMessage,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        filesCount: project._count.sessionFiles,
        executionsCount: project._count.agentExecutions,
        deployment: project.deployment ? {
          status: project.deployment.status,
          githubRepoUrl: project.deployment.githubRepoUrl,
          netlifyUrl: project.deployment.netlifyUrl,
        } : null,
      };
    });

    res.json({ projects: projectsWithStatus });
  } catch (error: any) {
    console.error('[API] Error fetching projects:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch projects',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/projects - 프로젝트 생성
router.post('/', async (req, res) => {
  try {
    const { name, description, wizardLevel } = req.body;

    const project = await prisma.project.create({
      data: {
        name,
        description,
        wizardLevel: wizardLevel || WizardLevel.APPRENTICE,
      },
    });

    res.status(201).json({ project });
  } catch (error: any) {
    console.error('Error creating project:', error);
    res.status(500).json({
      error: {
        message: 'Failed to create project',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// GET /api/projects/:id - 프로젝트 조회
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        sessionFiles: true,
        surveyAnswer: true,
        deployment: true,
        issueReports: true,
      },
    });

    if (!project) {
      return res.status(404).json({
        error: { message: 'Project not found' },
      });
    }

    res.json({ project });
  } catch (error: any) {
    console.error('Error fetching project:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch project',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// PUT /api/projects/:id - 프로젝트 수정
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, wizardLevel } = req.body;

    const project = await prisma.project.update({
      where: { id },
      data: {
        name,
        description,
        wizardLevel,
      },
    });

    res.json({ project });
  } catch (error: any) {
    console.error('Error updating project:', error);
    res.status(500).json({
      error: {
        message: 'Failed to update project',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// PATCH /api/projects/:id/archive - 프로젝트 아카이브
router.patch('/:id/archive', async (req, res) => {
  try {
    const { id } = req.params;

    const project = await prisma.project.update({
      where: { id },
      data: { isArchived: true },
    });

    res.json({ project, message: '프로젝트가 아카이브되었습니다' });
  } catch (error: any) {
    console.error('Error archiving project:', error);
    res.status(500).json({
      error: {
        message: 'Failed to archive project',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// PATCH /api/projects/:id/unarchive - 프로젝트 아카이브 해제
router.patch('/:id/unarchive', async (req, res) => {
  try {
    const { id } = req.params;

    const project = await prisma.project.update({
      where: { id },
      data: { isArchived: false },
    });

    res.json({ project, message: '프로젝트 아카이브가 해제되었습니다' });
  } catch (error: any) {
    console.error('Error unarchiving project:', error);
    res.status(500).json({
      error: {
        message: 'Failed to unarchive project',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// DELETE /api/projects/:id - 프로젝트 삭제
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.project.delete({
      where: { id },
    });

    res.json({ message: '프로젝트가 삭제되었습니다' });
  } catch (error: any) {
    console.error('Error deleting project:', error);
    res.status(500).json({
      error: {
        message: 'Failed to delete project',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

export default router;
