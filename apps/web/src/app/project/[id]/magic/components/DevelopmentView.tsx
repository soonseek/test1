'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pause, Play } from 'lucide-react';

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
  onPauseDevelopment?: () => void;
  onResumeDevelopment?: () => void;
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

interface Story {
  id: string;
  epicId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  storyPoints: number;
  epicOrder: number;
  storyOrder: number;
  tasks: Task[];
}

interface Epic {
  id: string;
  title: string;
  description: string;
  goals: string[];
  order: number;
  stories: Story[];
}

type StoryPhase = 'pending' | 'development' | 'code-review' | 'testing' | 'completed' | 'failed';

export default function DevelopmentView({
  executions,
  onRestart,
  reloadingAgents,
  projectId,
  currentActivity,
  onStartDevelopment,
  onPauseDevelopment,
  onResumeDevelopment,
}: DevelopmentViewProps) {
  const [developmentStarted, setDevelopmentStarted] = useState(false);
  const [selectedEpicIndex, setSelectedEpicIndex] = useState<number | null>(null);
  const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);
  const [showTaskList, setShowTaskList] = useState(false);
  const [showAgentLogs, setShowAgentLogs] = useState(true); // 항상 표시
  const [agentLogs, setAgentLogs] = useState<string[]>([]);
  const [logsLastModified, setLogsLastModified] = useState<number | null>(null);
  const [logLineCount, setLogLineCount] = useState<number>(100); // 기본 100줄
  const [showPollingLogs, setShowPollingLogs] = useState<boolean>(false); // 폴링 로그 숨김 기본

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

  const getStoryPhaseLabel = (phase: StoryPhase): string => {
    const labels = {
      pending: '대기 중',
      development: '개발 중',
      'code-review': '코드 리뷰',
      testing: '테스트',
      completed: '완료',
      failed: '실패',
    };
    return labels[phase];
  };

  const startDevelopment = async () => {
    console.log('[Development] Starting development workflow...');
    setDevelopmentStarted(true);

    if (onStartDevelopment) {
      await onStartDevelopment();
    }
  };

  // 에이전트 로그 폴링
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 로그 필터링: 폴링 로그 제거
  const filterLogs = (logs: string[]): string[] => {
    if (showPollingLogs) return logs; // 폴링 로그 표시 옵션이 켜져있으면 필터링 안 함

    return logs.filter(log => {
      // 필터링할 패턴들
      const ignorePatterns = [
        '[Magic API] Fetching agent executions',
        '[Magic API] Fetching activity log',
        '[Magic API] Found executions',
        '4:', // 시간 스탬프 (예: "4:43:53 PM")
      ];

      // ignorePatterns 중 하나라도 포함되면 제외
      return !ignorePatterns.some(pattern => log.includes(pattern));
    });
  };

  // 로그 스크롤을 하단으로 고정
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current && agentLogs.length > 0) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [agentLogs]);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        // 필터링 후에도 충분한 로그가 남도록 3배 더 가져오기
        const fetchCount = showPollingLogs ? logLineCount : logLineCount * 3;
        const response = await fetch(`http://localhost:4000/api/magic/logs?lines=${fetchCount}`);
        if (response.ok) {
          const data = await response.json();

          // 로그 필터링 적용
          const filteredLogs = filterLogs(data.logs);

          // 필터링 후 지정된 줄수만큼만 자르기 (최신 순)
          const slicedLogs = filteredLogs.slice(-logLineCount);

          // logLineCount가 변경되었거나 새로운 로그인 경우에만 업데이트
          setAgentLogs(slicedLogs);
          setLogsLastModified(data.lastModified);
        }
      } catch (error) {
        console.error('[Development] Failed to fetch logs:', error);
      }
    };

    // 에이전트 로그 보기가 켜져있을 때만 폴링
    if (showAgentLogs) {
      // 초기 로드
      fetchLogs();

      // 2초마다 폴링
      pollIntervalRef.current = setInterval(fetchLogs, 2000);
    }

    // Cleanup
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [showAgentLogs, logLineCount, showPollingLogs]);

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

  // ========== 3열 레이아웃 개발 진행 중 UI (1:1:2 비율) ==========
  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
      {/* ========== 1열: 개발 진행 상황 + Epic/Story ========== */}
      <div className="lg:col-span-1 space-y-5">
        {/* 개발 진행 상황 카드 */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border-2 border-white/20 shadow-card">
          <div className="mb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <span className="text-xl">📊</span>
                개발 진행 상황
              </h2>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <div className="text-4xl font-bold bg-gradient-to-r from-vivid-purple to-amber-500 bg-clip-text text-transparent leading-tight">
                    {overallProgress.toFixed(1)}%
                  </div>
                  <div className="text-white/70 text-sm font-medium mt-1">
                    {completedPoints} / {totalPoints} Points
                  </div>
                </div>
                {/* 일시정지/재개 버튼 - 상호 배타적 표시 */}
                {(() => {
                  const isRunning = latestExecution?.status === 'RUNNING';
                  return isRunning ? (
                    onPauseDevelopment && (
                      <button
                        onClick={onPauseDevelopment}
                        className="p-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-lg transition-all border-2 border-amber-500/30"
                        title="개발 일시정지"
                      >
                        <Pause size={16} />
                      </button>
                    )
                  ) : (
                    onResumeDevelopment && (
                      <button
                        onClick={onResumeDevelopment}
                        className="p-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg transition-all border-2 border-green-500/30"
                        title="개발 재개"
                      >
                        <Play size={16} />
                      </button>
                    )
                  );
                })()}
              </div>
            </div>

            {/* 진행률 바 */}

            {/* Progress Bar */}
            <div className="w-full bg-white/10 rounded-full h-3 mb-4 shadow-inner-glow overflow-hidden">
              <div
                className="bg-gradient-to-r from-purple-600 via-vivid-purple to-amber-500 h-3 rounded-full transition-all duration-700 ease-out shadow-glow relative"
                style={{ width: `${overallProgress}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-shimmer"></div>
              </div>
            </div>

            {scrumMasterData?.currentEpic && scrumMasterData?.currentStory ? (
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <p className="text-white/50 text-xs mb-1 font-medium">🎯 Currently Working On:</p>
                <p className="text-white text-sm font-medium">
                  Epic {scrumMasterData.currentEpic.order} - {scrumMasterData.currentEpic.title}
                </p>
                <p className="text-white/80 text-xs mt-1">
                  {scrumMasterData.currentStory.title}
                </p>
              </div>
            ) : scrumMasterData?.summary?.totalTasks === 0 ? (
              <div className="bg-yellow-500/10 rounded-lg p-3 border border-yellow-500/30">
                <p className="text-yellow-300 text-sm font-medium">⏳ Task List 생성 대기 중...</p>
              </div>
            ) : (
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <p className="text-white/70 text-sm">개발 준비 중</p>
              </div>
            )}
          </div>

          {/* 현재 실행 중인 에이전트 */}
          {latestExecution && latestExecution.status === 'RUNNING' && (
            <div className="flex items-center gap-3 py-3 px-4 bg-yellow-500/10 border-2 border-yellow-500/40 rounded-xl animate-pulse-glow shadow-glow">
              <div className="animate-spin w-5 h-5 border-3 border-yellow-400 border-t-transparent rounded-full"></div>
              <div className="flex-1">
                <p className="text-yellow-300 text-sm font-semibold">
                  ⚡ {latestExecution.agentName}
                </p>
                <p className="text-yellow-200/70 text-xs">Running...</p>
              </div>
            </div>
          )}

          {/* 이어서 계속 진행 버튼 (중단 상태일 때만 표시) */}
          {(() => {
            const hasRunningAgent = latestExecution?.status === 'RUNNING';
            const hasCompletedTasks = scrumMasterData?.tasks?.some((t: Task) => t.status === 'completed');
            const hasPendingTasks = scrumMasterData?.tasks?.some((t: Task) => t.status === 'pending');
            const isPaused = !hasRunningAgent && hasCompletedTasks && hasPendingTasks;

            if (isPaused) {
              return (
                <button
                  onClick={startDevelopment}
                  className="w-full px-5 py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-sm transition-all border-2 border-orange-400/50 font-semibold shadow-glow flex items-center justify-center gap-2 animate-pulse-glow"
                >
                  <span className="text-base">▶️</span>
                  이어서 계속 진행
                </button>
              );
            }
            return null;
          })()}
        </div>

        {/* Epic & Story Branch View */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-5 border-2 border-white/20 shadow-card">
          <h3 className="text-white font-semibold mb-4 text-base flex items-center gap-2">
            <span className="text-lg">📚</span>
            Epics & Stories
          </h3>
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scroll">
            {epicsWithStories.map((epic: any, epicIndex: number) => {
              const totalStories = epic.stories.length;
              const completedStories = epic.stories.filter((s: Story) =>
                s.tasks.length > 0 && s.tasks.every((t: Task) => t.status === 'completed')
              ).length;
              const epicProgress = totalStories > 0 ? (completedStories / totalStories) * 100 : 0;
              const isCurrentEpic = scrumMasterData?.currentEpic?.order === epic.order;

              return (
                <div key={epic.id} className="border-l-4 border-white/20 pl-4">
                  {/* Epic Header */}
                  <div
                    onClick={() => {
                      setSelectedEpicIndex(epicIndex);
                      setSelectedStoryIndex(null);
                    }}
                    className={`p-3 rounded-xl cursor-pointer transition-all border-2 ${
                      selectedEpicIndex === epicIndex
                        ? 'bg-purple-500/30 border-purple-500 shadow-glow'
                        : isCurrentEpic
                        ? 'bg-yellow-500/10 border-yellow-500/30 hover:bg-yellow-500/20 hover:border-yellow-500/50'
                        : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white text-sm font-semibold">{epic.title}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-white/70 font-medium bg-white/10 px-2 py-0.5 rounded">
                          {completedStories}/{totalStories}
                        </span>
                        {epicProgress === 100 && (
                          <span className="text-green-400 text-sm">✓</span>
                        )}
                      </div>
                    </div>
                    {/* Epic Progress Bar */}
                    <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-2 rounded-full transition-all duration-500 ${
                          epicProgress === 100 ? 'bg-gradient-to-r from-green-500 to-green-400 shadow-glow' : 'bg-gradient-to-r from-purple-600 to-purple-400'
                        }`}
                        style={{ width: `${epicProgress}%` }}
                      />
                    </div>
                  </div>

                  {/* Stories under Epic */}
                  <div className="ml-5 mt-2 space-y-2">
                    {epic.stories.map((story: any, storyIndex: number) => {
                      const storyTasks = story.tasks || [];
                      const allTasksCompleted = storyTasks.length > 0 && storyTasks.every((t: Task) => t.status === 'completed');
                      const someTasksCompleted = storyTasks.some((t: Task) => t.status === 'completed');
                      const isCurrentStory = scrumMasterData?.currentStory?.storyOrder === story.storyOrder;

                      return (
                        <div
                          key={story.id}
                          onClick={() => {
                            setSelectedEpicIndex(epicIndex);
                            setSelectedStoryIndex(storyIndex);
                          }}
                          className={`p-3 rounded-lg cursor-pointer transition-all border-2 ${
                            selectedEpicIndex === epicIndex && selectedStoryIndex === storyIndex
                              ? 'bg-purple-500/40 border-purple-500 shadow-glow'
                              : isCurrentStory
                              ? 'bg-yellow-500/20 border-yellow-500/40 animate-pulse-glow'
                              : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/20'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-white/90 text-sm font-medium">{story.title}</span>
                            <div className="flex items-center gap-2">
                              {storyTasks.length > 0 && (
                                <span className="text-xs text-white/60 bg-white/10 px-2 py-0.5 rounded font-medium">
                                  {storyTasks.length}
                                </span>
                              )}
                              {allTasksCompleted && (
                                <span className="text-green-400 text-base animate-scale-in">✓</span>
                              )}
                              {someTasksCompleted && !allTasksCompleted && (
                                <span className="text-yellow-400 text-base animate-pulse">⏳</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ========== 2열: Tasks ========== */}
      <div className="lg:col-span-1 space-y-5">
        {/* Tasks Header */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-5 border-2 border-white/20 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold text-base flex items-center gap-2">
              <span className="text-lg">✅</span>
              Tasks
              {selectedEpicIndex !== null && selectedStoryIndex !== null && (
                <span className="text-sm font-normal text-white/70 bg-white/10 px-2 py-1 rounded-lg">
                  {epicsWithStories[selectedEpicIndex]?.stories[selectedStoryIndex]?.tasks.length || 0}
                </span>
              )}
            </h3>
            {/* Task List 보기 모달 버튼 */}
            {scrumMasterData?.taskListMarkdown && (
              <button
                onClick={() => setShowTaskList(true)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-all border-2 border-white/20 hover:border-vivid-purple/50 font-medium shadow-card flex items-center gap-2"
              >
                <span className="text-base">📋</span>
                전체 Task List
              </button>
            )}
          </div>

          {/* 현재 선택된 Story의 Tasks */}
          {selectedEpicIndex !== null && selectedStoryIndex !== null ? (
            <div className="space-y-3 max-h-[550px] overflow-y-auto pr-2 custom-scroll">
              {epicsWithStories[selectedEpicIndex]?.stories[selectedStoryIndex]?.tasks.map((task: Task) => {
                const isTaskRunning = latestExecution?.agentId === 'developer' && task.status === 'in-progress';

                return (
                  <div
                    key={task.id}
                    className={`p-4 rounded-xl border-2 transition-all shadow-card ${
                      task.status === 'completed'
                        ? 'bg-green-500/10 border-green-500/40 shadow-glow'
                        : task.status === 'failed'
                        ? 'bg-red-500/10 border-red-500/40'
                        : task.status === 'in-progress'
                        ? 'bg-yellow-500/10 border-yellow-500/40 animate-pulse-glow'
                        : 'bg-white/5 border-white/20 hover:bg-white/10 hover:border-white/30'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {task.status === 'completed' && (
                            <span className="text-green-400 text-lg animate-scale-in">✓</span>
                          )}
                          {task.status === 'failed' && (
                            <span className="text-red-400 text-lg">✗</span>
                          )}
                          {task.status === 'in-progress' && (
                            <span className="text-yellow-400 text-lg animate-pulse">⏳</span>
                          )}
                          {task.status === 'pending' && (
                            <span className="text-gray-400 text-lg">○</span>
                          )}
                          <span className="text-white text-base font-semibold truncate flex-1">{task.title}</span>
                          {isTaskRunning && (
                            <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
                          )}
                        </div>
                        <p className="text-white/70 text-sm ml-7 break-words">{task.description}</p>
                      </div>
                      <span className={`text-sm px-3 py-1.5 rounded-lg font-semibold border-2 whitespace-nowrap ml-2 ${
                        task.priority === 'high' ? 'bg-red-500/20 text-red-300 border-red-500/50 shadow-glow' :
                        task.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50' :
                        'bg-blue-500/20 text-blue-300 border-blue-500/50'
                      }`}>
                        {task.priority.toUpperCase()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-white/50 text-sm bg-white/5 rounded-xl border-2 border-dashed border-white/20">
              <div className="text-3xl mb-2">📋</div>
              <p>Epic와 Story를 선택하면</p>
              <p>Tasks가 표시됩니다</p>
            </div>
          )}
        </div>
      </div>

      {/* ========== 3열: 에이전트 실시간 출력 ========== */}
      <div className="lg:col-span-2 space-y-5">
        {/* Current Agent Activity (새로운 카드) */}
        {latestExecution && latestExecution.status === 'RUNNING' && currentActivity?.activity && (
          <div className="bg-gradient-to-br from-yellow-500/10 to-amber-500/10 backdrop-blur-lg rounded-2xl p-5 border-2 border-yellow-500/40 shadow-glow animate-pulse-glow">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-12 h-12 bg-yellow-500/20 rounded-xl flex items-center justify-center border-2 border-yellow-500/40">
                <div className="animate-spin w-6 h-6 border-3 border-yellow-400 border-t-transparent rounded-full"></div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-yellow-300 text-sm font-semibold">⚡ {latestExecution.agentName}</span>
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                </div>
                <p className="text-xs text-yellow-200/70 mb-2 font-medium">Current Task:</p>
                <p className="text-white/90 text-sm font-mono leading-relaxed break-words">
                  {currentActivity.activity}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Agent Logs */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-5 border-2 border-white/20 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-lg">📜</span>
              Agent Output
            </h3>
            <div className="flex items-center gap-2">
              {/* 폴링 로그 토글 */}
              <button
                onClick={() => setShowPollingLogs(!showPollingLogs)}
                className={`px-3 py-1.5 text-xs rounded-lg transition-all border-2 font-medium ${
                  showPollingLogs
                    ? 'bg-orange-500/20 border-orange-500/50 text-orange-300'
                    : 'bg-white/10 border-white/20 text-white/60 hover:text-white hover:border-white/40'
                }`}
                title="폴링 관련 로그 표시/숨기기"
              >
                {showPollingLogs ? '📡' : '🚫'}
              </button>
              {/* 라인 필터 버튼 */}
              <div className="flex items-center gap-1.5">
                {[10, 50, 100, 200].map((count) => (
                  <button
                    key={count}
                    onClick={() => setLogLineCount(count)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-all font-semibold border-2 ${
                      logLineCount === count
                        ? 'bg-vivid-purple/30 border-vivid-purple text-white shadow-glow'
                        : 'bg-white/10 border-white/20 text-white/60 hover:text-white hover:border-white/40'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
              {/* 상태 표시 */}
              <div className={`w-3 h-3 rounded-full border-2 ${agentLogs.length > 0 ? 'bg-green-400 border-green-300 animate-pulse shadow-glow' : 'bg-gray-400 border-gray-300'}`}></div>
            </div>
          </div>

          {/* 로그 출력 (하단 스크롤 고정) */}
          <div
            ref={logContainerRef}
            className="bg-gray-900/90 rounded-xl p-4 overflow-y-auto max-h-[450px] custom-scroll text-sm border-2 border-white/10"
          >
            {agentLogs.length > 0 ? (
              <pre className="text-green-400 font-mono whitespace-pre-wrap leading-relaxed">
                {agentLogs.join('\n')}
              </pre>
            ) : (
              <div className="text-center py-12">
                <div className="text-gray-400 text-3xl mb-2">
                  {showPollingLogs ? '⏳' : '🔇'}
                </div>
                <div className="text-gray-400 text-sm">
                  {showPollingLogs ? '에이전트 로그를 불러오는 중...' : '필터링된 로그가 없습니다.'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ========== Task List 모달 ========== */}
      {showTaskList && scrumMasterData?.taskListMarkdown && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900/95 rounded-2xl p-6 border border-white/20 max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">📋 전체 Task List</h3>
              <button
                onClick={() => setShowTaskList(false)}
                className="text-white/60 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>
            <div className="bg-white/5 rounded-lg p-4 overflow-y-auto flex-1 custom-markdown text-white text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {scrumMasterData.taskListMarkdown}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
