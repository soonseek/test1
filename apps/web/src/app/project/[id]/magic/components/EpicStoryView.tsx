'use client';

import { useState } from 'react';
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

interface EpicStoryViewProps {
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

export default function EpicStoryView({
  executions,
  onRestart,
  reloadingAgents,
  projectId,
  currentActivity,
  onStartDevelopment,
  onPauseDevelopment,
  onResumeDevelopment,
}: EpicStoryViewProps) {
  const [selectedEpicIndex, setSelectedEpicIndex] = useState<number>(0);
  const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);
  const lastExecution = executions[0];

  if (!lastExecution || lastExecution.status === 'IDLE') {
    return (
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
        <div className="text-white/70 text-center py-8">
          아직 실행되지 않았습니다
        </div>
      </div>
    );
  }

  // RUNNING 또는 COMPLETED 상태 모두에서 데이터 추출
  const output = lastExecution.output || {};
  const { epics = [], stories = [], summary } = output;

  // Epic별 Story 그룹화
  const getStoriesForEpic = (epicIndex: number) => {
    const epic = epics[epicIndex];
    if (!epic) return [];
    return stories.filter((s: any) => s.epicId === epic.id);
  };

  const selectedEpicStories = selectedEpicIndex !== null ? getStoriesForEpic(selectedEpicIndex) : [];
  const selectedStory = selectedStoryIndex !== null && selectedEpicStories[selectedStoryIndex]
    ? selectedEpicStories[selectedStoryIndex]
    : null;

