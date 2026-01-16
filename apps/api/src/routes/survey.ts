import { Router } from 'express';
import { prisma } from '@magic-wand/db';
import { WizardLevel, DesignStyle, AuthType } from '@magic-wand/shared';

const router = Router();

// GET /api/survey/start - 설문조스 시작 (GET 지원)
router.get('/start', async (req, res) => {
  try {
    const { projectId, wizardLevel } = req.query;

    // 프로젝트 존재 확인
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return res.status(404).json({
        error: { message: 'Project not found' },
      });
    }

    // 설문조스키마 반환 (마법사 레벨에 따라 다름)
    const surveySchema = generateSurveySchema((wizardLevel || project.wizardLevel) as WizardLevel);

    res.json({
      projectId,
      wizardLevel: wizardLevel || project.wizardLevel,
      surveySchema,
    });
  } catch (error: any) {
    console.error('Error starting survey:', error);
    res.status(500).json({
      error: {
        message: 'Failed to start survey',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/survey/start - 설문조사 시작
router.post('/start', async (req, res) => {
  try {
    const { projectId, wizardLevel } = req.body;

    // 프로젝트 존재 확인
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return res.status(404).json({
        error: { message: 'Project not found' },
      });
    }

    // 설문조스키마 반환 (마법사 레벨에 따라 다름)
    const surveySchema = generateSurveySchema(wizardLevel || project.wizardLevel);

    res.json({
      projectId,
      wizardLevel: wizardLevel || project.wizardLevel,
      surveySchema,
    });
  } catch (error: any) {
    console.error('Error starting survey:', error);
    res.status(500).json({
      error: {
        message: 'Failed to start survey',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// GET /api/survey/:projectId - 설문조사 조회
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;

    const surveyAnswer = await prisma.surveyAnswer.findUnique({
      where: { projectId },
    });

    if (!surveyAnswer) {
      return res.status(404).json({
        error: { message: 'Survey not found' },
      });
    }

    res.json({ surveyAnswer });
  } catch (error: any) {
    console.error('Error fetching survey:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch survey',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// PUT /api/survey/:projectId - 설문조사 저장 (임시 저장)
router.put('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const answers = req.body;

    // 기존 답변이 있으면 업데이트, 없으면 생성
    const surveyAnswer = await prisma.surveyAnswer.upsert({
      where: { projectId },
      update: { answers },
      create: {
        projectId,
        answers,
        // 기본값 (제출 시에 업데이트됨)
        colorTheme: 'purple',
        designStyle: DesignStyle.MODERN,
        authType: AuthType.NONE,
        requiredPages: [],
        databaseTables: [],
        externalApis: [],
      },
    });

    res.json({ surveyAnswer });
  } catch (error: any) {
    console.error('Error saving survey:', error);
    res.status(500).json({
      error: {
        message: 'Failed to save survey',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/survey/:projectId/submit - 설문조사 제출
router.post('/:projectId/submit', async (req, res) => {
  try {
    const { projectId } = req.params;
    const {
      designTemplate,
      colorTheme,
      designStyle,
      referenceSiteUrl,
      authType,
      requiredPages,
      databaseTables,
      externalApis,
      specialRequests,
      answers,
    } = req.body;

    // 기본값 처리
    const surveyData = {
      designTemplate: designTemplate || null,
      colorTheme: colorTheme || 'purple',
      designStyle: designStyle || DesignStyle.MODERN,
      referenceSiteUrl: referenceSiteUrl || null,
      authType: authType || AuthType.NONE,
      requiredPages: requiredPages || [],
      databaseTables: databaseTables || [],
      externalApis: externalApis || [],
      specialRequests: specialRequests || null,
      answers: answers || {},
    };

    const surveyAnswer = await prisma.surveyAnswer.upsert({
      where: { projectId },
      update: surveyData,
      create: {
        projectId,
        ...surveyData,
      },
    });

    res.status(201).json({ surveyAnswer });
  } catch (error: any) {
    console.error('Error submitting survey:', error);
    res.status(500).json({
      error: {
        message: 'Failed to submit survey',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// 설문조사 스키마 생성 함수
function generateSurveySchema(wizardLevel: WizardLevel) {
  const baseSchema = {
    sections: [
      {
        id: 'design',
        title: '디자인',
        questions: [
          {
            id: 'colorTheme',
            type: 'text',
            label: '메인 색상',
            placeholder: '예: purple, blue, green...',
          },
          {
            id: 'designStyle',
            type: 'radio',
            label: '디자인 스타일',
            options: [
              { value: 'MINIMAL', label: '미니멀' },
              { value: 'MODERN', label: '모던' },
              { value: 'PLAYFUL', label: '플레이풀' },
              { value: 'COLORFUL', label: '컬러풀' },
            ],
          },
        ],
      },
      {
        id: 'features',
        title: '기능',
        questions: [
          {
            id: 'authType',
            type: 'radio',
            label: '인증',
            options: [
              { value: 'NONE', label: '없음' },
              { value: 'EMAIL', label: '이메일' },
              { value: 'SOCIAL', label: '소셜 로그인' },
            ],
          },
          {
            id: 'requiredPages',
            type: 'multiselect',
            label: '필요한 페이지',
            options: [
              { value: 'home', label: '홈' },
              { value: 'about', label: '소개' },
              { value: 'gallery', label: '갤러리' },
              { value: 'contact', label: '연락처' },
              { value: 'blog', label: '블로그' },
              { value: 'admin', label: '관리자' },
            ],
          },
        ],
      },
    ],
  };

  if (wizardLevel === WizardLevel.APPRENTICE) {
    // 인턴: 템플릿 선택 추가
    baseSchema.sections.unshift({
      id: 'template',
      title: '템플릿',
      questions: [
        {
          id: 'designTemplate',
          type: 'radio',
          label: '템플릿 선택',
          options: [
            { value: 'portfolio', label: '포트폴리오' },
            { value: 'landing', label: '랜딩 페이지' },
            { value: 'blog', label: '블로그' },
            { value: 'saas', label: 'SaaS' },
            { value: 'ecommerce', label: '이커머스' },
          ],
        },
      ],
    });
  } else if (wizardLevel === WizardLevel.ARCHMAGE) {
    // 대마법사: 추가 질문
    baseSchema.sections.push({
      id: 'advanced',
      title: '고급 설정',
      questions: [
        {
          id: 'databaseTables',
          type: 'textarea',
          label: '필요한 데이터베이스 테이블',
          placeholder: '예: User, Post, Comment...',
        },
        {
          id: 'externalApis',
          type: 'textarea',
          label: '연동할 외부 API',
          placeholder: '예: OpenAI, Stripe, Google Maps...',
        },
      ],
    });
  }

  // 모든 레벨에 공통
  baseSchema.sections.push({
    id: 'requests',
    title: '특별 요구사항',
    questions: [
      {
        id: 'specialRequests',
        type: 'textarea',
        label: '특별한 요구사항이 있으신가요?',
        placeholder: '자유롭게 작성해주세요...',
      } as any,
    ],
  });

  return baseSchema;
}

export default router;
