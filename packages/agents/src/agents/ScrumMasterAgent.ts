import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { prisma } from '@magic-wand/db';
import { Anthropic } from '@anthropic-ai/sdk';

interface ScrumMasterInput {
  projectId: string;
  project: {
    name: string;
    description: string;
    wizardLevel: string;
  };
}

interface Task {
  id: string; // task-1-1-1 (epic-story-task)
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  assignedTo: 'developer' | 'code-reviewer' | 'tester';
  priority: 'high' | 'medium' | 'low';
  storyId: string; // story-1-1
  epicOrder: number;
  storyOrder: number;
  taskOrder: number;
}

interface ScrumMasterOutput {
  currentPhase: 'task-creation' | 'review-analysis' | 'test-analysis' | 'completed';
  currentEpic?: {
    order: number;
    title: string;
    total: number;
  };
  currentStory?: {
    epicOrder: number;
    storyOrder: number;
    title: string;
    totalTasks: number;
  };
  tasks: Task[];
  taskListMarkdown: string; // Current task list in MD format
  summary: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
  };
  reviewFailures?: any[]; // From code reviewer
  testFailures?: any[]; // From tester
}

export class ScrumMasterAgent extends Agent {
  private anthropic: Anthropic;

  constructor() {
    super({
      agentId: 'scrum-master',
      name: 'Scrum Master',
      role: 'Task List 생성 및 관리, 코드 리뷰/테스트 실패 분석',
      trigger: {
        type: 'event',
        event: 'development.needed',
      },
      completionMode: CompletionMode.AUTO_CLOSE,
      maxRetries: 3,
      timeout: 3600, // 60분
      dependencies: [],
      contextSharing: {
        sharesTo: ['developer', 'code-reviewer', 'tester'],
        data: ['tasks', 'currentStory', 'currentEpic'],
      },
    });

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async execute(input: ScrumMasterInput): Promise<AgentExecutionResult> {
    await this.log('Scrum Master 작업 시작', {
      projectId: input.projectId,
    });

    try {
      // 1. PRD, Epic, Story 로드
      const selectedPRD = await this.getSelectedPRD(input.projectId);
      if (!selectedPRD) {
        throw new Error('선택된 PRD를 찾을 수 없습니다');
      }

      const epicStoryData = await this.getEpicStoryData(input.projectId);

      await this.log('Epic & Story 데이터 로드 완료', {
        totalEpics: epicStoryData.epics.length,
        totalStories: epicStoryData.stories.length,
      });

      // 2. 이전 진행 상황 확인
      const previousExecution = await this.getPreviousExecution(input.projectId);
      const currentPhase = this.determinePhase(previousExecution, epicStoryData);

      await this.log('현재 단계 확인', {
        phase: currentPhase,
        previousExecutions: previousExecution?.length || 0,
      });

      let output: ScrumMasterOutput;

      // 3. Phase별 작업 수행
      if (currentPhase === 'task-creation') {
        output = await this.generateTaskList(epicStoryData, selectedPRD, input);
      } else if (currentPhase === 'review-analysis') {
        output = await this.analyzeReviewFailures(epicStoryData, previousExecution, input);
      } else if (currentPhase === 'test-analysis') {
        output = await this.analyzeTestFailures(epicStoryData, previousExecution, input);
      } else {
        // All completed - move to next story or epic
        output = await this.moveToNextStory(epicStoryData, previousExecution, input);
      }

      // 4. DB 저장
      await this.saveToDatabase(input.projectId, output);

      await this.log('Scrum Master 작업 완료', {
        currentPhase: output.currentPhase,
        totalTasks: output.summary.totalTasks,
      });

      return {
        status: AgentStatus.COMPLETED,
        output,
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

  private async getEpicStoryData(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        epicMarkdown: true,
        storyFiles: true,
      },
    });

    if (!project) {
      throw new Error('프로젝트를 찾을 수 없습니다');
    }

    let epics: any[] = [];
    let stories: any[] = [];

    if (project.epicMarkdown) {
      const epicData = JSON.parse(project.epicMarkdown);
      epics = epicData.epics || [];
      stories = epicData.stories || [];
    }

    return { epics, stories };
  }

  private async getPreviousExecution(projectId: string) {
    return await prisma.agentExecution.findMany({
      where: {
        projectId,
        agentId: { in: ['scrum-master', 'developer', 'code-reviewer', 'tester'] },
      },
      orderBy: {
        startedAt: 'desc',
      },
      take: 10,
    });
  }

  private determinePhase(previousExecutions: any[], epicStoryData: any): 'task-creation' | 'review-analysis' | 'test-analysis' | 'completed' {
    if (!previousExecutions || previousExecutions.length === 0) {
      return 'task-creation';
    }

    // 가장 최근 실행 확인
    const latest = previousExecutions[0];

    // Code Reviewer가 실패한 경우
    if (latest.agentId === 'code-reviewer' && latest.status === 'FAILED') {
      return 'review-analysis';
    }

    // Tester가 실패한 경우
    if (latest.agentId === 'tester' && latest.status === 'FAILED') {
      return 'test-analysis';
    }

    // Developer가 완료되면 다음 task 생성 필요
    if (latest.agentId === 'developer' && latest.status === 'COMPLETED') {
      // 현재 story의 모든 task가 완료되었는지 확인
      // 이 로직은 generateTaskList에서 처리
      return 'task-creation';
    }

    // Scrum Master 자신이 이전에 실행된 경우
    if (latest.agentId === 'scrum-master') {
      const output = latest.output as any;
      if (output.currentPhase === 'completed') {
        return 'task-creation'; // Move to next story
      }
    }

    return 'task-creation';
  }

  private async generateTaskList(
    epicStoryData: { epics: any[]; stories: any[] },
    prd: any,
    input: ScrumMasterInput
  ): Promise<ScrumMasterOutput> {
    await this.log('Task List 생성 시작');

    // 이전 완료된 story 찾기
    const previousExecution = await this.getPreviousExecution(input.projectId);
    const completedStories = new Set<string>();

    for (const exec of previousExecution) {
      const output = exec.output as any;
      if (output && output.currentStory) {
        const storyKey = `${output.currentStory.epicOrder}-${output.currentStory.storyOrder}`;
        if (exec.status === 'COMPLETED') {
          completedStories.add(storyKey);
        }
      }
    }

    // 현재 진행할 story 찾기
    let currentEpic: any = null;
    let currentStory: any = null;
    let epicOrder = 0;
    let storyOrder = 0;

    for (const epic of epicStoryData.epics) {
      epicOrder++;
      const storiesInEpic = epicStoryData.stories.filter((s: any) => s.epicId === epic.id);

      for (const story of storiesInEpic) {
        storyOrder++;
        const storyKey = `${epicOrder}-${storyOrder}`;

        if (!completedStories.has(storyKey)) {
          currentEpic = epic;
          currentStory = story;
          break;
        }
      }

      if (currentStory) break;
      storyOrder = 0;
    }

    if (!currentStory) {
      // 모든 story 완료
      await this.log('모든 Story 완료!');
      return {
        currentPhase: 'completed',
        tasks: [],
        taskListMarkdown: '# 모든 Story 완료 ✅\n\n모든 Epic과 Story가 완료되었습니다.',
        summary: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
        },
      } as ScrumMasterOutput;
    }

    await this.log('Task List 생성 중', {
      epic: currentEpic.title,
      story: currentStory.title,
    });

    // LLM을 통한 Task 생성
    const tasks = await this.generateTasksForStory(prd, currentEpic, currentStory, epicOrder, storyOrder);

    // Task List Markdown 생성
    const taskListMarkdown = this.generateTaskListMarkdown(currentEpic, currentStory, tasks);

    const output: ScrumMasterOutput = {
      currentPhase: 'task-creation',
      currentEpic: {
        order: epicOrder,
        title: currentEpic.title,
        total: epicStoryData.epics.length,
      },
      currentStory: {
        epicOrder,
        storyOrder,
        title: currentStory.title,
        totalTasks: tasks.length,
      },
      tasks,
      taskListMarkdown,
      summary: {
        totalTasks: tasks.length,
        completedTasks: 0,
        failedTasks: 0,
      },
    };

    await this.log('Task List 생성 완료', {
      taskCount: tasks.length,
    });

    return output;
  }

