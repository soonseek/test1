'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pause, Play } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

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
  onStoryFailure?: (failedTasks: any[]) => void;
  onClearFailure?: () => void;
  onResetDevelopment?: () => void;
  isDevelopmentPaused?: boolean;
}

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'developing' | 'reviewing' | 'testing' | 'completed' | 'failed';
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
  onStoryFailure,
  onClearFailure,
  onResetDevelopment,
  isDevelopmentPaused = false,
}: DevelopmentViewProps) {
  const toast = useToast();
  const [developmentStarted, setDevelopmentStarted] = useState(false);
  const [maxRetries, setMaxRetries] = useState(1); // 기본 1회, 최대 5회
  const [isRetrying, setIsRetrying] = useState(false); // 재시도 중임을 표시하는 플래그
  const [selectedEpicIndex, setSelectedEpicIndex] = useState<number | null>(null);
  const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);
  const [showTaskList, setShowTaskList] = useState(false);
  const [showAgentLogs, setShowAgentLogs] = useState(true); // 항상 표시
  const [agentLogs, setAgentLogs] = useState<string[]>([]);
  const [logsLastModified, setLogsLastModified] = useState<number | null>(null);
  const [logLineCount, setLogLineCount] = useState<number>(100); // 기본 100줄
  const [showPollingLogs, setShowPollingLogs] = useState<boolean>(false); // 폴링 로그 숨김 기본
  const [autoScrollPaused, setAutoScrollPaused] = useState<boolean>(false); // 로그 자동 스크롤 일시정지

  // Epic & Story 컨테이너 ref (자동 스크롤용)
  const epicStoryContainerRef = useRef<HTMLDivElement>(null);

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
    // 가장 최신 Scrum Master 실행 찾기
    const scrumMasterExecs = executions.filter(e => e.agentId === 'scrum-master');
    if (scrumMasterExecs.length === 0) {
      return null;
    }

    const latestExec = scrumMasterExecs[scrumMasterExecs.length - 1];

    // 모든 Scrum Master 실행에서 태스크 수집 (이전 Story 태스크 유지)
    const allTasks = scrumMasterExecs.flatMap(exec =>
      (exec.output?.tasks || [])
    );

    // 태스크 ID 중복 제거 (같은 태스크가 여러 실행에 있을 수 있음)
    const uniqueTasks = Array.from(
      new Map(allTasks.map((task: Task) => [task.id, task])).values()
    );

    return {
      currentEpic: latestExec.output?.currentEpic,
      currentStory: latestExec.output?.currentStory,
      tasks: uniqueTasks,
      summary: latestExec.output?.summary || { totalTasks: 0, completedTasks: 0, failedTasks: 0 },
      taskListMarkdown: latestExec.output?.taskListMarkdown,
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

      if (storyTasks.length > 0 && storyTasks.every((t: Task) => getTaskProgressStatus(t).phase === 'completed')) {
        return sum + (story.storyPoints || 0);
      }
      return sum;
    }, 0);

    return {
      overallProgress: (completedStoryPoints / totalStoryPoints) * 100,
      totalPoints: totalStoryPoints,
      completedPoints: completedStoryPoints,
    };
  }, [epicStoryData, scrumMasterData, executions]);

  // 현재 실행 중인 개발 에이전트 확인 (Epic & Story 제외)
  const latestExecution = useMemo(() => {
    const developmentAgents = ['scrum-master', 'developer', 'code-reviewer', 'tester'];
    const developmentExecutions = executions.filter(e => developmentAgents.includes(e.agentId));

    // 실행 중인 에이전트 우선, 없으면 최근 완료된 에이전트
    const runningExec = developmentExecutions.find(e => e.status === 'RUNNING');
    if (runningExec) return runningExec;

    return developmentExecutions.length > 0
      ? developmentExecutions.reduce((latest, current) =>
          new Date(current.startedAt) > new Date(latest.startedAt) ? current : latest
        )
      : null;
  }, [executions]);

  // Epic & Story가 실행 중인지 확인
  const isEpicStoryRunning = useMemo(() => {
    const epicStoryExec = executions.find(e => e.agentId === 'epic-story');
    return epicStoryExec?.status === 'RUNNING';
  }, [executions]);

  // 스토리 실패 상태 감지
  const storyFailure = useMemo(() => {
    // Scrum Master 데이터 확인
    const scrumMasterExec = executions.find(e => e.agentId === 'scrum-master');
    if (!scrumMasterExec || !scrumMasterExec.output) return null;

    const scrumMasterOutput = scrumMasterExec.output;
    const tasks = scrumMasterOutput.tasks || [];

    // 실패한 태스크가 있는지 확인
    const failedTasks = tasks.filter((t: Task) => t.status === 'failed');
    if (failedTasks.length === 0) return null;

    // 진행 중인 에이전트가 있는지 확인
    const hasRunningAgent = executions.some(e =>
      ['developer', 'code-reviewer', 'tester'].includes(e.agentId) && e.status === 'RUNNING'
    );

    // 진행 중인 에이전트가 없고 실패한 태스크가 있으면 실패 상태
    if (!hasRunningAgent && failedTasks.length > 0) {
      // 실패한 태스크별 상세 에러 정보 수집
      const tasksWithErrors = failedTasks.map((task: Task) => {
        // 해당 태스크를 처리한 에이전트의 실행 기록 찾기
        // developer, code-reviewer, tester 순으로 확인
        const agentErrors = [];

        for (const agentId of ['developer', 'code-reviewer', 'tester']) {
          const agentExec = executions.find(e =>
            e.agentId === agentId &&
            e.status === 'COMPLETED' &&
            e.output?.error?.taskId === task.id
          );

          if (agentExec?.error) {
            agentErrors.push({
              agentId,
              agentName: agentExec.agentName,
              error: agentExec.error,
            });
          }

          // output 내부의 error도 확인
          if (agentExec?.output?.error) {
            const outputError = agentExec.output.error;
            if (outputError.taskId === task.id && outputError.message) {
              agentErrors.push({
                agentId,
                agentName: agentExec.agentName,
                error: outputError,
              });
            }
          }
        }

        return {
          ...task,
          errors: agentErrors,
        };
      });

      return {
        failedTasks: tasksWithErrors,
        totalTasks: tasks.length,
        failedCount: failedTasks.length,
      };
    }

    return null;
  }, [executions]);

  // 실패 상태 감지 시 부모 컴포넌트에 알림
  useEffect(() => {
    // 재시도 중이면 실패 알림을 하지 않음 (중복 토스트 방지)
    if (storyFailure && onStoryFailure && !isRetrying) {
      onStoryFailure(storyFailure.failedTasks);
    }
  }, [storyFailure, onStoryFailure, isRetrying]);

  // 자동으로 다음 스토리로 포커스
  useEffect(() => {
    // 현재 선택된 스토리의 모든 태스크가 완료되었는지 확인
    if (selectedEpicIndex === null || selectedStoryIndex === null) return;

    const currentStory = epicsWithStories[selectedEpicIndex]?.stories[selectedStoryIndex];
    if (!currentStory || !currentStory.tasks) return;

    const allTasksCompleted = currentStory.tasks.every((t: Task) =>
      getTaskProgressStatus(t).phase === 'completed'
    );

    // 모든 태스크가 완료되면 다음 스토리로 자동 이동
    if (allTasksCompleted && currentStory.tasks.length > 0) {
      const currentEpic = epicsWithStories[selectedEpicIndex];
      if (!currentEpic) return;

      // 현재 Epic에서 다음 Story 찾기
      const nextStoryIndex = selectedStoryIndex + 1;
      if (nextStoryIndex < currentEpic.stories.length) {
        // 같은 Epic의 다음 Story
        setSelectedStoryIndex(nextStoryIndex);
      } else {
        // 다음 Epic의 첫 번째 Story
        const nextEpicIndex = selectedEpicIndex + 1;
        if (nextEpicIndex < epicsWithStories.length) {
          setSelectedEpicIndex(nextEpicIndex);
          setSelectedStoryIndex(0);
        }
      }
    }
  }, [scrumMasterData?.tasks, epicsWithStories, selectedEpicIndex, selectedStoryIndex]);

  // 현재 진행 중인 스토리로 자동 스크롤
  useEffect(() => {
    if (selectedEpicIndex === null || selectedStoryIndex === null) return;
    if (!epicStoryContainerRef.current) return;

    // 현재 스토리 요소 찾기 (data-current-story 속성으로 식별)
    const container = epicStoryContainerRef.current;
    const currentStoryElement = container.querySelector(`[data-story-index="${selectedStoryIndex}"][data-epic-index="${selectedEpicIndex}"]`);

    if (currentStoryElement) {
      currentStoryElement.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedEpicIndex, selectedStoryIndex, scrumMasterData?.currentStory]);

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
    const hasInProgressTask = storyTasks.some(t => t.status === 'developing');
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

  // Task의 실제 진행 상태 판단
  const getTaskProgressStatus = (task: Task): {
    phase: 'pending' | 'development' | 'review' | 'testing' | 'completed' | 'failed';
    label: string;
    icon: string;
    borderColor: string;
    bgColor: string;
  } => {
    // Task 상태에 따라 직접 반환
    switch (task.status) {
      case 'failed':
        return {
          phase: 'failed',
          label: '실패',
          icon: '❌',
          borderColor: 'border-red-500/40',
          bgColor: 'bg-red-500/10',
        };
      case 'developing':
        return {
          phase: 'development',
          label: '개발 중',
          icon: '🔨',
          borderColor: 'border-yellow-500/40',
          bgColor: 'bg-yellow-500/10',
        };
      case 'reviewing':
        return {
          phase: 'review',
          label: '리뷰 중',
          icon: '🔍',
          borderColor: 'border-blue-500/40',
          bgColor: 'bg-blue-500/10',
        };
      case 'testing':
        return {
          phase: 'testing',
          label: '테스트 중',
          icon: '🧪',
          borderColor: 'border-purple-500/40',
          bgColor: 'bg-purple-500/10',
        };
      case 'completed':
        return {
          phase: 'completed',
          label: '완료',
          icon: '✅',
          borderColor: 'border-green-500/40',
          bgColor: 'bg-green-500/10',
        };
      case 'pending':
      default:
        return {
          phase: 'pending',
          label: '대기 중',
          icon: '⭕',
          borderColor: 'border-white/20',
          bgColor: 'bg-white/5',
        };
    }
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

  // 로그 스크롤을 하단으로 고정 (일시정지 중일 때 제외)
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current && agentLogs.length > 0 && !autoScrollPaused) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [agentLogs, autoScrollPaused]);

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

  // Epic & Story 생성 중이거나, 개발이 시작되지 않았고 실행 중인 에이전트가 없을 때 초기 화면 표시
  if (isEpicStoryRunning || (!developmentStarted && !latestExecution && !scrumMasterData)) {
    return (
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-3 border border-white/20">
        <div className="text-center py-8">
          <div className="text-5xl mb-3">💻</div>
          <h2 className="text-xl font-bold text-white mb-3">BMad Method 기반 개발</h2>
          <p className="text-white/70 mb-4 max-w-2xl mx-auto text-sm">
            Scrum Master가 Epic & Story를 분석하여 Task List를 생성하고,<br />
            Developer가 개발을 수행하며 Code Reviewer와 Tester가 품질을 검증합니다.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 mb-4 max-w-4xl mx-auto">
            <div className="bg-white/5 rounded-lg p-2 border border-white/10">
              <div className="text-2xl mb-1">🎯</div>
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

          {/* 재시도 횟수 설정 */}
          <div className="mb-6 flex items-center justify-center gap-4">
            <span className="text-white/80 text-sm font-medium">최대 재시도 횟수:</span>
            <div className="flex items-center gap-2 bg-white/10 rounded-lg px-4 py-2 border border-white/20">
              <button
                onClick={() => setMaxRetries(Math.max(1, maxRetries - 1))}
                disabled={maxRetries <= 1}
                className="w-7 h-7 flex items-center justify-center bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10 text-white text-sm rounded transition-all font-bold"
              >
                -
              </button>
              <span className="text-white text-lg font-semibold w-8 text-center">{maxRetries}</span>
              <button
                onClick={() => setMaxRetries(Math.min(5, maxRetries + 1))}
                disabled={maxRetries >= 5}
                className="w-7 h-7 flex items-center justify-center bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10 text-white text-sm rounded transition-all font-bold"
              >
                +
              </button>
            </div>
            <span className="text-white/50 text-xs">(최대 5회)</span>
          </div>

          {/* 개발 시작 / 처음부터 다시 개발 버튼 */}
          {scrumMasterData && scrumMasterData.tasks && scrumMasterData.tasks.length > 0 ? (
            <div className="flex gap-4">
              <button
                onClick={startDevelopment}
                className="px-8 py-3 bg-gradient-to-r from-purple-600 to-amber-500 hover:from-purple-700 hover:to-amber-600 text-white font-semibold rounded-lg text-lg transition-all"
              >
                ▶️ 이어서 개발하기
              </button>
              {onResetDevelopment && (
                <button
                  onClick={async () => {
                    if (confirm('정말 처음부터 다시 개발하시겠습니까?\n\n요구사항 분석, Epic & Story는 유지되고,\n스크럼 마스터, 개발, 테스트 등은 초기화됩니다.')) {
                      await onResetDevelopment();
                      window.location.reload();
                    }
                  }}
                  className="px-8 py-3 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white font-semibold rounded-lg text-lg transition-all border-2 border-red-400/50"
                >
                  🔄 처음부터 다시 개발
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={startDevelopment}
              className="px-8 py-3 bg-gradient-to-r from-purple-600 to-amber-500 hover:from-purple-700 hover:to-amber-600 text-white font-semibold rounded-lg text-lg transition-all"
            >
              🚀 개발 시작하기
            </button>
          )}
        </div>
      </div>
    );
  }

  // ========== 2열 레이아웃 개발 진행 중 UI (1:3 비율) ==========
  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-2">
      {/* ========== 1열: 개발 진행 상황 + Epic/Story ========== */}
      <div className="lg:col-span-1 space-y-2">
        {/* 개발 진행 상황 카드 (간소화) */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-2 border-2 border-white/20 shadow-card">
          {/* 헤더 + 진행률 + 컨트롤 */}
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xs font-semibold text-white">📊</h2>
            <div className="flex-1 bg-white/10 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-purple-600 to-amber-500 h-2 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
            <span className="text-sm font-bold text-white tabular-nums w-10 text-right">{overallProgress.toFixed(0)}%</span>

            {/* 일시정지/재개 버튼 */}
            {(() => {
              const isRunning = latestExecution?.status === 'RUNNING';
              const isPaused = !isRunning && scrumMasterData?.tasks?.some((t: Task) => t.status === 'completed');
              return isRunning ? (
                onPauseDevelopment && (
                  <button
                    onClick={onPauseDevelopment}
                    className="p-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded transition-all border border-amber-500/30"
                    title="일시정지"
                  >
                    <Pause size={12} />
                  </button>
                )
              ) : isPaused ? (
                onResumeDevelopment && (
                  <button
                    onClick={() => onResumeDevelopment()}
                    className="p-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded transition-all border border-green-500/30"
                    title="재개"
                  >
                    <Play size={12} />
                  </button>
                )
              ) : null;
            })()}
          </div>

          {/* 현재 작업 중인 Story (간소화) */}
          {!isEpicStoryRunning && scrumMasterData?.currentEpic && scrumMasterData?.currentStory ? (
            <div className="bg-white/5 rounded p-1.5 border border-white/10">
              <p className="text-white/60 text-xs truncate">
                Epic {scrumMasterData.currentEpic.order} • {scrumMasterData.currentStory.title}
              </p>
            </div>
          ) : scrumMasterData?.summary?.totalTasks === 0 ? (
            <div className="bg-yellow-500/10 rounded p-1.5 border border-yellow-500/30">
              <p className="text-yellow-300 text-xs truncate">⏳ Task 생성 대기 중...</p>
            </div>
          ) : null}

          {/* 현재 실행 중인 에이전트 (간소화) */}
          {!storyFailure && latestExecution && latestExecution.status === 'RUNNING' && (
            <div className="flex items-center gap-2 py-1 px-2 bg-yellow-500/10 border border-yellow-500/40 rounded animate-pulse-glow">
              <div className="animate-spin w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full flex-shrink-0"></div>
              <p className="text-yellow-300 text-xs font-medium truncate flex-1">
                {latestExecution.agentName}
              </p>
            </div>
          )}

          {/* 처음부터 다시 개발 버튼 (간소화) */}
          {onResetDevelopment && (
            <button
              onClick={async () => {
                if (confirm('정말 처음부터 다시 개발하시겠습니까?\n\n요구사항 분석, Epic & Story는 유지되고,\n스크럼 마스터, 개발, 테스트 등은 초기화됩니다.')) {
                  await onResetDevelopment();
                  window.location.reload();
                }
              }}
              className="w-full px-2 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded text-xs font-medium transition-all border border-red-500/30 hover:border-red-500/50 flex items-center justify-center gap-1"
              title="처음부터 다시 개발"
            >
              🔄 리셋
            </button>
          )}

          {/* 이어서 계속 진행 버튼 (간소화) */}
          {(() => {
            const hasRunningAgent = latestExecution?.status === 'RUNNING';
            const hasCompletedTasks = scrumMasterData?.tasks?.some((t: Task) => t.status === 'completed');
            const hasPendingTasks = scrumMasterData?.tasks?.some((t: Task) => t.status === 'pending');
            const isPaused = !hasRunningAgent && hasCompletedTasks && hasPendingTasks;

            if (isPaused) {
              return (
                <button
                  onClick={startDevelopment}
                  className="w-full px-2 py-1.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded text-xs transition-all border border-orange-400/50 font-semibold shadow-glow flex items-center justify-center gap-1 animate-pulse-glow"
                >
                  ▶️ 계속 진행
                </button>
              );
            }
            return null;
          })()}
        </div>

        {/* Epic & Story Branch View */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-3 border-2 border-white/20 shadow-card">
          <h3 className="text-white font-semibold mb-2 text-sm flex items-center gap-2">
            <span className="text-base">📚</span>
            Epics & Stories
          </h3>
          <div ref={epicStoryContainerRef} className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scroll">
            {epicsWithStories.map((epic: any, epicIndex: number) => {
              const totalStories = epic.stories.length;
              const completedStories = epic.stories.filter((s: Story) =>
                s.tasks.length > 0 && s.tasks.every((t: Task) => getTaskProgressStatus(t).phase === 'completed')
              ).length;
              // 포인트 기준 진행률 계산
              const totalPoints = epic.stories.reduce((sum: number, s: Story) => sum + (s.storyPoints || 0), 0);
              const completedPoints = epic.stories
                .filter((s: Story) => s.tasks.length > 0 && s.tasks.every((t: Task) => getTaskProgressStatus(t).phase === 'completed'))
                .reduce((sum: number, s: Story) => sum + (s.storyPoints || 0), 0);
              const epicProgress = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;
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
                  <div className="ml-3 mt-1 space-y-1">
                    {epic.stories.map((story: any, storyIndex: number) => {
                      const storyTasks = story.tasks || [];
                      const allTasksCompleted = storyTasks.length > 0 && storyTasks.every((t: Task) => getTaskProgressStatus(t).phase === 'completed');
                      const someTasksCompleted = storyTasks.some((t: Task) => getTaskProgressStatus(t).phase !== 'pending' && getTaskProgressStatus(t).phase !== 'failed');
                      const isCurrentStory = scrumMasterData?.currentStory?.storyOrder === story.storyOrder;
                      // 일시정지 상태이거나 실패 상태이면 깜빡이지 않음
                      const shouldPulse = isCurrentStory && !isDevelopmentPaused && !storyFailure;

                      return (
                        <div
                          key={story.id}
                          data-epic-index={epicIndex}
                          data-story-index={storyIndex}
                          onClick={() => {
                            setSelectedEpicIndex(epicIndex);
                            setSelectedStoryIndex(storyIndex);
                          }}
                          className={`p-2 rounded-lg cursor-pointer transition-all border-2 ${
                            selectedEpicIndex === epicIndex && selectedStoryIndex === storyIndex
                              ? 'bg-purple-500/40 border-purple-500 shadow-glow'
                              : isCurrentStory
                              ? 'bg-yellow-500/20 border-yellow-500/40'
                              : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/20'
                          } ${shouldPulse ? 'animate-pulse-glow' : ''}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-white/90 text-sm font-medium truncate flex-1">{story.title}</span>
                            <div className="flex items-center gap-1.5">
                              {story.storyPoints && (
                                <span className="text-xs text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded font-medium">
                                  {story.storyPoints}pt
                                </span>
                              )}
                              {storyTasks.length > 0 && (
                                <span className="text-xs text-white/60 bg-white/10 px-1.5 py-0.5 rounded font-medium">
                                  {storyTasks.length}t
                                </span>
                              )}
                              {allTasksCompleted && (
                                <span className="text-green-400 text-sm">✓</span>
                              )}
                              {/* 일시정지 또는 실패 상태이면 스피너 숨김 */}
                              {someTasksCompleted && !allTasksCompleted && !isDevelopmentPaused && !storyFailure && (
                                <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin"></div>
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

      {/* ========== 2열: Tasks (확대) ========== */}
      <div className="lg:col-span-3 space-y-2">
        {/* Tasks Header */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-3 border-2 border-white/20 shadow-card">
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

          {/* 현재 선택된 Story의 Tasks - 3열 그리드 */}
          {selectedEpicIndex !== null && selectedStoryIndex !== null ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[600px] overflow-y-auto pr-2 custom-scroll">
              {epicsWithStories[selectedEpicIndex]?.stories[selectedStoryIndex]?.tasks.map((task: Task) => {
                const progressStatus = getTaskProgressStatus(task);
                const isTaskRunning = latestExecution?.agentId === 'developer' && task.status === 'developing';

                return (
                  <div
                    key={task.id}
                    className={`p-3 rounded-xl border-2 transition-all shadow-card ${progressStatus.bgColor} ${progressStatus.borderColor} ${
                      progressStatus.phase === 'development' && task.status === 'developing' ? 'animate-pulse-glow' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Status Icon */}
                      <div className="flex-shrink-0 mt-1">
                        {progressStatus.phase === 'development' && task.status === 'developing' ? (
                          <div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <span className={`text-lg ${progressStatus.phase === 'completed' ? 'text-green-400 animate-scale-in' : progressStatus.phase === 'failed' ? 'text-red-400' : 'text-white/70'}`}>
                            {progressStatus.icon}
                          </span>
                        )}
                      </div>

                      {/* Task Content */}
                      <div className="flex-1 min-w-0 pt-0.5 pl-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-white text-base font-semibold truncate">{task.title}</span>
                          {isTaskRunning && (
                            <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
                          )}
                        </div>
                        <p className="text-white/70 text-xs line-clamp-2" title={task.description}>
                          {task.description}
                        </p>

                        {/* Bottom Row: Priority Badge + Progress Status */}
                        <div className="mt-2 flex items-center gap-2">
                          {/* Priority Badge */}
                          <div className={`px-2 py-0.5 rounded-md text-xs font-bold border-2 flex-shrink-0 ${
                            task.priority === 'high'
                              ? 'bg-red-500/90 text-white border-red-400'
                              : task.priority === 'medium'
                              ? 'bg-yellow-500/90 text-white border-yellow-400'
                              : 'bg-blue-500/90 text-white border-blue-400'
                          }`}>
                            {task.priority === 'high' ? 'HIGH' : task.priority === 'medium' ? 'MED' : 'LOW'}
                          </div>

                          {/* Progress Status Label */}
                          <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${
                            progressStatus.phase === 'completed'
                              ? 'bg-green-500/20 text-green-300'
                              : progressStatus.phase === 'failed'
                              ? 'bg-red-500/20 text-red-300'
                              : progressStatus.phase === 'testing'
                              ? 'bg-cyan-500/20 text-cyan-300'
                              : progressStatus.phase === 'review'
                              ? 'bg-blue-500/20 text-blue-300'
                              : progressStatus.phase === 'development'
                              ? 'bg-purple-500/20 text-purple-300'
                              : 'bg-gray-500/20 text-gray-300'
                          }`}>
                            <span>{progressStatus.icon}</span>
                            <span>{progressStatus.label}</span>
                          </div>
                        </div>
                      </div>
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
        {/* Story 실패 알림 카드 */}
        {storyFailure && (
          <div className="bg-gradient-to-br from-red-500/10 to-orange-500/10 backdrop-blur-lg rounded-2xl p-5 border-2 border-red-500/40 shadow-glow">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center border-2 border-red-500/40">
                <span className="text-3xl">⚠️</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-red-300 text-base font-bold">Story 개발 실패</h3>
                    <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse"></div>
                  </div>
                  {/* 전체 복사 버튼 */}
                  <button
                    onClick={() => {
                      // 실패 메시지 전체 생성
                      const failureText = storyFailure.failedTasks.map((task: any) => {
                        let text = `Task: ${task.title}\n`;
                        text += `Description: ${task.description}\n`;

                        if (task.errors && task.errors.length > 0) {
                          task.errors.forEach((errorInfo: any) => {
                            text += `\n[${errorInfo.agentName} (${errorInfo.agentId})]\n`;
                            text += `Error: ${errorInfo.error.message || '알 수 없는 오류'}\n`;
                            if (errorInfo.error.stackTrace) {
                              text += `Stack Trace:\n${errorInfo.error.stackTrace}\n`;
                            }
                          });
                        } else {
                          text += `\n⚠️ 상세 에러 정보를 찾을 수 없습니다.\n`;
                        }

                        text += '\n' + '='.repeat(60) + '\n';
                        return text;
                      }).join('\n');

                      // 클립보드에 복사
                      navigator.clipboard.writeText(failureText).then(() => {
                        toast.showSuccess('실패 메시지가 클립보드에 복사되었습니다.');
                      }).catch(() => {
                        toast.showError('클립보드 복사에 실패했습니다.');
                      });
                    }}
                    className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs rounded-lg border border-white/20 transition-all flex items-center gap-1.5"
                    title="전체 실패 메시지 클립보드에 복사"
                  >
                    <span>📋</span>
                    <span>전체 복사</span>
                  </button>
                </div>
                <p className="text-white/90 text-sm mb-4">
                  {storyFailure.failedCount}개의 Task가 실패하여 개발이 중단되었습니다.
                </p>

                {/* 실패한 Task 목록 - 상세 정보 포함 */}
                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scroll">
                  {storyFailure.failedTasks.map((task: any, index: number) => (
                    <div key={task.id} className="bg-red-500/10 rounded-lg p-3 border border-red-500/30">
                      {/* Task 헤더 */}
                      <div className="flex items-start gap-2 mb-2">
                        <span className="text-red-400 flex-shrink-0 text-lg">✗</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-semibold">{task.title}</p>
                          <p className="text-white/70 text-xs mt-1">{task.description}</p>
                        </div>
                      </div>

                      {/* 에러 상세 정보 */}
                      {task.errors && task.errors.length > 0 ? (
                        <div className="mt-2 space-y-2">
                          {task.errors.map((errorInfo: any, errorIdx: number) => (
                            <div key={errorIdx} className="bg-black/20 rounded-lg p-2 border border-red-500/20">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs text-red-400 font-medium">{errorInfo.agentName}</span>
                                <span className="text-xs text-white/50">•</span>
                                <span className="text-xs text-white/40 font-mono">{errorInfo.agentId}</span>
                              </div>
                              <div className="text-red-300 text-xs font-mono bg-black/30 rounded p-2 whitespace-pre-wrap break-words">
                                {errorInfo.error.message || errorInfo.error.stackTrace || '알 수 없는 오류'}
                              </div>
                              {errorInfo.error.stackTrace && (
                                <details className="mt-2">
                                  <summary className="text-xs text-white/60 cursor-pointer hover:text-white/80 transition-colors">
                                    Stack Trace 보기
                                  </summary>
                                  <pre className="text-xs text-white/40 font-mono mt-2 whitespace-pre-wrap break-all">
                                    {errorInfo.error.stackTrace}
                                  </pre>
                                </details>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-yellow-300 bg-yellow-500/10 rounded p-2 border border-yellow-500/20">
                          ⚠️ 상세 에러 정보를 찾을 수 없습니다. Agent Output 탭에서 전체 로그를 확인하세요.
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* 재시도 버튼 */}
                <button
                  onClick={async () => {
                    console.log('[Development] Retry failed tasks:', storyFailure.failedTasks);

                    // 재시도 중 플래그 설정 (실패 토스트 중복 방지)
                    setIsRetrying(true);

                    try {
                      // 실패한 Task 재시도 API 호출
                      const response = await fetch('http://localhost:4000/api/magic/retry-failed-tasks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId }),
                      });

                      if (!response.ok) {
                        const error = await response.json();
                        console.error('[Development] Retry failed:', error);
                        toast.showError(`재시도 실패: ${error.error?.message || '알 수 없는 오류'}`);
                        setIsRetrying(false); // 실패 시 플래그 해제
                        return;
                      }

                      console.log('[Development] Retry initiated successfully');
                      toast.showSuccess('실패한 Task 재시도를 시작했습니다.');

                      // 실패 상태 초기화
                      if (onClearFailure) {
                        onClearFailure();
                      }

                      // 일정 시간 후 플래그 해제 (개발이 시작될 때까지 실패 알림 방지)
                      setTimeout(() => {
                        setIsRetrying(false);
                      }, 5000);
                    } catch (error) {
                      console.error('[Development] Retry error:', error);
                      toast.showError('재시도 중 오류가 발생했습니다.');
                      setIsRetrying(false); // 에러 시 플래그 해제
                    }
                  }}
                  className="mt-3 w-full px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-sm font-medium transition-all border-2 border-red-500/30 hover:border-red-500/50 flex items-center justify-center gap-2"
                >
                  <span>🔄</span>
                  실패한 Task 재시도
                </button>
              </div>
            </div>
          </div>
        )}

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
