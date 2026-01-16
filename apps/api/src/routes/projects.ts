import { Router } from 'express';
import { prisma } from '@magic-wand/db';
import { WizardLevel } from '@magic-wand/shared';

const router = Router();

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

export default router;
