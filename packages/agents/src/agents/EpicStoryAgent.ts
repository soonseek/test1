import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { prisma } from '@magic-wand/db';
import { Anthropic } from '@anthropic-ai/sdk';

interface EpicStoryInput {
  projectId: string;
  project: {
    name: string;
    description: string;
    wizardLevel: string;
  };
  files: any[];
  survey?: any;
  selectedPRD?: any;
}

interface Epic {
  id: string; // epic-1-user-authentication
  fileName: string; // epic-1-user-authentication.md
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  order: number;
  markdown: string; // Epic markdown content
}

interface Story {
  id: string; // story-1-1-login-page
  fileName: string; // story-1-1-login-page.md
  epicId: string; // epic-1
  title: string;
  description: string;
  acceptanceCriteria: string[];
  storyPoints: number;
  priority: 'high' | 'medium' | 'low';
  order: number;
  epicOrder: number; // Epic 내에서의 순서
  markdown: string; // Story markdown content
}

interface EpicStoryOutput {
  epics: Epic[];
  stories: Story[];
  summary: {
    totalEpics: number;
    totalStories: number;
    totalStoryPoints: number;
  };
  currentStep: string;
  currentEpic?: {
    title: string;
    index: number;
    total: number;
  };
  currentStory?: {
    title: string;
    epicIndex: number;
    storyIndex: number;
    totalStories: number;
  };
}

export class EpicStoryAgent extends Agent {
  private anthropic: Anthropic;

