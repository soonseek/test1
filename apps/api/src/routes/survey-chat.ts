import { Router } from 'express';
import { prisma } from '@magic-wand/db';
import Anthropic from '@anthropic-ai/sdk';
import { WebSearchTool } from '@anthropic-ai/sdk/helper-tools';

const router = Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// 대화 기록 저장소 (In-memory - 실제로는 DB에 저장 권장)
const conversationHistory = new Map<string, Array<{role: string, content: string}>>();

// 사용자 경험 수준별 시스템 프롬프트
const getSystemPrompt = (experienceLevel?: 'beginner' | 'intermediate' | 'developer') => {
  const basePrompt = `너는 MAGIC WAND 플랫폼의 요구사항 분석가야.
사용자가 만들고 싶은 것에 대해 설명하면, 필요한 정보를 채팅 형태로 하나씩 질문해서 수집해야 해.

**대화 맥락 유지**:
- 사용자가 이미 응답한 내용은 다시 묻지 말아
- 수집된 collected 정보를 확인하고, 부족한 정보만 물어봐
- 경험 수준(experienceLevel)은 첫 질문에서 확정하고, 이후 질문에서 계속 활용해

**웹 서치**:
- 사용자가 참고 사이트 URL을 제공하면, 반드시 웹 서치를 해서 그 사이트의 특징을 분석해
- 디자인, 기능, 사용성 등을 파악해서 질문에 활용해

`;

  const levelGuidance = {
    beginner: `
**사용자 경험 수준**: 초보 (비개발자)
- 질문을 아주 쉽고 친근하게 해
- 기술 용어는 피하고 쉬운 말로 설명
- 디자인 위주로 질문 (어떤 느낌, 색상, 분위기 등)
- 기능은 간단하게 묻고 AI가 자동으로 결정
- 예: "어떤 색상을 좋아하세요?", "어떤 느낌의 사이트를 원하나요?"
`,
    intermediate: `
**사용자 경험 수준**: 유경험자 (개발 경험 있지만 웹은 익숙하지 않음)
- 질문을 구체적으로 하되 설명을 곁들여
- 기술적인 것과 비기술적인 것 균형 있게
- 사용자에게 선택권을 많이 주되 제안도 함께
- 예: "어떤 기능들이 필요한가요? (회원가입, 게시판, 쇼핑몰 등)",
`,
    developer: `
**사용자 경험 수준**: 개발자
- 질문을 기술적이고 구체적으로
- 아키텍처, 기술 스택, 데이터베이스 구조 등 묻기
- 최대한 사용자의 의도를 존중하고 직접 결정하도록
- 예: "ORM은 어떤 것을 선호하세요? (Prisma, TypeORM, Sequelize 등)"
`,
  };

  const commonGuidance = `
수집해야 할 정보:
1. **경험 수준에 따라 질문 깊이 조정** (experienceLevel: 가장 먼저 확정)
2. **참고 사이트 URL이 있다면 웹 서치로 분석** (referenceSite)
3. **디자인 스타일**: MINIMAL(미니멀), MODERN(모던), PLAYFUL(플레이풀), COLORFUL(컬러풀), CUSTOM(커스텀)
4. **색상 테마**: 선호하는 색상 (예: 파란색 계열, 보라색+금색 등)
5. **인증 방식**: NONE(없음), EMAIL(이메일), SOCIAL(소셜 로그인)
6. **필요한 페이지**: 리스트, 상세, 소개, 프로필, 설정 등
7. **데이터베이스 테이블**: 사용자, 게시물, 댓글, 좋아요 등
8. **외부 API**: 결제, 지도, 알림, 소셜 등
9. **특별 요구사항**: 반응형, SEO, 다크모드, 관리자 페이지 등

**중요**:
- 한 번에 한 질문씩만 해
- 질문은 친근하고 자연스럽게 해 (채팅처럼)
- 사용자의 경험 수준에 맞춰 질문의 깊이를 조절
- **이미 수집된 정보(collected)는 확인하고, 부족한 것만 물어봐**
- 모든 정보를 다 얻었다면 "completed" 상태를 반환해

**응답 형식 (JSON)**:
{
  "message": "사용자에게 보여줄 메시지",
  "state": "in_progress" | "completed",
  "collected": {
    "experienceLevel": "beginner" | "intermediate" | "developer",
    "referenceSite": "https://example.com",
    "designStyle": "MINIMAL",
    "colorTheme": "파란색",
    "authType": "EMAIL",
    "requiredPages": ["list", "detail"],
    "databaseTables": ["posts", "users"],
    "externalApis": [],
    "specialRequests": ["반응형", "SEO"],
    "techStack": {
      "framework": "Next.js",
      "database": "PostgreSQL",
      "orm": "Prisma",
      "styling": "Tailwind CSS"
    }
  }
}
`;

  return basePrompt + (levelGuidance[experienceLevel || 'intermediate']) + commonGuidance;
};