  // 진행 상황 표시 (RUNNING일 때)
  if (lastExecution.status === 'RUNNING') {
    return (
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
        <div className="text-center py-12">
          <div className="animate-spin inline-block w-16 h-16 border-4 border-white/20 border-t-white rounded-full mb-6"></div>
          <h3 className="text-xl font-semibold text-white mb-2">Epic & Story 생성 중...</h3>
          {output.currentStep && (
            <p className="text-white/70 mb-4">{output.currentStep}</p>
          )}
          {output.currentEpic && (
            <div className="bg-white/5 rounded-lg p-3 mb-2">
              <p className="text-white/80 text-sm">
                📋 Epic 생성 중: {output.currentEpic.title}
                <span className="ml-2 text-white/60">
                  ({output.currentEpic.index} / {output.currentEpic.total})
                </span>
              </p>
            </div>
          )}
          {output.currentStory && (
            <div className="bg-white/5 rounded-lg p-3 mb-2">
              <p className="text-white/80 text-sm">
                📝 Story 생성 중: {output.currentStory.title}
                <span className="ml-2 text-white/60">
                  (Epic {output.currentStory.epicIndex}, Story {output.currentStory.storyIndex} / {output.currentStory.totalStories})
                </span>
              </p>
            </div>
          )}
          {currentActivity?.activity && currentActivity.agentId === 'epic-story' && (
            <div className="mt-4 mx-auto max-w-lg">
              <div className="bg-white/5 backdrop-blur-sm rounded-lg p-3 border border-white/10">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-xs text-white/50 font-mono">현재 작업</span>
                </div>
                <p className="text-sm text-white/80 font-mono text-left truncate" title={currentActivity.activity}>
                  {currentActivity.activity.length > 50
                    ? currentActivity.activity.substring(0, 50) + '...'
                    : currentActivity.activity}
                </p>
              </div>
            </div>
          )}

          {/* 진행 상황 실시간 미리보기 (생성된 것부터 표시) */}
          {(epics.length > 0 || stories.length > 0) && (
            <div className="mt-8 text-left">
              <div className="text-white/60 text-sm mb-3">진행 상황 미리보기:</div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Epic 목록 */}
                <div className="space-y-2">
                  <h4 className="text-white font-medium text-sm mb-2">Epic ({epics.length})</h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {epics.map((epic: any, i: number) => (
                      <div
                        key={i}
                        className={`p-2 rounded text-xs ${
                          i === selectedEpicIndex ? 'bg-purple-500/20 border border-purple-500' : 'bg-white/5'
                        }`}
                      >
                        <div className="text-white font-medium truncate">{epic.title}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Story 목록 */}
                <div className="space-y-2">
                  <h4 className="text-white font-medium text-sm mb-2">Story ({stories.length})</h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {stories.slice(0, 10).map((story: any, i: number) => (
                      <div
                        key={i}
                        className="p-2 rounded text-xs bg-white/5"
                      >
                        <div className="text-white/80 truncate text-xs">{story.title}</div>
                      </div>
                    ))}
                    {stories.length > 10 && (
                      <div className="text-white/50 text-xs p-2 text-center">
                        +{stories.length - 10} more
                      </div>
                    )}
                  </div>
                </div>

                {/* 최근 생성된 Story 상세 */}
                {stories.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-white font-medium text-sm mb-2">최근 Story</h4>
                    <div className="bg-white/5 rounded p-2 max-h-40 overflow-y-auto">
                      <div className="text-white/80 text-xs whitespace-pre-wrap line-clamp-6">
                        {stories[stories.length - 1].markdown}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (lastExecution.status === 'FAILED') {
    return (
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Epic & Story</h2>
          <span className="text-red-400 text-sm">실패</span>
        </div>

        {lastExecution.error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <div className="text-red-300 text-sm mb-4">{lastExecution.error.message}</div>
            <button
              onClick={() => onRestart(lastExecution.agentId)}
              disabled={reloadingAgents.has(lastExecution.agentId)}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {reloadingAgents.has(lastExecution.agentId) ? '재시작 중...' : '재시작'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // COMPLETED 상태 - 3단계 레이아웃
  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
      {/* 헤더: Summary + 액션 버튼 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-6">
          <h2 className="text-xl font-semibold text-white">Epic & Story 완료 ✨</h2>
          <div className="flex gap-4 text-sm">
            <div className="text-white/70">{epics.length} Epic</div>
            <div className="text-white/70">{stories.length} Story</div>
            <div className="text-white/70">{stories.reduce((sum: number, s: any) => sum + (s.storyPoints || 0), 0)} Points</div>
          </div>
        </div>

        {/* 액션 버튼 그룹 */}
        <div className="flex gap-3">
          <button
            onClick={() => onRestart(lastExecution.agentId)}
            disabled={reloadingAgents.has(lastExecution.agentId)}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-colors disabled:opacity-50 border border-white/20"
          >
            {reloadingAgents.has(lastExecution.agentId) ? '재시작 중...' : '🔄 재시도'}
          </button>
          <button
            onClick={() => {
              console.log('[EpicStory] Starting development...');
              if (onStartDevelopment) {
                onStartDevelopment();
              }
            }}
            className="px-4 py-2 bg-gradient-to-r from-purple-600 to-amber-500 hover:from-purple-700 hover:to-amber-600 text-white font-semibold rounded-lg text-sm transition-all"
          >
            💻 개발 시작 →
          </button>
          {/* 일시정지/재개 버튼 */}
          {onPauseDevelopment && (
            <button
              onClick={onPauseDevelopment}
              className="p-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-lg transition-all border-2 border-amber-500/30"
              title="개발 일시정지"
            >
              <Pause size={16} />
            </button>
          )}
          {onResumeDevelopment && (
            <button
              onClick={onResumeDevelopment}
              className="p-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg transition-all border-2 border-green-500/30"
              title="개발 재개"
            >
              <Play size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 3단계 레이아웃: Epic 목록 | Story 목록 | Story 뷰어 */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[600px]">
        {/* 1단계: Epic 목록 (1/4) */}
        <div className="space-y-3">
          <h3 className="text-white font-medium text-sm mb-2">Epic 목록</h3>
          <div className="space-y-2 overflow-y-auto max-h-[550px] pr-2">
            {epics.map((epic: any, index: number) => (
              <div
                key={index}
                onClick={() => {
                  setSelectedEpicIndex(index);
                  setSelectedStoryIndex(null);
                }}
                className={`p-3 rounded-lg cursor-pointer transition-all ${
                  index === selectedEpicIndex
                    ? 'bg-purple-500/30 border border-purple-500'
                    : 'bg-white/5 border border-white/20 hover:border-purple-400'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white font-medium text-sm">{epic.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    epic.priority === 'high' ? 'bg-red-500/30 text-red-300' :
                    epic.priority === 'medium' ? 'bg-yellow-500/30 text-yellow-300' :
                    'bg-blue-500/30 text-blue-300'
                  }`}>
                    {epic.priority}
                  </span>
                </div>
                <p className="text-white/60 text-xs line-clamp-2">{epic.description}</p>
                <div className="text-white/50 text-xs mt-2">
                  {getStoriesForEpic(index).length} stories
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 2단계: Story 목록 (1/4) */}
        <div className="space-y-3">
          <h3 className="text-white font-medium text-sm mb-2">
            {selectedEpicStories.length > 0
              ? epics[selectedEpicIndex]?.title
              : 'Story 목록'}
          </h3>
          <div className="space-y-2 overflow-y-auto max-h-[550px] pr-2">
            {selectedEpicStories.length > 0 ? (
              selectedEpicStories.map((story: any, index: number) => (
                <div
                  key={index}
                  onClick={() => setSelectedStoryIndex(index)}
                  className={`p-3 rounded-lg cursor-pointer transition-all ${
                    index === selectedStoryIndex
                      ? 'bg-purple-500/30 border border-purple-500'
                      : 'bg-white/5 border border-white/20 hover:border-purple-400'
                  }`}
                >
                  <div className="flex items-start justify-between mb-1">
                    <span className="text-white font-medium text-sm">{story.title}</span>
                    <span className="text-xs bg-white/10 px-2 py-0.5 rounded text-white/70">
                      {story.storyPoints}pt
                    </span>
                  </div>
                  <p className="text-white/60 text-xs line-clamp-2">{story.description}</p>
                </div>
              ))
            ) : (
              <div className="text-white/50 text-sm text-center py-8">
                Epic을 선택하면 Story가 표시됩니다
              </div>
            )}
          </div>
        </div>

        {/* 3단계: Story 상세 뷰어 (2/4) */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-white font-medium text-sm mb-2">
            {selectedStory
              ? `Story: ${selectedStory.title}`
              : 'Story 상세'}
          </h3>
          <div className="bg-white/5 rounded-lg border border-white/10 h-[550px] overflow-y-auto">
            {selectedStory ? (
              <div className="p-4">
                <div className="text-white text-sm custom-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedStory.markdown}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <div className="text-white/50 text-sm text-center py-8">
                Story를 선택하면 상세 내용이 표시됩니다
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