  constructor() {
    super({
      agentId: 'epic-story',
      name: 'Epic & Story 생성',
      role: 'PRD를 기반으로 Epic과 Story를 생성합니다',
      trigger: {
        type: 'event',
        event: 'requirement.completed',
      },
      completionMode: CompletionMode.AUTO_CLOSE,
      maxRetries: 3,
      timeout: 1800, // 30분 (대규모 프로젝트)
      dependencies: [],
      contextSharing: {
        sharesTo: ['prompt-builder', 'code-generator'],
        data: ['epics', 'stories'],
      },
    });

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async execute(input: EpicStoryInput): Promise<AgentExecutionResult> {
    await this.log('Epic & Story 생성 시작', {
      projectId: input.projectId,
      projectName: input.project.name,
      hasPRD: !!input.selectedPRD,
    });

    try {
      // 선택된 PRD 가져오기
      const selectedPRD = await this.getSelectedPRD(input.projectId);
      if (!selectedPRD) {
        throw new Error('선택된 PRD를 찾을 수 없습니다');
      }

      await this.log('PRD 로드 완료', {
        prdName: selectedPRD.name,
      });

      // Phase 1: Epic 목록 생성 및 각 Epic 생성
      await this.log('Epic 목록 생성 시작');
      await this.updateProgress(input.projectId, {
        currentStep: 'Epic 분석 및 목록 생성 중...',
        epics: [],
        stories: [],
      });

      const epics = await this.generateEpicsWithStreaming(selectedPRD, input);

      await this.log('Epic 생성 완료', {
        totalEpics: epics.length,
      });

      // Phase 2: 각 Epic마다 Story 생성
      await this.log('Story 생성 시작');

      const allStories: Story[] = [];
      for (let epicIndex = 0; epicIndex < epics.length; epicIndex++) {
        const epic = epics[epicIndex];

        await this.updateProgress(input.projectId, {
          currentStep: `Epic ${epicIndex + 1}/${epics.length}의 Story 생성 중...`,
          epics,
          stories: allStories,
          currentEpic: {
            title: epic.title,
            index: epicIndex + 1,
            total: epics.length,
          },
        });

        const stories = await this.generateStoriesForEpic(
          selectedPRD,
          epic,
          input.projectId,
          epicIndex,
          epics.length,
          allStories.length
        );

        allStories.push(...stories);

        // Epic이 완료될 때마다 즉시 저장 (실시간 UI 반영)
        await this.saveToDatabase(input.projectId, {
          epics,
          stories: allStories,
          summary: {
            totalEpics: epics.length,
            totalStories: allStories.length,
            totalStoryPoints: allStories.reduce((sum, s) => sum + s.storyPoints, 0),
          },
          currentStep: `Epic ${epicIndex + 1}/${epics.length} 완료. Story ${allStories.length}개 생성됨`,
        } as any);
      }

      await this.log('모든 Story 생성 완료', {
        totalStories: allStories.length,
      });

      const finalOutput: EpicStoryOutput = {
        epics,
        stories: allStories,
        summary: {
          totalEpics: epics.length,
          totalStories: allStories.length,
          totalStoryPoints: allStories.reduce((sum, s) => sum + s.storyPoints, 0),
        },
        currentStep: 'completed',
      };

      // 최종 저장
      await this.saveToDatabase(input.projectId, finalOutput);

      await this.log('Epic & Story 생성 완료', {
        totalEpics: finalOutput.summary.totalEpics,
        totalStories: finalOutput.summary.totalStories,
        totalStoryPoints: finalOutput.summary.totalStoryPoints,
      });

      return {
        status: AgentStatus.COMPLETED,
        output: finalOutput,
      };
    } catch (error: any) {
      await this.logError(error);
      return {
        status: AgentStatus.FAILED,
        error: {
          message: error.message,
          stackTrace: error.stack,
          retryable: this.isRetryable(error),
        },
      };
    }
  }

  private async getSelectedPRD(projectId: string): Promise<any> {
    const execution = await prisma.agentExecution.findFirst({
      where: {
        projectId,
        agentId: 'requirement-analyzer',
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    if (!execution || !execution.output) {
      return null;
    }

    const output = execution.output as any;
    return output.selectedPRD || (output.prdOptions && output.prdOptions[0]);
  }

  private async generateEpicsWithStreaming(prd: any, input: EpicStoryInput): Promise<Epic[]> {
    const prompt = this.buildEpicListPrompt(prd, input);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const epicList = this.parseEpicListResponse(text);

      // 각 Epic의 markdown 생성
      const epics: Epic[] = [];
      for (let i = 0; i < epicList.length; i++) {
        const epicData = epicList[i];

        await this.updateProgress(input.projectId, {
          currentStep: `Epic ${i + 1}/${epicList.length} 생성 중: ${epicData.title}`,
        });

        const epicMarkdown = await this.generateEpicMarkdown(prd, epicData, input);

        const epic: Epic = {
          id: `epic-${i + 1}-${this.toKebabCase(epicData.title)}`,
          fileName: `epic-${i + 1}-${this.toKebabCase(epicData.title)}.md`,
          title: epicData.title,
          description: epicData.description,
          priority: epicData.priority,
          order: i + 1,
          markdown: epicMarkdown,
        };

        epics.push(epic);

        // Epic이 생성될 때마다 즉시 UI 업데이트
        await this.saveToDatabase(input.projectId, {
          epics,
          stories: [],
          summary: {
            totalEpics: epics.length,
            totalStories: 0,
            totalStoryPoints: 0,
          },
          currentStep: `${i + 1}/${epicList.length} Epic 생성됨`,
        } as any);
      }

      return epics;
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`Epic 생성 실패: ${error.message}`);
    }
  }

  private async generateStoriesForEpic(
    prd: any,
    epic: Epic,
    projectId: string,
    epicIndex: number,
    totalEpics: number,
    previousStoryCount: number
  ): Promise<Story[]> {
    const prompt = this.buildStoriesForEpicPrompt(prd, epic);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 16384,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const storyList = this.parseStoryListResponse(text);

      const stories: Story[] = [];
      for (let i = 0; i < storyList.length; i++) {
        const storyData = storyList[i];

        await this.updateProgress(projectId, {
          currentStep: `Story 생성 중: ${storyData.title}`,
          currentStory: {
            title: storyData.title,
            epicIndex: epicIndex + 1,
            storyIndex: i + 1,
            totalStories: storyList.length,
          },
        });

        const storyMarkdown = this.generateStoryMarkdown(storyData, epicIndex + 1, i + 1);

        const story: Story = {
          id: `story-${epic.order}-${i + 1}-${this.toKebabCase(storyData.title)}`,
          fileName: `story-${epic.order}-${i + 1}-${this.toKebabCase(storyData.title)}.md`,
          epicId: epic.id,
          title: storyData.title,
          description: storyData.description,
          acceptanceCriteria: storyData.acceptanceCriteria,
          storyPoints: storyData.storyPoints,
          priority: storyData.priority,
          order: previousStoryCount + i + 1,
          epicOrder: i + 1,
          markdown: storyMarkdown,
        };

        stories.push(story);
      }

      return stories;
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`Story 생성 실패: ${error.message}`);
    }
  }