// GET /api/survey-chat/:projectId - 채팅 시작 또는 계속
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;

    // 프로젝트 정보 가져오기
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        sessionFiles: true,
      },
    });

    if (!project) {
      return res.status(404).json({ error: { message: 'Project not found' } });
    }

    // 초기 프롬프트 생성 (파일 내용 + 프로젝트 설명)
    let initialPrompt = project.description || '';
    let hasReferenceSite = false;

    // URL 추출 (참고 사이트가 있는지 확인)
    const urlMatch = initialPrompt.match(/(https?:\/\/[^\s]+)/);
    let referenceSiteUrl = urlMatch ? urlMatch[1] : null;

    if (referenceSiteUrl) {
      hasReferenceSite = true;
    }

    if (project.sessionFiles.length > 0) {
      const filesWithContent = project.sessionFiles.filter(f => f.parsedText);
      if (filesWithContent.length > 0) {
        initialPrompt += '\n\n첨부파일 내용:\n';
        filesWithContent.forEach(file => {
          initialPrompt += `\n--- ${file.fileName} ---\n${file.parsedText}\n`;
        });
      }
    }

    // 대화 기록 초기화
    if (!conversationHistory.has(projectId)) {
      conversationHistory.set(projectId, []);
    }

    // AI의 첫 질문 생성 - 먼저 경험 수준을 물어봄
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: getSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: `사용자가 다음과 같은 프로젝트를 만들고 싶어 합니다:\n\n${initialPrompt}\n\n${hasReferenceSite ? `참고 사이트: ${referenceSiteUrl}\n\n` : ''}가장 먼저 사용자의 개발 경험 수준을 물어보세요. 초보(비개발자), 유경험자(개발 경험 있음), 개발자 중 어디에 해당하는지 물어보고, 그에 맞춰 적절한 첫 번째 질문을 해주세요. ${hasReferenceSite ? '참고 사이트 URL을 활용해서 질문해주세요.' : ''} JSON으로 응답해주세요.`,
        },
      ],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '{}';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const response = JSON.parse(jsonMatch[0]);

      // 대화 기록에 추가
      const history = conversationHistory.get(projectId)!;
      history.push({ role: 'assistant', content: response.message });

      res.json({
        message: response.message,
        state: response.state || 'in_progress',
        collected: response.collected || {},
      });
    } else {
      res.json({
        message: responseText,
        state: 'in_progress',
        collected: {},
      });
    }
  } catch (error: any) {
    console.error('[Survey Chat] Error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to start chat',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/survey-chat/:projectId - 사용자 응답 처리
router.post('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { userMessage, collected } = req.body;

    // 사용자의 경험 수준 추적
    const experienceLevel = collected.experienceLevel || 'intermediate';

    // 대화 기록 가져오기
    const history = conversationHistory.get(projectId) || [];

    // 사용자 메시지를 대화 기록에 추가
    history.push({ role: 'user', content: userMessage });

    // 전체 대화 맥락 전달 (이전 대화 + 현재 메시지)
    const messages: any[] = [
      {
        role: 'user',
        content: `사용자가 다음과 같은 프로젝트를 만들고 싶어 합니다. 정보를 수집하기 위해 질문해주세요.\n\n현재까지 수집된 정보: ${JSON.stringify(collected, null, 2)}\n\n사용자 경험 수준: ${experienceLevel}\n\n다음 질문을 하거나, 정보가 충분하다면 completed 상태로 응답해주세요. JSON으로 응답해주세요.`,
      },
    ];

    // 이전 대화 기록 추가 (최근 10개만)
    const recentHistory = history.slice(-10);
    messages.push(...recentHistory);

    // AI에게 사용자 응답 전달하고 다음 질문 요청
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: getSystemPrompt(experienceLevel),
      messages,
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '{}';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const response = JSON.parse(jsonMatch[0]);

      // AI 응답을 대화 기록에 추가
      history.push({ role: 'assistant', content: response.message });

      res.json({
        message: response.message,
        state: response.state || 'in_progress',
        collected: response.collected || collected,
      });
    } else {
      res.json({
        message: responseText,
        state: 'in_progress',
        collected,
      });
    }
  } catch (error: any) {
    console.error('[Survey Chat] Error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to process message',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

// POST /api/survey-chat/:projectId/complete - 설문 완료
router.post('/:projectId/complete', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { collected } = req.body;

    console.log('[Survey Chat] Complete survey for project:', projectId);
    console.log('[Survey Chat] Collected data:', collected);

    // SurveyAnswer로 저장
    // specialRequests는 배열이면 쉼표로 구분된 문자열로 변환
    const specialRequestsStr = Array.isArray(collected.specialRequests)
      ? collected.specialRequests.join(', ')
      : collected.specialRequests || null;

    const surveyAnswer = await prisma.surveyAnswer.upsert({
      where: { projectId },
      create: {
        projectId,
        designTemplate: collected.designStyle || 'MINIMAL',
        colorTheme: collected.colorTheme || 'default',
        designStyle: collected.designStyle || 'MINIMAL',
        referenceSiteUrl: collected.referenceSite || null,
        authType: collected.authType || 'NONE',
        requiredPages: collected.requiredPages || [],
        databaseTables: collected.databaseTables || [],
        externalApis: collected.externalApis || [],
        specialRequests: specialRequestsStr,
        // techStack을 JSON 문자열로 저장
        answers: {
          ...collected,
          techStack: collected.techStack ? JSON.stringify(collected.techStack) : undefined,
        },
      },
      update: {
        designTemplate: collected.designStyle || 'MINIMAL',
        colorTheme: collected.colorTheme || 'default',
        designStyle: collected.designStyle || 'MINIMAL',
        referenceSiteUrl: collected.referenceSite || null,
        authType: collected.authType || 'NONE',
        requiredPages: collected.requiredPages || [],
        databaseTables: collected.databaseTables || [],
        externalApis: collected.externalApis || [],
        specialRequests: specialRequestsStr,
        answers: {
          ...collected,
          techStack: collected.techStack ? JSON.stringify(collected.techStack) : undefined,
        },
      },
    });

    console.log('[Survey Chat] Survey answer saved successfully');
    res.json({ surveyAnswer });
  } catch (error: any) {
    console.error('[Survey Chat] Complete error:', {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack,
    });
    res.status(500).json({
      error: {
        message: 'Failed to complete survey',
        details: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
  }
});

export default router;
