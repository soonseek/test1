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
  status: 'pending' | 'developing' | 'reviewing' | 'testing' | 'completed' | 'failed';
  assignedTo: 'developer' | 'code-reviewer' | 'tester';
  priority: 'high' | 'medium' | 'low';
  storyId: string; // story-1-1
  epicOrder: number;
  storyOrder: number;
  taskOrder: number;
}

interface ScrumMasterOutput {
  currentPhase: 'task-creation' | 'review-analysis' | 'test-analysis' | 'epic-testing' | 'integration-testing' | 'completed';
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
  epicTestResult?: {
    epicOrder: number;
    result: 'pass' | 'fail';
    testDate: string;
  };
  integrationTestResult?: {
    result: 'pass' | 'fail';
    testDate: string;
  };
}

export class ScrumMasterAgent extends Agent {
  private anthropic: Anthropic;
  private currentExecutionId: string | null = null;

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

  /**
   * Orchestrator에서 호출: 현재 실행 ID 설정
   */
  setExecutionId(executionId: string): void {
    this.currentExecutionId = executionId;
  }

  async execute(input: ScrumMasterInput): Promise<AgentExecutionResult> {
    await this.log('Scrum Master 작업 시작', {
      projectId: input.projectId,
    });

    try {
      // 1. PRD 로드
      const selectedPRD = await this.getSelectedPRD(input.projectId);
      if (!selectedPRD) {
        throw new Error('선택된 PRD를 찾을 수 없습니다. 먼저 요구사항 분석을 완료하고 PRD를 선택해주세요.');
      }

      // 2. Epic, Story 로드
      const epicStoryData = await this.getEpicStoryData(input.projectId);
      if (!epicStoryData || epicStoryData.epics.length === 0) {
        throw new Error('Epic & Story 데이터를 찾을 수 없습니다. 먼저 Epic & Story 생성을 완료해주세요.');
      }

      await this.log('Epic & Story 데이터 로드 완료', {
        totalEpics: epicStoryData.epics.length,
        totalStories: epicStoryData.stories.length,
      });

      // 3. 이전 진행 상황 확인
      const previousExecution = await this.getPreviousExecution(input.projectId);
      const currentPhase = this.determinePhase(previousExecution, epicStoryData);

      await this.log('현재 단계 확인', {
        phase: currentPhase,
        previousExecutions: previousExecution?.length || 0,
      });

      let output: ScrumMasterOutput;

      // 4. Phase별 작업 수행
      if (currentPhase === 'task-creation') {
        output = await this.generateTaskList(epicStoryData, selectedPRD, input);
      } else if (currentPhase === 'review-analysis') {
        output = await this.analyzeReviewFailures(epicStoryData, previousExecution, input);
      } else if (currentPhase === 'test-analysis') {
        output = await this.analyzeTestFailures(epicStoryData, previousExecution, input);
      } else if (currentPhase === 'epic-testing') {
        output = await this.handleEpicTesting(epicStoryData, previousExecution, input);
      } else if (currentPhase === 'integration-testing') {
        output = await this.handleIntegrationTesting(epicStoryData, previousExecution, input);
      } else {
        // All completed - move to next story or epic
        output = await this.moveToNextStory(epicStoryData, previousExecution, input);
      }

      // 5. output null 체크
      if (!output) {
        throw new Error('Scrum Master output 생성 실패');
      }

      // 6. DB 저장은 Orchestrator가 담당하므로 생략
      // await this.saveToDatabase(input.projectId, output);

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
    // Epic & Story agent 실행 결과에서 읽기
    const epicStoryExecution = await prisma.agentExecution.findFirst({
      where: {
        projectId,
        agentId: 'epic-story',
        status: 'COMPLETED',
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    if (!epicStoryExecution || !epicStoryExecution.output) {
      throw new Error('Epic & Story 데이터를 찾을 수 없습니다. 먼저 Epic & Story를 완료해주세요.');
    }

    const output = epicStoryExecution.output as any;
    return {
      epics: output.epics || [],
      stories: output.stories || [],
    };
  }

  private async getPreviousExecution(projectId: string) {
    const executions = await prisma.agentExecution.findMany({
      where: {
        projectId,
        agentId: { in: ['scrum-master', 'developer', 'code-reviewer', 'tester'] },
      },
      orderBy: {
        startedAt: 'desc',
      },
      take: 30,
    });

    // 현재 실행 ID를 제외 (자기 자신을 읽지 않기 위해)
    if (this.currentExecutionId) {
      return executions.filter(e => e.id !== this.currentExecutionId);
    }

    return executions;
  }

  private determinePhase(previousExecutions: any[], epicStoryData: any): 'task-creation' | 'review-analysis' | 'test-analysis' | 'epic-testing' | 'integration-testing' | 'completed' {
    if (!previousExecutions || previousExecutions.length === 0) {
      return 'task-creation';
    }

    // 가장 최근 실행 확인
    const latest = previousExecutions[0];

    // latest null 체크
    if (!latest) {
      return 'task-creation';
    }

    // Epic 테스트 실패 처리
    if (latest.agentId === 'tester' && latest.status === 'COMPLETED') {
      const output = latest.output as any;
      if (output && output.testType === 'epic' && output.testResult === 'fail') {
        return 'epic-testing';
      }
    }

    // 통합 테스트 실패 처리
    if (latest.agentId === 'tester' && latest.status === 'COMPLETED') {
      const output = latest.output as any;
      if (output && output.testType === 'integration' && output.testResult === 'fail') {
        return 'integration-testing';
      }
    }

    // Code Reviewer가 실패한 경우
    if (latest.agentId === 'code-reviewer' && latest.status === 'FAILED') {
      return 'review-analysis';
    }

    // Story Tester가 실패한 경우
    if (latest.agentId === 'tester' && latest.status === 'FAILED') {
      const output = latest.output as any;
      if (output && output.testType !== 'epic' && output.testType !== 'integration') {
        return 'test-analysis';
      }
    }

    // Developer가 완료되면 다음 task 생성 필요
    if (latest.agentId === 'developer' && latest.status === 'COMPLETED') {
      // 현재 story의 모든 task가 완료되었는지 확인
      // 이 로직은 generateTaskList에서 처리
      return 'task-creation';
    }

    // Story Tester가 완료되면 Epic 완료 여부 확인
    if (latest.agentId === 'tester' && latest.status === 'COMPLETED') {
      const output = latest.output as any;
      if (output && output.testType === 'story' && output.testResult === 'pass') {
        // Epic 완료 여부 확인
        const currentEpicStatus = this.checkEpicCompletion(previousExecutions, epicStoryData);
        if (currentEpicStatus.isEpicComplete && !currentEpicStatus.allEpicsComplete) {
          return 'epic-testing';
        }
        if (currentEpicStatus.allEpicsComplete) {
          return 'integration-testing';
        }
      }
    }

    // Scrum Master 자신이 이전에 실행된 경우
    if (latest.agentId === 'scrum-master') {
      const output = latest.output as any;
      if (output && output.currentPhase === 'completed') {
        return 'task-creation'; // Move to next story
      }
    }

    return 'task-creation';
  }

  private checkEpicCompletion(previousExecutions: any[], epicStoryData: any): { isEpicComplete: boolean; allEpicsComplete: boolean; completedEpicOrder?: number } {
    // 가장 최근 Scrum Master 실행에서 현재 Epic/Story 정보 확인
    const scrumMasterExec = previousExecutions.find(e => e.agentId === 'scrum-master');
    if (!scrumMasterExec || !scrumMasterExec.output) {
      return { isEpicComplete: false, allEpicsComplete: false };
    }

    const currentEpic = scrumMasterExec.output.currentEpic;
    const currentStory = scrumMasterExec.output.currentStory;
    if (!currentEpic || !currentStory) {
      return { isEpicComplete: false, allEpicsComplete: false };
    }

    // 해당 Epic의 모든 Story가 완료되었는지 확인
    const epicOrder = currentEpic.order;
    const storiesInEpic = epicStoryData.stories.filter((s: any) => {
      const storyEpicOrder = this.getStoryEpicOrder(s, epicStoryData);
      return storyEpicOrder === epicOrder;
    });

    // 해당 Epic의 모든 Story가 테스트 통과했는지 확인
    let completedStoryCount = 0;
    for (const story of storiesInEpic) {
      const storyKey = `${epicOrder}-${this.getStoryOrderInEpic(story, epicStoryData)}`;
      const storyCompleted = this.isStoryCompleted(previousExecutions, storyKey);
      if (storyCompleted) {
        completedStoryCount++;
      }
    }

    const isEpicComplete = completedStoryCount === storiesInEpic.length && storiesInEpic.length > 0;
    const allEpicsComplete = isEpicComplete && epicOrder === epicStoryData.epics.length;

    return {
      isEpicComplete,
      allEpicsComplete,
      completedEpicOrder: epicOrder,
    };
  }

  private getStoryEpicOrder(story: any, epicStoryData: any): number {
    // story.epicId로 epic의 order 찾기
    const epic = epicStoryData.epics.find((e: any) => e.id === story.epicId);
    return epic ? epicStoryData.epics.indexOf(epic) + 1 : 0;
  }

  private getStoryOrderInEpic(story: any, epicStoryData: any): number {
    // Epic 내에서의 Story 순서 찾기
    const epicStories = epicStoryData.stories.filter((s: any) => s.epicId === story.epicId);
    return epicStories.indexOf(story) + 1;
  }

  private isStoryCompleted(previousExecutions: any[], storyKey: string): boolean {
    // 해당 Story의 테스트가 Pass인지 확인
    const testerExecs = previousExecutions.filter(e => e.agentId === 'tester' && e.status === 'COMPLETED');
    for (const exec of testerExecs) {
      const output = exec.output as any;
      if (output && output.testType === 'story' && output.testResult === 'pass') {
        const scrumMasterExec = previousExecutions.find(e =>
          e.agentId === 'scrum-master' &&
          e.startedAt < exec.startedAt
        );
        if (scrumMasterExec && scrumMasterExec.output) {
          const currentStory = scrumMasterExec.output.currentStory;
          if (currentStory) {
            const execStoryKey = `${currentStory.epicOrder}-${currentStory.storyOrder}`;
            if (execStoryKey === storyKey) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  private async generateTaskList(
    epicStoryData: { epics: any[]; stories: any[] },
    prd: any,
    input: ScrumMasterInput
  ): Promise<ScrumMasterOutput> {
    await this.log('Task List 생성 시작');

    // 이전 완료된 story 찾기 (Developer 실행 결과 기반)
    const previousExecution = await this.getPreviousExecution(input.projectId);
    const completedStories = new Set<string>();

    // 각 스토리별 태스크 완료 현황 추적
    const storyTaskCompletion = new Map<string, { totalTasks: number; completedTasks: number; storyKey: string }>();

    // 1. 각 story별로 모든 실행에서 완료된 태스크 누적 계산
    // storyKey -> { totalTasks: number, completedTaskIds: Set<string> }
    const storyTaskTracking = new Map<string, { totalTasks: number; completedTaskIds: Set<string>; storyKey: string }>();

    for (const exec of previousExecution) {
      if (exec.agentId === 'scrum-master' && exec.status === 'COMPLETED') {
        const output = exec.output as any;
        if (output && output.currentStory && output.tasks && output.tasks.length > 0) {
          const storyKey = `${output.currentStory.epicOrder}-${output.currentStory.storyOrder}`;

          // 해당 story의 데이터가 없으면 초기화
          if (!storyTaskTracking.has(storyKey)) {
            storyTaskTracking.set(storyKey, {
              totalTasks: output.tasks.length,
              completedTaskIds: new Set<string>(),
              storyKey,
            });
          }

          // 완료된 태스크 ID 수집
          const tracking = storyTaskTracking.get(storyKey)!;
          output.tasks.forEach((task: any) => {
            if (task.status === 'completed') {
              tracking.completedTaskIds.add(task.id);
            }
          });

          await this.log(`Story 실행 결과 처리: ${storyKey}`, {
            totalTasks: output.tasks.length,
            newCompletedTasks: output.tasks.filter((t: any) => t.status === 'completed').length,
            accumulatedCompleted: tracking.completedTaskIds.size,
            startedAt: exec.startedAt,
          });
        }
      }
    }

    // 2. 각 story별 완료 상태 확인
    for (const [storyKey, tracking] of storyTaskTracking) {
      const completedCount = tracking.completedTaskIds.size;
      const totalCount = tracking.totalTasks;

      storyTaskCompletion.set(storyKey, {
        totalTasks: totalCount,
        completedTasks: completedCount,
        storyKey,
      });

      await this.log(`Story 태스크 완료 현황 최종: ${storyKey}`, {
        totalTasks: totalCount,
        completedTasks: completedCount,
      });

      // 모든 태스크가 완료되었는지 확인
      if (completedCount >= totalCount && totalCount > 0) {
        completedStories.add(storyKey);
        await this.log(`✅ Story 완료 확인: ${storyKey}`, {
          totalTasks: totalCount,
          completedTasks: completedCount,
        });
      }
    }

    // 현재 진행할 story 찾기
    let currentEpic: any = null;
    let currentStory: any = null;
    let epicOrder = 0;
    let storyOrder = 0;

    for (const epic of epicStoryData.epics) {
      epicOrder++;
      storyOrder = 0; // Reset storyOrder BEFORE each Epic iteration
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

    // 현재 story에 대한 task list가 이미 존재하는지 확인
    const currentStoryKey = `${epicOrder}-${storyOrder}`;
    let tasks: Task[] = [];
    let shouldGenerateNewTasks = true;

    // 모든 이전 Scrum Master 실행에서 **모든 Task** 수집 (완료된 Story 포함)
    const allTasksFromPreviousExecutions: Task[] = [];
    for (const exec of previousExecution) {
      if (exec.agentId === 'scrum-master' && exec.status === 'COMPLETED') {
        const output = exec.output as any;
        if (output && output.tasks && output.tasks.length > 0) {
          // 모든 Task를 추가 (중복 제거)
          for (const task of output.tasks) {
            if (!allTasksFromPreviousExecutions.find(t => t.id === task.id)) {
              allTasksFromPreviousExecutions.push(task);
            }
          }
        }
      }
    }

    // 현재 Story에 해당하는 Task만 필터링
    tasks = allTasksFromPreviousExecutions.filter(t => {
      const storyKey = `${t.epicOrder}-${t.storyOrder}`;
      return storyKey === currentStoryKey;
    });

    // 현재 Story에 Task가 없으면 새로 생성
    if (tasks.length === 0) {
      await this.log(`새로운 Task List 생성: ${currentStoryKey}`);
      tasks = await this.generateTasksForStory(prd, currentEpic, currentStory, epicOrder, storyOrder);

      // 새로 생성된 Task를 allTasksFromPreviousExecutions에 추가
      for (const task of tasks) {
        if (!allTasksFromPreviousExecutions.find(t => t.id === task.id)) {
          allTasksFromPreviousExecutions.push(task);
        }
      }

      await this.log(`새로운 Task List 생성 완료: ${currentStoryKey}`, {
        taskCount: tasks.length,
      });
    } else {
      await this.log(`기존 Task List 재사용: ${currentStoryKey}`, {
        taskCount: tasks.length,
        completedTasks: tasks.filter((t: any) => t.status === 'completed').length,
      });
    }

    // 중요: 이전 Story의 completed된 Task들을 포함하여 반환하기 위해
    // 모든 Task를 모아서 반환해야 함 - 이것은 output 저장 시에 적용됨

    // Developer의 이전 실행 결과를 확인하여 Task 상태 업데이트 (현재 Story의 Task만)
    const developerExecutions = previousExecution.filter(e => e.agentId === 'developer');
    if (developerExecutions.length > 0) {
      // Developer가 이미 실행한 태스크들 상태 업데이트
      for (const devExec of developerExecutions) {
        const devOutput = devExec.output as any;
        if (devOutput && devOutput.currentTask) {
          // 모든 Task 집합에서 해당 Task 찾기 (현재 Story의 Task만)
          const taskToUpdate = tasks.find(t => t.id === devOutput.currentTask.id);
          if (taskToUpdate && devExec.status === 'COMPLETED') {
            // Developer가 완료했으면 이미 'reviewing' 상태임 (DeveloperAgent에서 설정)
            // 여기서 상태를 변경하지 않음
            await this.log(`Task 개발 완료 확인: ${taskToUpdate.id} (status: ${taskToUpdate.status})`);
          } else if (taskToUpdate && devExec.status === 'FAILED') {
            taskToUpdate.status = 'failed';
            await this.log(`Task 실패 상태 업데이트: ${taskToUpdate.id}`);
          }
        }
      }

      // 진행 중인 태스크 상태도 확인
      const latestDevExec = developerExecutions[0];

      if (latestDevExec.status === 'RUNNING' || latestDevExec.status === 'COMPLETED') {
        const devOutput = latestDevExec.output as any;
        if (devOutput && devOutput.currentTask) {
          const inProgressTask = tasks.find(t => t.id === devOutput.currentTask.id);
          if (inProgressTask && inProgressTask.status === 'pending') {
            inProgressTask.status = latestDevExec.status === 'COMPLETED' ? 'completed' : 'developing';
          }
        }
      }
    }

    // 모든 태스크가 완료되었는지 확인
    const allTasksCompleted = tasks.every(t => t.status === 'completed');
    if (allTasksCompleted && tasks.length > 0) {
      await this.log(`✅ 모든 Task 완료: ${currentStoryKey}`, {
        totalTasks: tasks.length,
        completedTasks: tasks.filter(t => t.status === 'completed').length,
      });
      // 현재 story를 completedStories에 추가하고 다음 story로 넘어감
      completedStories.add(currentStoryKey);

      // 다음 story 찾기
      let nextEpic: any = null;
      let nextStory: any = null;
      let nextEpicOrder = 0;
      let nextStoryOrder = 0;

      // 현재 story 이후의 story 찾기
      let foundCurrent = false;
      for (const epic of epicStoryData.epics) {
        nextEpicOrder++;
        nextStoryOrder = 0; // Reset storyOrder BEFORE each Epic iteration
        const storiesInEpic = epicStoryData.stories.filter((s: any) => s.epicId === epic.id);

        for (const story of storiesInEpic) {
          nextStoryOrder++;
          const storyKey = `${nextEpicOrder}-${nextStoryOrder}`;

          if (foundCurrent) {
            // 다음 story를 찾음
            nextEpic = epic;
            nextStory = story;
            break;
          }

          if (storyKey === currentStoryKey) {
            foundCurrent = true;
          }
        }

        if (nextStory) break;
      }

      // 다음 story가 있으면 그 story의 task list 생성
      if (nextStory) {
        await this.log('다음 Story로 이동', {
          epic: nextEpic.title,
          story: nextStory.title,
        });

        // 다음 story의 task list 생성
        const nextTasks = await this.generateTasksForStory(prd, nextEpic, nextStory, nextEpicOrder, nextStoryOrder);

        // 중요: 현재 Story(완료된)의 Task와 다음 Story의 Task를 모두 합쳐서 반환
        const allTasks = [...allTasksFromPreviousExecutions, ...nextTasks];

        await this.log(`모든 Task 반환 (완료된 Story + 다음 Story)`, {
          completedStoriesCount: completedStories.size,
          totalTasks: allTasks.length,
          nextStoryTasks: nextTasks.length,
        });

        const nextTaskListMarkdown = this.generateTaskListMarkdown(nextEpic, nextStory, nextTasks);

        return {
          currentPhase: 'task-creation',
          currentEpic: {
            order: nextEpicOrder,
            title: nextEpic.title,
            total: epicStoryData.epics.length,
          },
          currentStory: {
            epicOrder: nextEpicOrder,
            storyOrder: nextStoryOrder,
            title: nextStory.title,
            totalTasks: nextTasks.length,
          },
          tasks: allTasks, // 모든 Task 반환 (완료된 Story 포함)
          taskListMarkdown: nextTaskListMarkdown,
          summary: {
            totalTasks: allTasks.length,
            completedTasks: allTasks.filter(t => t.status === 'completed').length,
            failedTasks: allTasks.filter(t => t.status === 'failed').length,
          },
        };
      } else {
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
    }

    // Task List Markdown 생성
    const taskListMarkdown = this.generateTaskListMarkdown(currentEpic, currentStory, tasks);

    // Summary 계산 (모든 Task 기반)
    const allTasksSummary = {
      totalTasks: allTasksFromPreviousExecutions.length,
      completedTasks: allTasksFromPreviousExecutions.filter(t => t.status === 'completed').length,
      failedTasks: allTasksFromPreviousExecutions.filter(t => t.status === 'failed').length,
    };

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
      tasks: allTasksFromPreviousExecutions, // 모든 Task 반환 (완료된 Story 포함)
      taskListMarkdown,
      summary: allTasksSummary,
    };

    await this.log('Task List 생성 완료', {
      currentStoryTasks: tasks.length,
      allTasks: allTasksFromPreviousExecutions.length,
      ...allTasksSummary,
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
    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.log(`Anthropic API 호출 (시도 ${attempt}/${maxRetries})`, {
          epic: epic.title,
          story: story.title,
        });

        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
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

        await this.log(`Task 생성 성공 (시도 ${attempt}/${maxRetries})`, {
          taskCount: taskList.length,
        });

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
        lastError = error;

        // 재시도 가능한 에러인지 확인 (5xx 에러 또는 네트워크 에러)
        const isRetryable =
          (error.status !== undefined && error.status >= 500) ||
          error.type === 'error' ||
          error.message?.includes('ECONNRESET') ||
          error.message?.includes('ETIMEDOUT') ||
          error.message?.includes('ENOTFOUND');

        await this.logError(error, `시도 ${attempt}/${maxRetries} 실패`);

        // 마지막 시도이거나 재시도 불가능한 에러면 즉시 실패
        if (attempt === maxRetries || !isRetryable) {
          const errorDetails = {
            message: error.message,
            status: error.status,
            type: error.type,
            attempts: attempt,
            isRetryable,
          };
          await this.logError(
            new Error(
              `Task 생성 실패: ${JSON.stringify(errorDetails)}`
            )
          );
          throw new Error(
            `Task 생성 실패 (${attempt}/${maxRetries} 시도): ${error.message} (Status: ${error.status || 'N/A'}, Type: ${error.type || 'unknown'})`
          );
        }

        // Exponential backoff: 1초, 2초, 4초
        const backoffDelay = Math.pow(2, attempt - 1) * 1000;
        await this.log(
          `${backoffDelay / 1000}초 후 재시도... (이유: ${error.message})`
        );
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }

    // 여기까지 오면 모든 재시도가 실패한 것
    throw new Error(
      `Task 생성 실패: ${maxRetries}회 시도 후에도 성공하지 못함. 마지막 에러: ${lastError?.message}`
    );
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
    if (!scrumMasterExec || !scrumMasterExec.output) {
      throw new Error('Scrum Master 실행 결과를 찾을 수 없습니다');
    }

    const existingTasks = scrumMasterExec.output.tasks || [];

    const output: ScrumMasterOutput = {
      currentPhase: 'review-analysis',
      currentEpic: scrumMasterExec.output.currentEpic,
      currentStory: scrumMasterExec.output.currentStory,
      tasks: [...existingTasks, ...additionalTasks],
      taskListMarkdown: this.generateUpdatedTaskListMarkdown(scrumMasterExec.output.taskListMarkdown, additionalTasks),
      summary: {
        totalTasks: existingTasks.length + additionalTasks.length,
        completedTasks: scrumMasterExec.output.summary?.completedTasks || 0,
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
    if (!scrumMasterExec || !scrumMasterExec.output) {
      throw new Error('Scrum Master 실행 결과를 찾을 수 없습니다');
    }

    const existingTasks = scrumMasterExec.output.tasks || [];

    const output: ScrumMasterOutput = {
      currentPhase: 'test-analysis',
      currentEpic: scrumMasterExec.output.currentEpic,
      currentStory: scrumMasterExec.output.currentStory,
      tasks: [...existingTasks, ...additionalTasks],
      taskListMarkdown: this.generateUpdatedTaskListMarkdown(scrumMasterExec.output.taskListMarkdown, additionalTasks),
      summary: {
        totalTasks: existingTasks.length + additionalTasks.length,
        completedTasks: scrumMasterExec.output.summary?.completedTasks || 0,
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
        model: 'claude-sonnet-4-5-20250929',
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

  private async saveToDatabase(executionId: string, output: ScrumMasterOutput): Promise<void> {
    try {
      // Orchestrator가 이미 execution을 업데이트하므로, 여기서는 아무것도 하지 않음
      // 과거: projectId로 execution을 찾아서 업데이트했지만, 이는 다른 실행을 덮어쓰는 문제가 있었음
      await this.log('saveToDatabase: Orchestrator가 업데이트를 담당하므로 건너뜀', { executionId });
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`DB 저장 실패: ${error.message}`);
    }
  }

  private async handleEpicTesting(
    epicStoryData: any,
    previousExecutions: any[],
    input: ScrumMasterInput
  ): Promise<ScrumMasterOutput> {
    await this.log('Epic 테스트 시작');

    // Epic 테스트 결과 확인
    const epicTesterExec = previousExecutions.find(e =>
      e.agentId === 'tester' &&
      e.status === 'COMPLETED' &&
      e.output?.testType === 'epic'
    );

    if (!epicTesterExec || !epicTesterExec.output) {
      // Epic 테스트가 아직 실행되지 않음 - 테스트를 요청하는 상태로 반환
      const scrumMasterExec = previousExecutions.find(e => e.agentId === 'scrum-master');
      const currentEpic = scrumMasterExec?.output?.currentEpic;

      return {
        currentPhase: 'epic-testing',
        currentEpic,
        tasks: [],
        taskListMarkdown: `# Epic 단위 테스트\n\nEpic ${currentEpic?.order}의 모든 Story가 완료되었습니다. Epic 단위 테스트를 진행합니다.`,
        summary: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
        },
      } as ScrumMasterOutput;
    }

    const testResult = epicTesterExec.output;

    // Epic 테스트 pass - 다음 Epic의 첫 Story로 이동
    if (testResult.testResult === 'pass') {
      await this.log('Epic 테스트 Pass - 다음 Epic으로 이동');

      // 현재 Epic의 다음 Epic 찾기
      const scrumMasterExec = previousExecutions.find(e => e.agentId === 'scrum-master');
      const currentEpicOrder = scrumMasterExec?.output?.currentEpic?.order || 0;
      const nextEpicOrder = currentEpicOrder + 1;

      if (nextEpicOrder > epicStoryData.epics.length) {
        // 모든 Epic 완료 - 통합 테스트로
        return {
          currentPhase: 'integration-testing',
          tasks: [],
          taskListMarkdown: '# 통합 테스트\n\n모든 Epic이 완료되었습니다. 통합 테스트를 진행합니다.',
          summary: {
            totalTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
          },
          epicTestResult: {
            epicOrder: currentEpicOrder,
            result: 'pass',
            testDate: new Date().toISOString(),
          },
        } as ScrumMasterOutput;
      }

      // 다음 Epic의 첫 Story task list 생성
      return await this.generateTaskList(epicStoryData, await this.getSelectedPRD(input.projectId), input);
    }

    // Epic 테스트 fail - 대응 task 생성
    await this.log('Epic 테스트 Fail - 대응 Task 생성');

    const additionalTasks = await this.generateEpicFailureTasks(testResult.failures, epicStoryData, previousExecutions, input);

    await this.log('Epic 실패 대응 Task 생성 완료', {
      additionalTaskCount: additionalTasks.length,
    });

    const scrumMasterExec = previousExecutions.find(e => e.agentId === 'scrum-master');
    const currentEpic = scrumMasterExec?.output?.currentEpic;

    return {
      currentPhase: 'epic-testing',
      currentEpic,
      tasks: additionalTasks,
      taskListMarkdown: this.generateEpicFailureTaskListMarkdown(currentEpic, testResult.failures, additionalTasks),
      summary: {
        totalTasks: additionalTasks.length,
        completedTasks: 0,
        failedTasks: testResult.failures?.length || 0,
      },
      epicTestResult: {
        epicOrder: currentEpic?.order || 0,
        result: 'fail',
        testDate: new Date().toISOString(),
      },
      testFailures: testResult.failures,
    } as ScrumMasterOutput;
  }

  private async generateEpicFailureTasks(
    failures: any[],
    epicStoryData: any,
    previousExecutions: any[],
    input: ScrumMasterInput
  ): Promise<Task[]> {
    const prompt = this.buildEpicFailureAnalysisPrompt(failures);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
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

      const scrumMasterExec = previousExecutions.find(e => e.agentId === 'scrum-master');
      const currentEpic = scrumMasterExec?.output?.currentEpic;
      const currentStory = scrumMasterExec?.output?.currentStory;

      return taskList.map((taskData: any, index: number) => ({
        id: `task-epic-${currentEpic?.order}-fix-${index + 1}`,
        title: `🔧 Epic 수정: ${taskData.title}`,
        description: taskData.description,
        status: 'pending' as const,
        assignedTo: 'developer' as const,
        priority: 'high',
        storyId: currentStory?.storyId || `epic-${currentEpic?.order}`,
        epicOrder: currentEpic?.order || 0,
        storyOrder: currentStory?.storyOrder || 0,
        taskOrder: 1000 + index,
      }));
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`Epic 실패 Task 생성 실패: ${error.message}`);
    }
  }

  private buildEpicFailureAnalysisPrompt(failures: any[]): string {
    const failuresText = JSON.stringify(failures, null, 2);

    return `# Epic 테스트 실패 분석 및 대응 Task 생성

당신은 BMad Method를 숙달한 Scrum Master입니다.
Epic 단위 테스트에서 발생한 실패 사유를 분석하여 이를 해결하기 위한 Task를 생성해주세요.

## Epic 테스트 실패 목록

\`\`\`json
${failuresText}
\`\`\`

## Task 생성 원칙

1. **Epic 레벨 문제 해결**: Epic 전체에 영향을 미치는 문제 해결
2. **여러 Story 관련**: 단일 Story가 아니라 Epic 전체 관점에서 접근
3. **구체적 행동**: 개발자가 바로 구현할 수 있는 수준
4. **높은 우선순위**: Epic 실패 수정은 항상 high priority
5. **재검증 가능**: 수정 후 Epic 테스트 재검증 가능

## 출력 형식

JSON 배열로 출력하세요:

\`\`\`json
[
  {
    "title": "Epic 간 데이터 공유 메커니즘 구현",
    "description": "Story 1-1, 1-2, 1-3 간의 데이터 공유를 위해 context API를 구현합니다. apps/web/src/context/EpicContext.tsx를 생성하고, 필요한 상태를 관리합니다.",
    "priority": "high"
  }
]
\`\`\`

중요: 모든 Epic 테스트 실패 사유를 해결할 수 있는 Task를 생성하세요.
`;
  }

  private generateEpicFailureTaskListMarkdown(epic: any, failures: any[], tasks: Task[]): string {
    let markdown = `# Epic 테스트 실패 대응 Task List\n\n`;
    markdown += `**Epic**: ${epic?.title || 'N/A'}\n`;
    markdown += `**실패 사유**: ${failures?.length || 0}개\n`;
    markdown += `**대응 Task**: ${tasks.length}개\n\n`;
    markdown += `---\n\n`;

    markdown += `## 실패 사요\n\n`;
    failures.forEach((failure, index) => {
      markdown += `### ${index + 1}. ${failure.scenario}\n\n`;
      markdown += `- **Severity**: ${failure.severity}\n`;
      markdown += `- **Category**: ${failure.category}\n\n`;
      markdown += `**예상 동작**: ${failure.expectedBehavior}\n\n`;
      markdown += `**실제 동작**: ${failure.actualBehavior}\n\n`;
    });

    markdown += `---\n\n`;
    markdown += `## 대응 Tasks\n\n`;

    tasks.forEach((task, index) => {
      markdown += `### ${index + 1}. ${task.title}\n\n`;
      markdown += `- **Task ID**: ${task.id}\n`;
      markdown += `- **Priority**: ${task.priority}\n`;
      markdown += `- **Status**: ${task.status}\n\n`;
      markdown += `**설명**:\n${task.description}\n\n`;
      markdown += `---\n\n`;
    });

    return markdown;
  }

  private async handleIntegrationTesting(
    epicStoryData: any,
    previousExecutions: any[],
    input: ScrumMasterInput
  ): Promise<ScrumMasterOutput> {
    await this.log('통합 테스트 시작');

    // 통합 테스트 결과 확인
    const integrationTesterExec = previousExecutions.find(e =>
      e.agentId === 'tester' &&
      e.status === 'COMPLETED' &&
      e.output?.testType === 'integration'
    );

    if (!integrationTesterExec || !integrationTesterExec.output) {
      // 통합 테스트가 아직 실행되지 않음
      return {
        currentPhase: 'integration-testing',
        tasks: [],
        taskListMarkdown: '# 통합 테스트\n\n모든 Epic이 완료되었습니다. 통합 테스트를 진행합니다.',
        summary: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
        },
      } as ScrumMasterOutput;
    }

    const testResult = integrationTesterExec.output;

    // 통합 테스트 pass - 프로젝트 완료
    if (testResult.testResult === 'pass') {
      await this.log('통합 테스트 Pass - 프로젝트 완료');

      return {
        currentPhase: 'completed',
        tasks: [],
        taskListMarkdown: '# 프로젝트 완료 ✅\n\n모든 Epic과 통합 테스트가 완료되었습니다.\n\n## 프로젝트 요약\n\n' +
          `- **총 Epic**: ${epicStoryData.epics.length}개\n` +
          `- **총 Story**: ${epicStoryData.stories.length}개\n` +
          `- **테스트 점수**: ${testResult.overallScore}/100\n`,
        summary: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
        },
        integrationTestResult: {
          result: 'pass',
          testDate: new Date().toISOString(),
        },
      } as ScrumMasterOutput;
    }

    // 통합 테스트 fail - 대응 task 생성
    await this.log('통합 테스트 Fail - 대응 Task 생성');

    const additionalTasks = await this.generateIntegrationFailureTasks(testResult.failures, epicStoryData, input);

    await this.log('통합 테스트 실패 대응 Task 생성 완료', {
      additionalTaskCount: additionalTasks.length,
    });

    return {
      currentPhase: 'integration-testing',
      tasks: additionalTasks,
      taskListMarkdown: this.generateIntegrationFailureTaskListMarkdown(testResult.failures, additionalTasks),
      summary: {
        totalTasks: additionalTasks.length,
        completedTasks: 0,
        failedTasks: testResult.failures?.length || 0,
      },
      integrationTestResult: {
        result: 'fail',
        testDate: new Date().toISOString(),
      },
      testFailures: testResult.failures,
    } as ScrumMasterOutput;
  }

  private async generateIntegrationFailureTasks(
    failures: any[],
    epicStoryData: any,
    input: ScrumMasterInput
  ): Promise<Task[]> {
    const prompt = this.buildIntegrationFailureAnalysisPrompt(failures, epicStoryData);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
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

      return taskList.map((taskData: any, index: number) => ({
        id: `task-integration-fix-${index + 1}`,
        title: `🔧 통합 수정: ${taskData.title}`,
        description: taskData.description,
        status: 'pending' as const,
        assignedTo: 'developer' as const,
        priority: 'high',
        storyId: 'integration-fix',
        epicOrder: 0,
        storyOrder: 0,
        taskOrder: 2000 + index,
      }));
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`통합 테스트 실패 Task 생성 실패: ${error.message}`);
    }
  }

  private buildIntegrationFailureAnalysisPrompt(failures: any[], epicStoryData: any): string {
    const failuresText = JSON.stringify(failures, null, 2);
    const epicSummary = epicStoryData.epics.map((e: any, i: number) =>
      `${i + 1}. ${e.title}`
    ).join('\n');

    return `# 통합 테스트 실패 분석 및 대응 Task 생성

당신은 BMad Method를 숙달한 Scrum Master입니다.
프로젝트 전체 통합 테스트에서 발생한 실패 사유를 분석하여 이를 해결하기 위한 Task를 생성해주세요.

## Epic 목록

${epicSummary}

## 통합 테스트 실패 목록

\`\`\`json
${failuresText}
\`\`\`

## Task 생성 원칙

1. **Epic 간 통합 문제 해결**: 여러 Epic에 걸친 문제 해결
2. **시스템 레벨**: 전체 시스템 관점에서 접근
3. **구체적 행동**: 개발자가 바로 구현할 수 있는 수준
4. **높은 우선순위**: 통합 테스트 실패 수정은 항상 high priority
5. **재검증 가능**: 수정 후 통합 테스트 재검증 가능

## 출력 형식

JSON 배열로 출력하세요:

\`\`\`json
[
  {
    "title": "Epic 간 상태 공유 메커니즘 구현",
    "description": "Epic 1(인증)과 Epic 2(대시보드) 간의 사용자 상태 공유를 위해 전역 상태 관리를 구현합니다. apps/web/src/lib/store/userStore.ts를 생성하고 Zustand를 사용하여 상태를 관리합니다.",
    "priority": "high"
  }
]
\`\`\`

중요: 모든 통합 테스트 실패 사유를 해결할 수 있는 Task를 생성하세요.
`;
  }

  private generateIntegrationFailureTaskListMarkdown(failures: any[], tasks: Task[]): string {
    let markdown = `# 통합 테스트 실패 대응 Task List\n\n`;
    markdown += `**실패 사유**: ${failures?.length || 0}개\n`;
    markdown += `**대응 Task**: ${tasks.length}개\n\n`;
    markdown += `---\n\n`;

    markdown += `## 실패 사유\n\n`;
    failures.forEach((failure, index) => {
      markdown += `### ${index + 1}. ${failure.scenario}\n\n`;
      markdown += `- **Severity**: ${failure.severity}\n`;
      markdown += `- **Category**: ${failure.category}\n\n`;
      markdown += `**예상 동작**: ${failure.expectedBehavior}\n\n`;
      markdown += `**실제 동작**: ${failure.actualBehavior}\n\n`;
    });

    markdown += `---\n\n`;
    markdown += `## 대응 Tasks\n\n`;

    tasks.forEach((task, index) => {
      markdown += `### ${index + 1}. ${task.title}\n\n`;
      markdown += `- **Task ID**: ${task.id}\n`;
      markdown += `- **Priority**: ${task.priority}\n`;
      markdown += `- **Status**: ${task.status}\n\n`;
      markdown += `**설명**:\n${task.description}\n\n`;
      markdown += `---\n\n`;
    });

    return markdown;
  }
}