  private buildEpicListPrompt(prd: any, input: EpicStoryInput): string {
    const prdContent = prd.analysisMarkdown || JSON.stringify(prd.analysis, null, 2);

    return `# Epic 목록 생성 요청

당신은 BMad Method와 Moai ADK를 숙달한 시니어 Product Manager입니다.
제공된 PRD를 기반으로 **여러 Epic**을 생성해주세요.

## 프로젝트 정보
- **프로젝트명**: ${input.project.name}
- **설명**: ${input.project.description}
- **마법사 레벨**: ${input.project.wizardLevel}

## PRD 내용
\`\`\`
${prdContent.substring(0, 15000)}
\`\`\`

## Epic 분해 원칙

1. **Epic 정의**: 큰 사용자 가치를 제공하는 기능 그룹
2. **적절한 크기**: 각 Epic은 2-5개의 Story로 구성
3. **독립성**: 각 Epic은 가능한 독립적으로 개발 가능
4. **우선순위**: 비즈니스 가치와 의존관계 고려

## Epic 구조

각 Epic은 다음을 포함:
- **title**: Epic 명 (예: "사용자 인증 시스템")
- **description**: 2-3문단 설명
- **priority**: high/medium/low

## 출력 형식

JSON 배열로 출력하세요:

\`\`\`json
[
  {
    "title": "사용자 인증 및 계정 관리",
    "description": "회원가입, 로그인, 프로필 관리 등 사용자 인증과 계정 관련 기능을 제공합니다...",
    "priority": "high"
  },
  {
    "title": "할 일 관리",
    "description": "사용자가 할 일을 생성, 수정, 삭제하고 카테고리별로 정리할 수 있습니다...",
    "priority": "high"
  },
  {
    "title": "알림 및 리마인더",
    "description": "설정된 시간에 사용자에게 푸시 알림을 보내고 리마인더를 관리합니다...",
    "priority": "medium"
  }
]
\`\`\`

중요: 프로젝트 규모에 맞게 적절한 수의 Epic을 생성하세요 (보통 3-7개).
`;
  }

  private buildStoriesForEpicPrompt(prd: any, epic: Epic): string {
    return `# Story 목록 생성 요청

당신은 Superpowers의 "writing-plans" 스킬을 숙달한 시니어 개발자입니다.
제공된 Epic을 **2-5분 태스크**로 분해하여 Story 목록을 생성해주세요.

## Epic

\`\`\`markdown
${epic.markdown}
\`\`\`

## Story 분해 원칙

1. **태스크 크기**: 2-5분에 구현 가능
2. **독립적**: 각 Story는 독립적으로 구현 가능
3. **명확한 완료 조건**: 인수 조건이 구체적이고 테스트 가능

## 출력 형식

JSON 배열로 출력하세요:

\`\`\`json
[
  {
    "title": "로그인 페이지 구현",
    "description": "이메일과 비밀번호를 입력하는 로그인 폼을 구현합니다",
    "acceptanceCriteria": [
      "이메일 입력 필드가 있다",
      "비밀번호 입력 필드가 있다",
      "로그인 버튼이 있다",
      "입력 값 검증이 된다"
    ],
    "storyPoints": 3,
    "priority": "high"
  },
  ...
]
\`\`\`

중요: Epic의 범위에 맞게 적절한 수의 Story를 생성하세요 (보통 3-8개).
`;
  }