  private async generateTasksForStory(
    prd: any,
    epic: any,
    story: any,
    epicOrder: number,
    storyOrder: number
  ): Promise<Task[]> {
    const prompt = this.buildTaskGenerationPrompt(prd, epic, story);

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
      const taskList = this.parseTaskListResponse(text);

      return taskList.map((taskData: any, index: number) => ({
        id: `task-${epicOrder}-${storyOrder}-${index + 1}`,
        title: taskData.title,
        description: taskData.description,
        status: 'pending' as const,
        assignedTo: 'developer' as const,
        priority: taskData.priority || 'medium',
        storyId: story.id,
        epicOrder,
        storyOrder,
        taskOrder: index + 1,
      }));
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`Task 생성 실패: ${error.message}`);
    }
  }

  private buildTaskGenerationPrompt(prd: any, epic: any, story: any): string {
    const prdContent = prd.analysisMarkdown || JSON.stringify(prd.analysis, null, 2);

    return `# Task List 생성 요청

당신은 BMad Method를 숙달한 Scrum Master입니다.
제공된 Epic과 Story를 **세부 Task(2-5분 태스크)**로 분해하여 Task List를 생성해주세요.

## Story 정보

### Epic
\`\`\`markdown
${epic.markdown}
\`\`\`

### Story
\`\`\`markdown
${story.markdown}
\`\`\`

## 프로젝트 PRD (참고용)
\`\`\`
${prdContent.substring(0, 10000)}
\`\`\`

## Task 분해 원칙

1. **태스크 크기**: 2-5분에 구현 가능한 세부 작업
2. **개발자 친화적**: 개발자가 바로 구현할 수 있을 정도로 구체적
3. **순서 고려**: 의존관계를 고려한 논리적 순서
4. **테스트 가능**: 각 태스크는 독립적으로 테스트 가능

## Task 구조

각 Task는 다음을 포함:
- **title**: 태스크 제목 (구체적 행동 중심)
- **description**: 상세 설명 (구현 내용, 파일 경로, 함수명 등)
- **priority**: high/medium/low

## 출력 형식

JSON 배열로 출력하세요:

\`\`\`json
[
  {
    "title": "로그인 페이지 컴포넌트 생성",
    "description": "apps/web/src/app/login/page.tsx에 로그인 폼 컴포넌트를 구현합니다. 이메일 입력 필드, 비밀번호 입력 필드, 로그인 버튼을 포함합니다. shadcn/ui의 Form 컴포넌트를 활용합니다.",
    "priority": "high"
  },
  {
    "title": "로그인 API 라우트 구현",
    "description": "apps/api/src/routes/auth.ts에 POST /api/auth/login 엔드포인트를 구현합니다. Prisma를 통해 User 테이블을 조회하고 bcrypt로 비밀번호를 검증합니다.",
    "priority": "high"
  }
]
\`\`\`

중요: Story의 범위에 맞게 적절한 수의 Task를 생성하세요 (보통 5-15개).
`;
  }

  private parseTaskListResponse(text: string): any[] {
    try {
      const jsonMatch = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
      if (jsonMatch) {
        const jsonText = jsonMatch[1];
        const cleaned = jsonText.replace(/,(\s*[}\]])/g, '$1');
        return JSON.parse(cleaned);
      }

      // Fallback: try to find array directly
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        return JSON.parse(arrayMatch[0]);
      }

      throw new Error('JSON response not found');
    } catch (error: any) {
      console.error('[ScrumMaster] Failed to parse task list:', error);
      throw new Error(`Task 목록 파싱 실패: ${error.message}`);
    }
  }

  private generateTaskListMarkdown(epic: any, story: any, tasks: Task[]): string {
    let markdown = `# Task List: ${story.title}\n\n`;

    markdown += `**Epic**: ${epic.title}\n`;
    markdown += `**Story**: ${story.title}\n`;
    markdown += `**Story Points**: ${story.storyPoints}\n`;
    markdown += `**총 Task**: ${tasks.length}개\n\n`;

    markdown += `---\n\n`;

    markdown += `## Tasks\n\n`;

    tasks.forEach((task, index) => {
      markdown += `### ${index + 1}. ${task.title}\n\n`;
      markdown += `- **Task ID**: ${task.id}\n`;
      markdown += `- **Priority**: ${task.priority}\n`;
      markdown += `- **Status**: ${task.status}\n`;
      markdown += `- **Assigned To**: ${task.assignedTo}\n\n`;
      markdown += `**설명**:\n${task.description}\n\n`;
      markdown += `---\n\n`;
    });

    return markdown;
  }

  private async analyzeReviewFailures(
    epicStoryData: any,
    previousExecutions: any[],
    input: ScrumMasterInput
  ): Promise<ScrumMasterOutput> {
    await this.log('Code Review 실패 분석 시작');

    // Code Reviewer의 실패 원인 분석
    const codeReviewerExec = previousExecutions.find(e => e.agentId === 'code-reviewer' && e.status === 'FAILED');

    if (!codeReviewerExec || !codeReviewerExec.output) {
      throw new Error('Code Reviewer 실행 결과를 찾을 수 없습니다');
    }

    const reviewOutput = codeReviewerExec.output as any;
    const failures = reviewOutput.failures || [];

    await this.log('Code Review 실패 사유', {
      failureCount: failures.length,
    });

    // 실패 원인을 분석하여 추가 Task 생성
    const additionalTasks = await this.generateTasksFromFailures(
      failures,
      epicStoryData,
      input,
      'code-review'
    );

    await this.log('추가 Task 생성 완료', {
      additionalTaskCount: additionalTasks.length,
    });

    // 이전 task list 로드
    const scrumMasterExec = previousExecutions.find(e => e.agentId === 'scrum-master');
    const existingTasks = scrumMasterExec?.output?.tasks || [];

    const output: ScrumMasterOutput = {
      currentPhase: 'review-analysis',
      currentEpic: scrumMasterExec?.output?.currentEpic,
      currentStory: scrumMasterExec?.output?.currentStory,
      tasks: [...existingTasks, ...additionalTasks],
      taskListMarkdown: this.generateUpdatedTaskListMarkdown(scrumMasterExec?.output?.taskListMarkdown, additionalTasks),
      summary: {
        totalTasks: existingTasks.length + additionalTasks.length,
        completedTasks: scrumMasterExec?.output?.summary?.completedTasks || 0,
        failedTasks: failures.length,
      },
      reviewFailures: failures,
    };

    return output;
  }

  private async analyzeTestFailures(
    epicStoryData: any,
    previousExecutions: any[],
    input: ScrumMasterInput
  ): Promise<ScrumMasterOutput> {
    await this.log('Test 실패 분석 시작');

    // Tester의 실패 원인 분석
    const testerExec = previousExecutions.find(e => e.agentId === 'tester' && e.status === 'FAILED');

    if (!testerExec || !testerExec.output) {
      throw new Error('Tester 실행 결과를 찾을 수 없습니다');
    }

    const testOutput = testerExec.output as any;
    const failures = testOutput.failures || [];

    await this.log('Test 실패 사유', {
      failureCount: failures.length,
    });

    // 실패 원인을 분석하여 추가 Task 생성
    const additionalTasks = await this.generateTasksFromFailures(
      failures,
      epicStoryData,
      input,
      'test'
    );

    await this.log('추가 Task 생성 완료', {
      additionalTaskCount: additionalTasks.length,
    });

    // 이전 task list 로드
    const scrumMasterExec = previousExecutions.find(e => e.agentId === 'scrum-master');
    const existingTasks = scrumMasterExec?.output?.tasks || [];

    const output: ScrumMasterOutput = {
      currentPhase: 'test-analysis',
      currentEpic: scrumMasterExec?.output?.currentEpic,
      currentStory: scrumMasterExec?.output?.currentStory,
      tasks: [...existingTasks, ...additionalTasks],
      taskListMarkdown: this.generateUpdatedTaskListMarkdown(scrumMasterExec?.output?.taskListMarkdown, additionalTasks),
      summary: {
        totalTasks: existingTasks.length + additionalTasks.length,
        completedTasks: scrumMasterExec?.output?.summary?.completedTasks || 0,
        failedTasks: failures.length,
      },
      testFailures: failures,
    };

    return output;
  }

  private async generateTasksFromFailures(
    failures: any[],
    epicStoryData: any,
    input: ScrumMasterInput,
    failureType: 'code-review' | 'test'
  ): Promise<Task[]> {
    const prompt = this.buildFailureAnalysisPrompt(failures, failureType);

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
      const taskList = this.parseTaskListResponse(text);

      // 현재 story 정보 찾기
      const scrumMasterExec = await prisma.agentExecution.findFirst({
        where: {
          projectId: input.projectId,
          agentId: 'scrum-master',
        },
        orderBy: {
          startedAt: 'desc',
        },
      });

      const currentStory = (scrumMasterExec?.output as any)?.currentStory;
      if (!currentStory) {
        throw new Error('현재 Story 정보를 찾을 수 없습니다');
      }

      return taskList.map((taskData: any, index: number) => ({
        id: `task-${currentStory.epicOrder}-${currentStory.storyOrder}-fix-${index + 1}`,
        title: `🔧 ${taskData.title}`,
        description: taskData.description,
        status: 'pending' as const,
        assignedTo: 'developer' as const,
        priority: 'high', // Fix tasks are always high priority
        storyId: `story-${currentStory.epicOrder}-${currentStory.storyOrder}`,
        epicOrder: currentStory.epicOrder,
        storyOrder: currentStory.storyOrder,
        taskOrder: 999 + index, // Add to end
      }));
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`Failure 분석 Task 생성 실패: ${error.message}`);
    }
  }

  private buildFailureAnalysisPrompt(failures: any[], failureType: 'code-review' | 'test'): string {
    const failuresText = JSON.stringify(failures, null, 2);

    return `# 실패 원인 분석 및 추가 Task 생성

당신은 BMad Method를 숙달한 Scrum Master입니다.
${failureType === 'code-review' ? 'Code Reviewer' : 'Tester'}의 실패 결과를 분석하여 이를 해결하기 위한 추가 Task를 생성해주세요.

## 실패 목록

\`\`\`json
${failuresText}
\`\`\`

## Task 생성 원칙

1. **실패 원인 해결**: 각 실패 사유를 명확히 해결할 수 있는 Task
2. **구체적 행동**: 개발자가 바로 구현할 수 있는 수준
3. **높은 우선순위**: 실패 수정은 항상 high priority
4. **검증 가능**: 수정 후 재검증할 수 있는 Task

## 출력 형식

JSON 배열로 출력하세요:

\`\`\`json
[
  {
    "title": "로그인 폼 유효성 검사 로직 수정",
    "description": "apps/web/src/app/login/page.tsx의 handleSubmit 함수에서 이메일 형식 검증 로직을 추가합니다. regex 패턴을 사용하여 이메일 형식을 검증하고, 형식이 올바르지 않을 경우 에러 메시지를 표시합니다.",
    "priority": "high"
  }
]
\`\`\`

중요: 모든 실패 사유를 해결할 수 있는 Task를 생성하세요.
`;
  }

  private generateUpdatedTaskListMarkdown(existingMarkdown: string, additionalTasks: Task[]): string {
    if (!existingMarkdown) {
      existingMarkdown = '# Task List\n\n';
    }

    let markdown = existingMarkdown;

    markdown += `\n\n## 추가 Tasks (실패 수정)\n\n`;

    additionalTasks.forEach((task, index) => {
      markdown += `### ${index + 1}. ${task.title}\n\n`;
      markdown += `- **Task ID**: ${task.id}\n`;
      markdown += `- **Priority**: ${task.priority}\n`;
      markdown += `- **Status**: ${task.status}\n\n`;
      markdown += `**설명**:\n${task.description}\n\n`;
      markdown += `---\n\n`;
    });

    return markdown;
  }

  private async moveToNextStory(
    epicStoryData: any,
    previousExecutions: any[],
    input: ScrumMasterInput
  ): Promise<ScrumMasterOutput> {
    await this.log('다음 Story로 이동');

    // 모든 작업이 완료되었으므로 다음 story의 task list 생성
    return await this.generateTaskList(epicStoryData, await this.getSelectedPRD(input.projectId), input);
  }

  private async saveToDatabase(projectId: string, output: ScrumMasterOutput): Promise<void> {
    try {
      const execution = await prisma.agentExecution.findFirst({
        where: { projectId, agentId: 'scrum-master' },
        orderBy: { startedAt: 'desc' },
      });

      if (!execution) {
        throw new Error('Scrum Master execution not found');
      }

      await prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          output: output as any,
        },
      });
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`DB 저장 실패: ${error.message}`);
    }
  }

  private isRetryable(error: any): boolean {
    return error.message?.includes('timeout') ||
           error.message?.includes('rate limit') ||
           error.code === 'ECONNRESET';
  }
}
