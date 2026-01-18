'use client';

import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AgentExecution {
  id: string;
  agentId: string;
  agentName: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  error?: any;
  output?: any;
}

interface DevelopmentViewProps {
  executions: AgentExecution[];
  onRestart: (agentId: string) => void;
  reloadingAgents: Set<string>;
  projectId: string;
  currentActivity?: {
    activity: string | null;
    agentName: string | null;
    agentId: string | null;
  };
  onStartDevelopment?: () => void;
}

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  assignedTo: 'developer' | 'code-reviewer' | 'tester';
  priority: 'high' | 'medium' | 'low';
  storyId: string;
  epicOrder: number;
  storyOrder: number;
  taskOrder: number;
}

// Story 개발 단계
type StoryPhase = 'pending' | 'development' | 'code-review' | 'testing' | 'completed' | 'failed';

interface Epic {
  id: string;
  order: number;
  title: string;
  description: string;
  priority: string;
  storyPoints: number;
  stories: Story[];
}

interface Story {
  id: string;
  epicId: string;
  epicOrder: number;
  storyOrder: number;
  title: string;
  description: string;
  storyPoints: number;
  markdown: string;
  tasks: Task[];
}

export default function DevelopmentView({
  executions,
  onRestart,
  reloadingAgents,
  projectId,
  currentActivity,
  onStartDevelopment,
}: DevelopmentViewProps) {
  const [developmentStarted, setDevelopmentStarted] = useState(false);
  const [selectedEpicIndex, setSelectedEpicIndex] = useState<number | null>(null);
  const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);
  const [showTaskList, setShowTaskList] = useState(false);

  // Epic & Story 데이터 로드
  const epicStoryData = useMemo(() => {
    const epicStoryExec = executions.find(e => e.agentId === 'epic-story');
    if (!epicStoryExec || !epicStoryExec.output) {
      return { epics: [], stories: [] };
    }

    return {
      epics: epicStoryExec.output.epics || [],
      stories: epicStoryExec.output.stories || [],
    };
  }, [executions]);

  // Scrum Master 데이터 로드
  const scrumMasterData = useMemo(() => {
    const scrumMasterExec = executions.find(e => e.agentId === 'scrum-master');
    if (!scrumMasterExec || !scrumMasterExec.output) {
      return null;
    }

    return {
      currentEpic: scrumMasterExec.output.currentEpic,
      currentStory: scrumMasterExec.output.currentStory,
      tasks: scrumMasterExec.output.tasks || [],
      summary: scrumMasterExec.output.summary || { totalTasks: 0, completedTasks: 0, failedTasks: 0 },
      taskListMarkdown: scrumMasterExec.output.taskListMarkdown,
    };
  }, [executions]);

  // Epic별 Story 그룹화 + Task 할당
  const epicsWithStories = useMemo(() => {
    return epicStoryData.epics.map((epic: any, epicIndex: number) => {
      const storiesInEpic = epicStoryData.stories.filter((s: any) => s.epicId === epic.id);

      return {
        ...epic,
        order: epicIndex + 1,
        stories: storiesInEpic.map((story: any, storyIndex: number) => {
          // Story에 할당된 Task 찾기
          const tasksForStory = scrumMasterData?.tasks.filter(
            (task: Task) => task.epicOrder === epicIndex + 1 && task.storyOrder === storyIndex + 1
          ) || [];

          return {
            ...story,
            epicOrder: epicIndex + 1,
            storyOrder: storyIndex + 1,
            tasks: tasksForStory,
          };
        }),
      };
    });
  }, [epicStoryData, scrumMasterData]);

  // 전체 진행률 계산 (Story Points 기준)
  const { overallProgress, totalPoints, completedPoints } = useMemo(() => {
    if (epicStoryData.epics.length === 0) {
      return { overallProgress: 0, totalPoints: 0, completedPoints: 0 };
    }

    // 전체 Story Points 계산
    const totalStoryPoints = epicStoryData.stories.reduce((sum: number, story: any) => {
      return sum + (story.storyPoints || 0);
    }, 0);

    if (totalStoryPoints === 0) {
      return { overallProgress: 0, totalPoints: 0, completedPoints: 0 };
    }

    // 완료된 Story Points 계산 (Task가 모두 완료된 Story)
    const completedStoryPoints = epicStoryData.stories.reduce((sum: number, story: any) => {
      // Story에 할당된 Task가 있고 모두 completed 상태인 경우
      const storyTasks = scrumMasterData?.tasks.filter(
        (t: Task) => t.epicOrder === story.epicOrder && t.storyOrder === story.storyOrder
      ) || [];

      if (storyTasks.length > 0 && storyTasks.every((t: Task) => t.status === 'completed')) {
        return sum + (story.storyPoints || 0);
      }
      return sum;
    }, 0);

    return {
      overallProgress: (completedStoryPoints / totalStoryPoints) * 100,
      totalPoints: totalStoryPoints,
      completedPoints: completedStoryPoints,
    };
  }, [epicStoryData, scrumMasterData]);

  // 현재 실행 중인 에이전트 확인
  const latestExecution = useMemo(() => {
    const developmentAgents = ['scrum-master', 'developer', 'code-reviewer', 'tester'];
    const developmentExecutions = executions.filter(e => developmentAgents.includes(e.agentId));

    return developmentExecutions.length > 0
      ? developmentExecutions.reduce((latest, current) =>
          new Date(current.startedAt) > new Date(latest.startedAt) ? current : latest
        )
      : null;
  }, [executions]);

  // Story의 현재 단계 판단
  const getStoryPhase = (story: Story): StoryPhase => {
    const storyTasks = story.tasks || [];
    if (storyTasks.length === 0) return 'pending';

    // 모든 Task가 completed인지 확인
    const allTasksCompleted = storyTasks.every(t => t.status === 'completed');
    if (allTasksCompleted) {
      // Tester가 실행되었는지 확인
      const testerExec = executions.find(e => e.agentId === 'tester' && e.status === 'COMPLETED');
      if (testerExec) {
        return 'completed';
      }
      // Code Reviewer가 pass 했는지 확인
      const reviewerExec = executions.find(e => e.agentId === 'code-reviewer' && e.status === 'COMPLETED');
      if (reviewerExec) {
        return 'testing';
      }
      return 'code-review';
    }

    // Task가 진행 중이거나 failed
    const hasInProgressTask = storyTasks.some(t => t.status === 'in-progress');
    if (hasInProgressTask) return 'development';

    // Code Reviewer가 실행 중인지 확인
    const reviewerRunning = executions.find(e => e.agentId === 'code-reviewer' && e.status === 'RUNNING');
    if (reviewerRunning) return 'code-review';

    // Tester가 실행 중인지 확인
    const testerRunning = executions.find(e => e.agentId === 'tester' && e.status === 'RUNNING');
    if (testerRunning) return 'testing';

    // Code Reviewer가 실패했는지 확인
    const reviewerFailed = executions.find(e => e.agentId === 'code-reviewer' && e.status === 'FAILED');
    if (reviewerFailed) return 'failed';

    // Tester가 실패했는지 확인
    const testerFailed = executions.find(e => e.agentId === 'tester' && e.status === 'FAILED');
    if (testerFailed) return 'failed';

    return 'development';
  };

  const startDevelopment = async () => {
    console.log('[Development] Starting development workflow...');
    setDevelopmentStarted(true);

    if (onStartDevelopment) {
      await onStartDevelopment();
    }
  };

  if (!developmentStarted && !latestExecution && !scrumMasterData) {
    return (
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">💻</div>
          <h2 className="text-2xl font-bold text-white mb-4">BMad Method 기반 개발</h2>
          <p className="text-white/70 mb-8 max-w-2xl mx-auto">
            Scrum Master가 Epic & Story를 분석하여 Task List를 생성하고,<br />
            Developer가 개발을 수행하며 Code Reviewer와 Tester가 품질을 검증합니다.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8 max-w-4xl mx-auto">
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="text-3xl mb-2">🎯</div>
              <h3 className="text-white font-semibold mb-1">Scrum Master</h3>
              <p className="text-white/60 text-sm">Task List 생성/관리</p>
            </div>
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="text-3xl mb-2">👨‍💻</div>
              <h3 className="text-white font-semibold mb-1">Developer</h3>
              <p className="text-white/60 text-sm">개발 수행</p>
            </div>
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="text-3xl mb-2">🔍</div>
              <h3 className="text-white font-semibold mb-1">Code Reviewer</h3>
              <p className="text-white/60 text-sm">코드 리뷰</p>
            </div>
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="text-3xl mb-2">🧪</div>
              <h3 className="text-white font-semibold mb-1">Tester</h3>
              <p className="text-white/60 text-sm">UI/API/DB 테스트</p>
            </div>
          </div>

          <button
            onClick={startDevelopment}
            className="px-8 py-3 bg-gradient-to-r from-purple-600 to-amber-500 hover:from-purple-700 hover:to-amber-600 text-white font-semibold rounded-lg text-lg transition-all"
          >
            🚀 개발 시작하기
          </button>
        </div>
      </div>
    );
  }

  // 개발 진행 중 UI
  return (
    <div className="space-y-4">
      {/* 전체 진행률 및 현재 상태 */}
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-white mb-1">개발 진행 상황</h2>
            {scrumMasterData?.currentEpic && scrumMasterData?.currentStory ? (
              <p className="text-white/70 text-sm">
                Epic {scrumMasterData.currentEpic.order} - {scrumMasterData.currentEpic.title} /{' '}
                {scrumMasterData.currentStory.title}
              </p>
            ) : scrumMasterData?.summary?.totalTasks === 0 ? (
              <p className="text-yellow-300 text-sm">⏳ Task List 생성 대기 중...</p>
            ) : (
              <p className="text-white/70 text-sm">개발 준비 중</p>
            )}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-white">
              {overallProgress.toFixed(1)}%
            </div>
            <div className="text-white/60 text-sm">
              {completedPoints} / {totalPoints} Points
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-white/10 rounded-full h-3 mb-4">
          <div
            className="bg-gradient-to-r from-purple-600 to-amber-500 h-3 rounded-full transition-all duration-500"
            style={{ width: `${overallProgress}%` }}
          />
        </div>

        {/* 현재 실행 중인 에이전트 */}
        {latestExecution && latestExecution.status === 'RUNNING' && (
          <div className="flex items-center justify-center gap-3 py-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <div className="animate-spin w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full"></div>
            <span className="text-yellow-300 font-medium">
              {latestExecution.agentName} 실행 중...
            </span>
            {currentActivity?.activity && (
              <span className="text-yellow-200/70 text-sm ml-4 truncate max-w-md">
                {currentActivity.activity.length > 60
                  ? currentActivity.activity.substring(0, 60) + '...'
                  : currentActivity.activity}
              </span>
            )}
          </div>
        )}

        {/* 빠른 액션 버튼 */}
        <div className="flex gap-3 mt-4">
          {scrumMasterData?.taskListMarkdown && (
            <button
              onClick={() => setShowTaskList(!showTaskList)}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-colors border border-white/20"
            >
              {showTaskList ? '📋 Task List 닫기' : '📋 Task List 보기'}
            </button>
          )}
          {latestExecution?.status === 'FAILED' && (
            <button
              onClick={() => onRestart(latestExecution.agentId)}
              disabled={reloadingAgents.has(latestExecution.agentId)}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {reloadingAgents.has(latestExecution.agentId) ? '재시작 중...' : '🔄 실패한 에이전트 재시작'}
            </button>
          )}
        </div>
      </div>

      {/* Task List Markdown */}
      {showTaskList && scrumMasterData?.taskListMarkdown && (
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
          <h3 className="text-lg font-semibold text-white mb-4">📋 Task List</h3>
          <div className="bg-white/5 rounded-lg p-4 overflow-x-auto max-h-96 custom-markdown text-white text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {scrumMasterData.taskListMarkdown}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Epic-Story-Task 계층 구조 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Epic 목록 */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 border border-white/20">
          <h3 className="text-white font-semibold mb-3">📚 Epics ({epicsWithStories.length})</h3>
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
            {epicsWithStories.map((epic: Epic, epicIndex: number) => {
              const totalStories = epic.stories.length;
              // Story에 tasks가 없으면 완료된 것으로 계산하지 않음
              const completedStories = epic.stories.filter((s: Story) =>
                s.tasks.length > 0 && s.tasks.every((t: Task) => t.status === 'completed')
              ).length;
              const epicProgress = totalStories > 0 ? (completedStories / totalStories) * 100 : 0;
              const isCurrentEpic = scrumMasterData?.currentEpic?.order === epic.order;

              return (
                <div
                  key={epic.id}
                  onClick={() => {
                    setSelectedEpicIndex(epicIndex);
                    setSelectedStoryIndex(null);
                  }}
                  className={`p-3 rounded-lg cursor-pointer transition-all border ${
                    selectedEpicIndex === epicIndex
                      ? 'bg-purple-500/30 border-purple-500'
                      : isCurrentEpic
                      ? 'bg-yellow-500/10 border-yellow-500/30'
                      : 'bg-white/5 border-white/20 hover:border-purple-400'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="text-white font-medium text-sm mb-1">{epic.title}</div>
                      <div className="text-white/60 text-xs">
                        {completedStories} / {totalStories} Stories
                      </div>
                    </div>
                    {isCurrentEpic && (
                      <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse ml-2"></div>
                    )}
                  </div>

                  {/* Epic 진행률 바 */}
                  <div className="w-full bg-white/10 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${
                        epicProgress === 100 ? 'bg-green-500' : 'bg-purple-500'
                      }`}
                      style={{ width: `${epicProgress}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Story 목록 */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 border border-white/20">
          <h3 className="text-white font-semibold mb-3">
            📖 Stories
            {selectedEpicIndex !== null ? ` (${epicsWithStories[selectedEpicIndex]?.stories.length || 0})` : ''}
          </h3>
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
            {selectedEpicIndex === null ? (
              <div className="text-white/50 text-sm text-center py-8">Epic을 선택하세요</div>
            ) : (
              epicsWithStories[selectedEpicIndex]?.stories.map((story: Story, storyIndex: number) => {
                const totalTasks = story.tasks.length;
                const completedTasks = story.tasks.filter((t: Task) => t.status === 'completed').length;
                // Tasks가 없는 Story는 진행률 0%로 표시
                const storyProgress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
                const isCurrentStory =
                  scrumMasterData?.currentStory?.epicOrder === story.epicOrder &&
                  scrumMasterData?.currentStory?.storyOrder === story.storyOrder;

                // Story 현재 단계 판단
                const storyPhase = getStoryPhase(story);

                // 단계별 색상 및 라벨
                const getPhaseInfo = (phase: StoryPhase) => {
                  switch (phase) {
                    case 'pending':
                      return { label: '대기 중', color: 'bg-gray-500/30 text-gray-300', icon: '⏳' };
                    case 'development':
                      return { label: '개발 중', color: 'bg-blue-500/30 text-blue-300', icon: '👨‍💻' };
                    case 'code-review':
                      return { label: '코드 리뷰', color: 'bg-yellow-500/30 text-yellow-300', icon: '🔍' };
                    case 'testing':
                      return { label: '테스트 중', color: 'bg-purple-500/30 text-purple-300', icon: '🧪' };
                    case 'completed':
                      return { label: '완료 ✅', color: 'bg-green-500/30 text-green-300', icon: '✅' };
                    case 'failed':
                      return { label: '실패 ❌', color: 'bg-red-500/30 text-red-300', icon: '❌' };
                  }
                };

                const phaseInfo = getPhaseInfo(storyPhase);

                return (
                  <div
                    key={story.id}
                    onClick={() => setSelectedStoryIndex(storyIndex)}
                    className={`p-3 rounded-lg cursor-pointer transition-all border ${
                      selectedStoryIndex === storyIndex
                        ? 'bg-purple-500/30 border-purple-500'
                        : isCurrentStory
                        ? 'bg-yellow-500/10 border-yellow-500/30'
                        : 'bg-white/5 border-white/20 hover:border-purple-400'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="text-white font-medium text-sm">{story.title}</div>
                          {/* 현재 단계 배지 */}
                          <span className={`text-xs px-2 py-0.5 rounded ${phaseInfo.color}`}>
                            {phaseInfo.icon} {phaseInfo.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          {totalTasks === 0 ? (
                            <span className="text-yellow-300">⏳ Task 대기 중</span>
                          ) : (
                            <span className="text-white/60">{completedTasks} / {totalTasks} Tasks</span>
                          )}
                          <span className="bg-white/10 px-2 py-0.5 rounded text-white/70">
                            {story.storyPoints}pt
                          </span>
                        </div>
                      </div>
                      {isCurrentStory && (
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse ml-2"></div>
                      )}
                    </div>

                    {/* Story 진행률 바 */}
                    {totalTasks > 0 && (
                      <div className="w-full bg-white/10 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all ${
                            storyProgress === 100 ? 'bg-green-500' : 'bg-purple-500'
                          }`}
                          style={{ width: `${storyProgress}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              }) || []
            )}
          </div>
        </div>

        {/* Task 목록 */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 border border-white/20">
          <h3 className="text-white font-semibold mb-3">
            ✅ Tasks
            {selectedEpicIndex !== null && selectedStoryIndex !== null
              ? ` (${epicsWithStories[selectedEpicIndex]?.stories[selectedStoryIndex]?.tasks.length || 0})`
              : ''}
          </h3>
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
            {selectedEpicIndex === null || selectedStoryIndex === null ? (
              <div className="text-white/50 text-sm text-center py-8">Story를 선택하세요</div>
            ) : epicsWithStories[selectedEpicIndex]?.stories[selectedStoryIndex]?.tasks.length === 0 ? (
              <div className="text-white/50 text-sm text-center py-8">
                ⏳ 아직 Task가 생성되지 않았습니다.<br />
                <span className="text-xs">Scrum Master가 Task List를 생성 중입니다...</span>
              </div>
            ) : (
              epicsWithStories[selectedEpicIndex]?.stories[selectedStoryIndex]?.tasks.map((task: Task) => {
                const statusColors = {
                  pending: 'bg-gray-500/20 border-gray-500/30 text-gray-300',
                  'in-progress': 'bg-blue-500/20 border-blue-500/30 text-blue-300',
                  completed: 'bg-green-500/20 border-green-500/30 text-green-300',
                  failed: 'bg-red-500/20 border-red-500/30 text-red-300',
                };

                const priorityColors = {
                  high: 'bg-red-500/30 text-red-200',
                  medium: 'bg-yellow-500/30 text-yellow-200',
                  low: 'bg-blue-500/30 text-blue-200',
                };

                return (
                  <div
                    key={task.id}
                    className={`p-3 rounded-lg border transition-all ${statusColors[task.status]}`}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex-1">
                        <div className="font-medium text-sm mb-1">{task.title}</div>
                        <div className="text-xs opacity-70 line-clamp-2">{task.description}</div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${priorityColors[task.priority]} ml-2`}>
                        {task.priority}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs">
                      <span className="opacity-70">
                        {task.assignedTo === 'developer' && '👨‍💻 Developer'}
                        {task.assignedTo === 'code-reviewer' && '🔍 Reviewer'}
                        {task.assignedTo === 'tester' && '🧪 Tester'}
                      </span>
                      <span className="opacity-70">
                        {task.status === 'pending' && '⏳ 대기 중'}
                        {task.status === 'in-progress' && '🔄 진행 중'}
                        {task.status === 'completed' && '✅ 완료'}
                        {task.status === 'failed' && '❌ 실패'}
                      </span>
                    </div>
                  </div>
                );
              }) || []
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
