import { Router } from 'express';
import { prisma } from '@magic-wand/db';
import { WizardLevel } from '@magic-wand/shared';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// POST /api/projects/from-prompt - 프롬프트로 프로젝트 생성
router.post('/from-prompt', async (req, res) => {
  try {
    const { prompt, files = [], wizardLevel = 'APPRENTICE' } = req.body;

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({
        error: { message: '프롬프트를 입력해주세요' },
      });
    }

    console.log('[API] Generating project from prompt:', prompt.substring(0, 100));

    // AI로 프로젝트명과 설명 생성
    let projectName = '';
    let projectDescription = '';

    try {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `다음 사용자 요청을 분석해서 적절한 프로젝트명(영문, 소문자, 하이픈만 사용, GitHub 레포지토리명으로 적합)과 간단한 설명(한국어, 2-3문장)을 생성해주세요.

사용자 요청:
${prompt}

출력 형식 (JSON):
{
  "name": "project-name-in-english",
  "description": "한국어로 된 간단한 프로젝트 설명 2-3문장"
}

JSON만 출력해주세요.`,
          },
        ],
      });

      const responseText = message.content[0].type === 'text' ? message.content[0].text : '{}';

      // JSON 파싱
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        projectName = parsed.name || 'my-project';
        projectDescription = parsed.description || prompt.substring(0, 200);
      } else {
        throw new Error('Failed to parse AI response');
      }
    } catch (error) {
      console.error('[API] AI generation failed, using fallback:', error);
      // Fallback: 프롬프트의 첫 문장을 프로젝트명으로 사용
      projectName = prompt
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .substring(0, 50)
        .replace(/\s+/g, '-');
      projectDescription = prompt.substring(0, 200);
    }

    // 프로젝트 생성
    const project = await prisma.project.create({
      data: {
        name: projectName,
        description: projectDescription,
        wizardLevel: wizardLevel as WizardLevel,
      },
    });

    // 파일이 있는 경우 SessionFile로 저장
    if (files.length > 0) {
      await prisma.sessionFile.createMany({
        data: files.map((file: any) => ({
          projectId: project.id,
          s3Key: file.s3Key,
          fileName: file.fileName,
          fileType: file.fileType,
          fileSize: file.fileSize,
          description: prompt, // 파일 설명으로 프롬프트 사용
        })),
      });
    }

    console.log('[API] Project created:', project.id);

    res.status(201).json({
      project,
      message: '프로젝트가 생성되었습니다',
    });
  } catch (error: any) {
    console.error('[API] Error creating project from prompt:', error);
    res.status(500).json({
      error: {
        message: '프로젝트 생성 실패',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

export default router;