  private parseEpicListResponse(text: string): any[] {
    console.log('[EpicStory] ========== Parsing Epic list JSON ==========');
    console.log('[EpicStory] Response length:', text.length);
    console.log('[EpicStory] First 300 chars:', text.substring(0, 300));

    let jsonText = null;
    let extractionMethod = '';

    // Method 1: Standard ```json code block
    let jsonMatch = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
      extractionMethod = 'Standard ```json block';
    }

    // Method 2: Try without language specification
    if (!jsonText) {
      jsonMatch = text.match(/```\s*\n?([\s\S]*?)\n?\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
        extractionMethod = 'Plain ``` block';
      }
    }

    // Method 3: Look for array pattern [...]
    if (!jsonText) {
      jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
        extractionMethod = 'Direct JSON array';
      }
    }

    if (!jsonText) {
      console.error('[EpicStory] ❌ Could not extract Epic list JSON');
      console.error('[EpicStory] Last 500 chars:', text.substring(text.length - 500));
      throw new Error('LLM response does not contain valid Epic list JSON');
    }

    console.log('[EpicStory] ✓ JSON extracted using:', extractionMethod);
    console.log('[EpicStory] Extracted JSON length:', jsonText.length);

    // Clean up trailing commas
    jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');

    try {
      const parsed = JSON.parse(jsonText);
      console.log('[EpicStory] ✓✓✓ Epic list parsed successfully!');
      console.log('[EpicStory] Number of epics:', parsed.length);
      return parsed;
    } catch (e: any) {
      console.error('[EpicStory] ❌ JSON parsing FAILED:', e.message);
      const posMatch = e.message.match(/position (\d+)/);
      if (posMatch) {
        const pos = parseInt(posMatch[1]);
        const start = Math.max(0, pos - 200);
        const end = Math.min(jsonText.length, pos + 200);
        console.error('[EpicStory] Error context:', jsonText.substring(start, end));
      }
      console.error('[EpicStory] Full JSON:', jsonText);
      throw new Error(`Epic 목록 파싱 실패: ${e.message}`);
    }
  }

  private parseStoryListResponse(text: string): any[] {
    console.log('[EpicStory] ========== Parsing Story list JSON ==========');
    console.log('[EpicStory] Response length:', text.length);
    console.log('[EpicStory] First 300 chars:', text.substring(0, 300));

    let jsonText = null;
    let extractionMethod = '';

    // Method 1: Standard ```json code block
    let jsonMatch = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
      extractionMethod = 'Standard ```json block';
    }

    // Method 2: Try without language specification
    if (!jsonText) {
      jsonMatch = text.match(/```\s*\n?([\s\S]*?)\n?\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
        extractionMethod = 'Plain ``` block';
      }
    }

    // Method 3: Look for array pattern [...]
    if (!jsonText) {
      jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
        extractionMethod = 'Direct JSON array';
      }
    }

    if (!jsonText) {
      console.error('[EpicStory] ❌ Could not extract Story list JSON');
      console.error('[EpicStory] Last 500 chars:', text.substring(text.length - 500));
      throw new Error('LLM response does not contain valid Story list JSON');
    }

    console.log('[EpicStory] ✓ JSON extracted using:', extractionMethod);
    console.log('[EpicStory] Extracted JSON length:', jsonText.length);

    // Clean up trailing commas
    jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');

    try {
      const parsed = JSON.parse(jsonText);
      console.log('[EpicStory] ✓✓✓ Story list parsed successfully!');
      console.log('[EpicStory] Number of stories:', parsed.length);
      return parsed;
    } catch (e: any) {
      console.error('[EpicStory] ❌ JSON parsing FAILED:', e.message);
      const posMatch = e.message.match(/position (\d+)/);
      if (posMatch) {
        const pos = parseInt(posMatch[1]);
        const start = Math.max(0, pos - 200);
        const end = Math.min(jsonText.length, pos + 200);
        console.error('[EpicStory] Error context:', jsonText.substring(start, end));
      }
      console.error('[EpicStory] Full JSON:', jsonText);
      throw new Error(`Story 목록 파싱 실패: ${e.message}`);
    }
  }

  private async generateEpicMarkdown(prd: any, epicData: any, input: EpicStoryInput): Promise<string> {
    const prdContent = prd.analysisMarkdown || JSON.stringify(prd.analysis, null, 2);

    const prompt = `# Epic 문서 생성 요청

다음 Epic에 대한 상세 Markdown 문서를 생성해주세요.

## Epic 정보
- **제목**: ${epicData.title}
- **설명**: ${epicData.description}
- **우선순위**: ${epicData.priority}

## 프로젝트 PRD
\`\`\`
${prdContent.substring(0, 10000)}
\`\`\`

## Epic.md 작성 가이드

다음 구조로 Markdown 문서를 생성하세요:

\`\`\`markdown
# Epic: ${epicData.title}

## Epic 개요
**Epic ID**: EPIC-${this.toEpicId(epicData.title)}
**우선순위**: ${epicData.priority}

## 설명
${epicData.description}

## 범위 (Scope)

### IN Scope
- 이 Epic에 포함될 기능들 나열

### OUT Scope
- 이 Epic에 포함되지 않을 기능들 나열

## 기술적 고려사항
- 기술 스택 제약사항 고려
- 다른 Epic과의 의존관계

## 성공 기준
- [ ] 모든 Story가 정의됨
- [ ] 인수 조건이 충족됨
- [ ] 테스트가 통과함

## User Stories 목록
개별 Story는 이곳에 간단히 나열 (상세 내용은 별도 Story 파일 참조)
`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.extractMarkdown(text);
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`Epic markdown 생성 실패: ${error.message}`);
    }
  }

  private generateStoryMarkdown(story: any, epicNumber: number, storyNumber: number): string {
    return `# Story ${epicNumber}-${storyNumber}: ${story.title}

**Story ID**: STORY-${epicNumber}-${storyNumber}
**Story Points**: ${story.storyPoints}
**Priority**: ${story.priority}

## 설명
${story.description}

## 인수 조건 (Acceptance Criteria)
${story.acceptanceCriteria.map((criteria: string, i: number) => `${i + 1}. [ ] ${criteria}`).join('\n')}

## 기술 노트
- Next.js 14+ App Router 사용
- shadcn/ui 컴포넌트 활용
- Prisma를 통한 DB 연동

## 완료 정의 (Definition of Done)
- [ ] 모든 인수 조건이 충족됨
- [ ] 코드가 커밋됨
- [ ] 기본 동작이 확인됨
`;
  }

  private extractMarkdown(text: string): string {
    const match = text.match(/```markdown\n([\s\S]*?)\n```/);
    if (match) {
      return match[1];
    }
    return text;
  }

  private toKebabCase(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s-]/g, '') // 특수문자 제거
      .replace(/\s+/g, '-') // 공백을 하이픈으로
      .substring(0, 50); // 길이 제한
  }

  private toEpicId(title: string): string {
    // 간단한 ID 생성 (실제로는 더 정교한 로직 필요)
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  private async saveToDatabase(projectId: string, output: EpicStoryOutput): Promise<void> {
    try {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          epicMarkdown: JSON.stringify({
            epics: output.epics,
            stories: output.stories,
          }, null, 2),
          storyFiles: output.stories as any,
        },
      });
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`DB 저장 실패: ${error.message}`);
    }
  }

  private async updateProgress(projectId: string, progress: Partial<EpicStoryOutput>): Promise<void> {
    try {
      const execution = await prisma.agentExecution.findFirst({
        where: {
          projectId,
          agentId: 'epic-story',
          status: 'RUNNING',
        },
        orderBy: {
          startedAt: 'desc',
        },
      });

      if (execution) {
        const currentOutput = (execution.output as any) || {};
        const updatedOutput = { ...currentOutput, ...progress };

        await prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            output: updatedOutput as any,
          },
        });
      }
    } catch (error) {
      console.error('[EpicStory] Failed to update progress:', error);
    }
  }

  private isRetryable(error: any): boolean {
    return error.message?.includes('timeout') ||
           error.message?.includes('rate limit') ||
           error.code === 'ECONNRESET';
  }
}
