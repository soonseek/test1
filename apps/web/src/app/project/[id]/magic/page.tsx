'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import EpicStoryView from './components/EpicStoryView';
import DevelopmentView from './components/DevelopmentView';
import DebuggingView from './components/DebuggingView';
import FeatureAdditionView from './components/FeatureAdditionView';

type AgentTab = 'overview' | 'requirement' | 'epic-story' | 'development' | 'debugging' | 'feature-addition' | 'errors';

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

interface ApiErrorResponse {
  error?: {
    message?: string;
  };
}

interface AgentExecutionsResponse {
  executions: AgentExecution[];
}

interface GitHubCreateRepoResponse {
  message: string;
  repoName: string;
  repoUrl: string;
}

interface DeployResponse {
  message: string;
  deploymentUrl: string;
  subdomain: string;
}

export default function MagicPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [activeTab, setActiveTab] = useState<AgentTab>('overview');
  const [agentExecutions, setAgentExecutions] = useState<AgentExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadingAgents, setReloadingAgents] = useState<Set<string>>(new Set());
  const [selectedPRDId, setSelectedPRDId] = useState<string | null>(null);
  const [currentViewingPRDId, setCurrentViewingPRDId] = useState<string | null>(null);
  const [showGitHubModal, setShowGitHubModal] = useState(false);
  const [repoName, setRepoName] = useState('');
  const [project, setProject] = useState<any>(null);
  const [currentActivity, setCurrentActivity] = useState<{
    activity: string | null;
    agentName: string | null;
    agentId: string | null;
  }>({ activity: null, agentName: null, agentId: null });

  // Agent 상태 조회
  const fetchStatus = async () => {
    try {
      const response = await fetch(`http://localhost:4000/api/magic/agents/${projectId}`);
      const data = await response.json() as AgentExecutionsResponse;
      setAgentExecutions(data.executions || []);

      // 프로젝트 정보도 가져오기
      const projectResponse = await fetch(`http://localhost:4000/api/projects/${projectId}`);
      const projectData = await projectResponse.json();
      setProject(projectData.project);
    } catch (error) {
      console.error('[Magic Page] Failed to fetch agent status:', error);
    }
  };

  // 현재 실행 중인 에이전트의 활동 로그 조회
  const fetchActivity = async () => {
    try {
      const response = await fetch(`http://localhost:4000/api/magic/activity/${projectId}`);
      const data = await response.json();
      setCurrentActivity({
        activity: data.activity,
        agentName: data.agentName,
        agentId: data.agentId,
      });
    } catch (error) {
      console.error('[Magic Page] Failed to fetch activity:', error);
    }
  };

  // 주기적 상태 조회
  useEffect(() => {
    fetchStatus();
    fetchActivity(); // 활동 로그도 함께 조회
    const interval = setInterval(() => {
      fetchStatus();
      fetchActivity();
    }, 3000);
    return () => clearInterval(interval);
  }, [projectId]);

  // 마법 시작
  const startMagic = async () => {
    setLoading(true);
    console.log('[Magic Page] Starting magic for project:', projectId);

    try {
      const response = await fetch('http://localhost:4000/api/magic/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      if (!response.ok) {
        const error = await response.json() as ApiErrorResponse;
        console.error('[Magic Page] Error:', error);
        alert(`오류: ${error.error?.message || '마법 시작 실패'}`);
        return;
      }

      console.log('[Magic Page] Magic started successfully');
      await fetchStatus();
    } catch (error) {
      console.error('[Magic Page] Fetch error:', error);
      alert(`오류: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  // Agent 재시작
  const restartAgent = async (agentId: string) => {
    console.log(`[Magic Page] Restarting agent: ${agentId}`);

    // 로딩 상태 시작
    setReloadingAgents(prev => new Set(prev).add(agentId));

    try {
      const response = await fetch(`http://localhost:4000/api/magic/restart/${projectId}/${agentId}`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json() as ApiErrorResponse;
        alert(`재시작 실패: ${error.error?.message}`);
        return;
      }

      await fetchStatus();
    } catch (error) {
      console.error(`[Magic Page] Failed to restart ${agentId}:`, error);
      alert(`오류: ${error}`);
    } finally {
      // 로딩 상태 종료
      setReloadingAgents(prev => {
        const newSet = new Set(prev);
        newSet.delete(agentId);
        return newSet;
      });
    }
  };

  // 새로고침
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchStatus();
    setTimeout(() => setRefreshing(false), 500);
  };

  // Netlify 배포 핸들러
  const handleDeploy = async () => {
    try {
      const response = await fetch(`http://localhost:4000/api/magic/deploy/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const error = await response.json() as ApiErrorResponse;
        alert(`배포 실패: ${error.error?.message || '알 수 없는 오류'}`);
        return;
      }

      const data = await response.json() as DeployResponse;
      alert(`배포 시작되었습니다!\n배포 URL: ${data.deploymentUrl || '생성 중...'}`);
    } catch (error) {
      console.error('[Magic Page] Deploy error:', error);
      alert('배포 요청 실패');
    }
  };

  // PRD 선택 및 확정
  const selectPRD = async (prdId: string) => {
    try {
      const response = await fetch(`http://localhost:4000/api/magic/select-prd/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prdId }),
      });

      if (!response.ok) {
        alert('PRD 선택 실패');
        return;
      }

      setSelectedPRDId(prdId);

      // 다음 에이전트(Epic & Story) 자동 실행
      console.log('[Magic Page] PRD selected, starting Epic & Story agent...');
      await fetch(`http://localhost:4000/api/magic/restart/${projectId}/epic-story`, {
        method: 'POST',
      });

      // 다음 탭으로 이동 (Epic & Story)
      setActiveTab('epic-story');
      await fetchStatus();
    } catch (error) {
      console.error('PRD selection error:', error);
      alert('PRD 선택 실패');
    }
  };

  // Agent별 실행 내역 가져오기
  const getAgentExecutions = (agentId: string) => {
    return agentExecutions.filter(e => e.agentId === agentId);
  };

  // 전체 에러 가져오기
  const getErrors = () => {
    return agentExecutions.filter(e => e.status === 'FAILED');
  };

  // 상태 색상
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'text-green-400';
      case 'RUNNING': return 'text-yellow-400';
      case 'FAILED': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  // 개발 완료 여부 확인
  const isDevelopmentCompleted = () => {
    const developerExecution = agentExecutions.find(e => e.agentId === 'developer');
    return developerExecution?.status === 'COMPLETED';
  };

  // 배포 가능 여부 확인
  const canDeploy = () => {
    const deployment = project?.deployment;
    return deployment?.githubRepoUrl && deployment?.githubBranch;
  };

  // 개발 시작 (Epic & Story → Development)
  const startDevelopment = async () => {
    console.log('[Magic Page] Starting development workflow...');

    try {
      // Scrum Master 에이전트 시작
      await fetch(`http://localhost:4000/api/magic/restart/${projectId}/scrum-master`, {
        method: 'POST',
      });

      // 개발 탭으로 전환
      setActiveTab('development');
      await fetchStatus();
    } catch (error) {
      console.error('[Magic Page] Failed to start development:', error);
      alert('개발 시작 실패');
    }
  };

  const tabs = [
    { id: 'overview' as AgentTab, label: '전체 보기', icon: '📊' },
    { id: 'requirement' as AgentTab, label: '요구사항 분석', icon: '✨', agentId: 'requirement-analyzer' },
    { id: 'epic-story' as AgentTab, label: 'Epic & Story', icon: '📄', agentId: 'epic-story' },
    { id: 'development' as AgentTab, label: '개발', icon: '💻' },
    { id: 'debugging' as AgentTab, label: '디버깅', icon: '🐛' },
    { id: 'feature-addition' as AgentTab, label: '기능추가', icon: '➕' },
    { id: 'errors' as AgentTab, label: '에러 기록', icon: '❌' },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-midnight via-deep-indigo to-midnight relative overflow-hidden">
      {/* Background Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="mystical-blob absolute top-0 left-1/4 w-[450px] h-[450px] bg-vivid-purple" />
        <div className="mystical-blob absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-dark-magenta" style={{ animationDelay: '2s' }} />
      </div>

      {/* Header */}
      <div className="relative glass-card border-b border-vivid-purple/20">
        <div className="max-w-7xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <button className="text-mystic-violet hover:text-white transition-colors flex items-center gap-2 group">
                  <span className="group-hover:-translate-x-1 transition-transform">←</span>
                  <span>뒤로가기</span>
                </button>
              </Link>
              <div>
                <h1 className="text-3xl font-display font-bold text-white flex items-center gap-3">
                  <span className="text-4xl animate-float">🪄</span>
                  <span>{project?.name || 'MVP 생성'}</span>
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all disabled:opacity-50 flex items-center gap-2 border border-vivid-purple/20 hover:border-vivid-purple/40 group"
              >
                <span className="text-lg group-hover:rotate-180 transition-transform duration-500">🔄</span>
                <span className="font-medium">{refreshing ? '새로고침 중...' : '새로고침'}</span>
              </button>
              {agentExecutions.length === 0 && (
                <button
                  onClick={startMagic}
                  disabled={loading}
                  className="px-7 py-2.5 bg-gradient-to-r from-vivid-purple to-dark-magenta text-white font-display font-bold rounded-xl hover:shadow-glow-xl transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  <span className="text-xl">🪄</span>
                  <span>{loading ? '시작 중...' : '마법 시작'}</span>
                </button>
              )}
              {agentExecutions.length > 0 && (
                <>
                  <div className="px-6 py-2.5 bg-green-600/20 border border-green-500/50 text-green-300 font-display font-bold rounded-xl flex items-center gap-2 animate-pulse-glow">
                    <span className="text-xl">✨</span>
                    <span>마법 부리는 중...</span>
                  </div>
                  <button
                    onClick={() => setShowGitHubModal(true)}
                    disabled={!isDevelopmentCompleted()}
                    className={`px-5 py-2.5 text-white rounded-xl transition-all border flex items-center gap-2 font-medium ${
                      isDevelopmentCompleted()
                        ? 'bg-royal-purple/30 border-vivid-purple/40 hover:bg-royal-purple/40 hover:border-vivid-purple/60'
                        : 'bg-royal-purple/10 border-vivid-purple/20 opacity-50 cursor-not-allowed'
                    }`}
                    title={isDevelopmentCompleted() ? 'GitHub에 코드 푸시' : '개발 완료 후 사용 가능'}
                  >
                    <span>📦</span>
                    <span>GitHub 푸시</span>
                  </button>
                  <button
                    onClick={() => handleDeploy()}
                    disabled={!canDeploy()}
                    className={`px-5 py-2.5 text-white font-display font-bold rounded-xl transition-all flex items-center gap-2 ${
                      canDeploy()
                        ? 'bg-gradient-to-r from-teal-600 to-cyan-500 hover:from-teal-700 hover:to-cyan-600 shadow-glow'
                        : 'bg-gray-600/50 opacity-50 cursor-not-allowed'
                    }`}
                    title={canDeploy() ? 'Netlify에 배포' : 'GitHub 푸시 후 사용 가능'}
                  >
                    <span>🚀</span>
                    <span>배포</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="relative glass-card border-b border-vivid-purple/20 overflow-x-auto">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-2 py-3">
            {tabs.map(tab => {
              const executions = tab.agentId ? getAgentExecutions(tab.agentId) : [];
              const lastExecution = executions[0];
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-vivid-purple/20 border-2 border-vivid-purple/50 text-white shadow-glow'
                      : 'text-mystic-violet hover:bg-white/10 hover:text-white border-2 border-transparent'
                  }`}
                >
                  <span className="text-lg">{tab.icon}</span>
                  <span className="text-sm font-display font-semibold">{tab.label}</span>
                  {tab.agentId && lastExecution && (
                    <span className={`text-xs ${getStatusColor(lastExecution.status)}`}>
                      {lastExecution.status === 'COMPLETED' && '✓'}
                      {lastExecution.status === 'RUNNING' && '⏳'}
                      {lastExecution.status === 'FAILED' && '✗'}
                    </span>
                  )}
                  {tab.id === 'errors' && (
                    <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                      {getErrors().length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="relative max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h2 className="text-xl font-semibold text-white mb-4">전체 진행 상황</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {tabs.filter(t => t.agentId).map(tab => {
                  const executions = getAgentExecutions(tab.agentId!);
                  const lastExecution = executions[0];
                  const status = lastExecution?.status || 'PENDING';

                  return (
                    <div
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as AgentTab)}
                      className="bg-white/5 rounded-lg p-4 cursor-pointer hover:bg-white/10 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">{tab.icon}</span>
                        <span className="text-white font-medium text-sm">{tab.label}</span>
                      </div>
                      <div className={`text-sm ${getStatusColor(status)}`}>
                        {status === 'PENDING' && '대기 중'}
                        {status === 'RUNNING' && '진행 중...'}
                        {status === 'COMPLETED' && '완료'}
                        {status === 'FAILED' && '실패'}
                      </div>
                      {lastExecution && (
                        <div className="text-xs text-white/50 mt-1">
                          {new Date(lastExecution.startedAt).toLocaleTimeString('ko-KR')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'errors' && (
          <div className="space-y-4">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h2 className="text-xl font-semibold text-white mb-4">에러 기록</h2>
              {getErrors().length === 0 ? (
                <div className="text-white/70 text-center py-8">
                  에러가 없습니다 ✨
                </div>
              ) : (
                <div className="space-y-4">
                  {getErrors().map(error => (
                    <div key={error.id} className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-red-400">❌</span>
                          <span className="text-white font-medium">{error.agentName}</span>
                          <span className={`text-xs ${getStatusColor(error.status)}`}>
                            {error.status}
                          </span>
                        </div>
                        <span className="text-white/50 text-sm">
                          {new Date(error.startedAt).toLocaleString('ko-KR')}
                        </span>
                      </div>
                      <div className="text-red-300 text-sm bg-black/20 rounded p-3 font-mono">
                        {error.error?.message || 'Unknown error'}
                      </div>
                      {error.error?.stackTrace && (
                        <details className="mt-2">
                          <summary className="text-white/70 text-sm cursor-pointer hover:text-white">
                            Stack trace
                          </summary>
                          <pre className="text-white/50 text-xs mt-2 overflow-x-auto">
                            {error.error.stackTrace}
                          </pre>
                        </details>
                      )}
                      <button
                        onClick={() => restartAgent(error.agentId)}
                        disabled={reloadingAgents.has(error.agentId)}
                        className="mt-3 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {reloadingAgents.has(error.agentId) ? (
                          <>
                            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12c0 2.209-.794 4.226-2.111 5.832l1.78-1.779A5.974 5.974 0 0010 12c0-1.635-.622-3.129-1.641-4.241l1.78-1.779A7.962 7.962 0 016 12z"></path>
                            </svg>
                            <span>재시작 중...</span>
                          </>
                        ) : (
                          '이 단계부터 재시작'
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'requirement' && (
          <RequirementAnalyzerView
            executions={getAgentExecutions('requirement-analyzer')}
            onRestart={restartAgent}
            reloadingAgents={reloadingAgents}
            onSelectPRD={selectPRD}
            selectedPRDId={selectedPRDId}
            currentViewingPRDId={currentViewingPRDId}
            setCurrentViewingPRDId={setCurrentViewingPRDId}
            currentActivity={currentActivity}
          />
        )}

        {activeTab === 'epic-story' && (
          <EpicStoryView
            executions={getAgentExecutions('epic-story')}
            onRestart={restartAgent}
            reloadingAgents={reloadingAgents}
            projectId={projectId}
            currentActivity={currentActivity}
            onStartDevelopment={startDevelopment}
          />
        )}

        {activeTab === 'development' && (
          <DevelopmentView
            executions={agentExecutions}
            onRestart={restartAgent}
            reloadingAgents={reloadingAgents}
            projectId={projectId}
            currentActivity={currentActivity}
            onStartDevelopment={startDevelopment}
          />
        )}

        {activeTab === 'debugging' && (
          <DebuggingView
            executions={agentExecutions}
            onRestart={restartAgent}
            reloadingAgents={reloadingAgents}
            projectId={projectId}
          />
        )}

        {activeTab === 'feature-addition' && (
          <FeatureAdditionView
            executions={agentExecutions}
            onRestart={restartAgent}
            reloadingAgents={reloadingAgents}
            projectId={projectId}
          />
        )}

        {activeTab !== 'overview' && activeTab !== 'errors' && activeTab !== 'requirement' && activeTab !== 'epic-story' && activeTab !== 'development' && activeTab !== 'debugging' && activeTab !== 'feature-addition' && (
          <AgentDetailView
            agentId={tabs.find(t => t.id === activeTab)?.agentId!}
            agentName={tabs.find(t => t.id === activeTab)?.label!}
            executions={getAgentExecutions(tabs.find(t => t.id === activeTab)?.agentId!)}
            onRestart={restartAgent}
            reloadingAgents={reloadingAgents}
          />
        )}
      </div>

      {/* GitHub 레포지토리 생성 모달 */}
      {showGitHubModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-2xl p-8 max-w-md w-full mx-4 border border-white/20 shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-4">📦 GitHub 레포지토리 생성</h2>
            <p className="text-white/70 mb-6">
              코드를 GitHub에 푸시하기 위해 레포지토리를 생성합니다.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-white/80 text-sm mb-2">레포지토리 이름</label>
                <input
                  type="text"
                  value={repoName}
                  onChange={(e) => {
                    const target = e.target as HTMLInputElement;
                    setRepoName(target.value);
                  }}
                  placeholder="magic-wand-project"
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500"
                />
                <p className="text-white/50 text-xs mt-2">
                  레포지토리는 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowGitHubModal(false)}
                  className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={async () => {
                    if (!repoName.trim()) {
                      alert('레포지토리 이름을 입력해주세요');
                      return;
                    }

                    try {
                      const response = await fetch(`http://localhost:4000/api/magic/github/create-repo/${projectId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ repoName: repoName.trim() }),
                      });

                      if (!response.ok) {
                        const error = await response.json() as ApiErrorResponse;
                        alert(`레포지토리 생성 실패: ${error.error?.message || '알 수 없는 오류'}`);
                        return;
                      }

                      const data = await response.json() as GitHubCreateRepoResponse;
                      setShowGitHubModal(false);
                      alert(`레포지토리가 생성되었습니다!\n${data.repoUrl}`);
                    } catch (error) {
                      console.error('[GitHub Modal] Error:', error);
                      alert('레포지토리 생성 요청 실패');
                    }
                  }}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-amber-500 hover:from-purple-700 hover:to-amber-600 text-white font-semibold rounded-lg transition-all"
                >
                  생성 및 푸시
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function AgentDetailView({
  agentId,
  agentName,
  executions,
  onRestart,
  reloadingAgents,
}: {
  agentId: string;
  agentName: string;
  executions: AgentExecution[];
  onRestart: (agentId: string) => void;
  reloadingAgents: Set<string>;
}) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'text-green-400';
      case 'RUNNING': return 'text-yellow-400';
      case 'FAILED': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">{agentName}</h2>
          {executions.length > 0 && (
            <button
              onClick={() => onRestart(agentId)}
              disabled={reloadingAgents.has(agentId)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {reloadingAgents.has(agentId) ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12c0 2.209-.794 4.226-2.111 5.832l1.78-1.779A5.974 5.974 0 0010 12c0-1.635-.622-3.129-1.641-4.241l1.78-1.779A7.962 7.962 0 016 12z"></path>
                  </svg>
                  <span>재시작 중...</span>
                </>
              ) : (
                '재시작'
              )}
            </button>
          )}
        </div>

        {executions.length === 0 ? (
          <div className="text-white/70 text-center py-8">
            아직 실행되지 않았습니다
          </div>
        ) : (
          <div className="space-y-4">
            {executions.map((execution, idx) => (
              <div key={execution.id} className="bg-black/20 rounded-lg p-4 border border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-white/50 text-sm">#{executions.length - idx}</span>
                    <span className={`font-medium ${getStatusColor(execution.status)}`}>
                      {execution.status}
                    </span>
                  </div>
                  <div className="text-white/50 text-sm">
                    {new Date(execution.startedAt).toLocaleString('ko-KR')}
                  </div>
                </div>

                {execution.status === 'RUNNING' && (
                  <div className="text-yellow-400 text-sm">
                    ⏳ 실행 중입니다...
                  </div>
                )}

                {execution.error && (
                  <div className="mt-3">
                    <div className="text-red-400 text-sm font-medium mb-2">에러:</div>
                    <div className="text-red-300 text-sm bg-red-500/10 rounded p-3 font-mono">
                      {execution.error.message}
                    </div>
                  </div>
                )}

                {execution.output && (
                  <div className="mt-3">
                    <div className="text-green-400 text-sm font-medium mb-2">
                      {execution.agentId === 'requirement-analyzer' && execution.output?.analysisMarkdown
                        ? '요구사항 분석 보고서 (PRD)'
                        : '출력'}
                    </div>

                    {execution.agentId === 'requirement-analyzer' && execution.output?.analysisMarkdown ? (
                      <div className="text-white text-sm bg-white/5 rounded p-4 overflow-x-auto max-h-96 custom-markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({children}) => <h1 className="text-2xl font-bold text-white mb-4 mt-6">{children}</h1>,
                            h2: ({children}) => <h2 className="text-xl font-bold text-white mb-3 mt-5">{children}</h2>,
                            h3: ({children}) => <h3 className="text-lg font-semibold text-white mb-2 mt-4">{children}</h3>,
                            h4: ({children}) => <h4 className="text-base font-semibold text-white mb-2 mt-3">{children}</h4>,
                            p: ({children}) => <p className="text-gray-200 mb-3 leading-relaxed">{children}</p>,
                            ul: ({children}) => <ul className="list-disc list-inside text-gray-200 mb-3 space-y-1">{children}</ul>,
                            ol: ({children}) => <ol className="list-decimal list-inside text-gray-200 mb-3 space-y-1">{children}</ol>,
                            li: ({children}) => <li className="text-gray-200">{children}</li>,
                            code: ({className, children}) => {
                              const isInline = !className;
                              return isInline
                                ? <code className="bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded text-sm">{children}</code>
                                : <code className={className}>{children}</code>;
                            },
                            pre: ({children}) => <pre className="bg-black/30 rounded-lg p-3 mb-3 overflow-x-auto text-sm">{children}</pre>,
                            table: ({children}) => <div className="overflow-x-auto mb-4"><table className="min-w-full border border-white/20 rounded">{children}</table></div>,
                            thead: ({children}) => <thead className="bg-white/10">{children}</thead>,
                            tbody: ({children}) => <tbody className="divide-y divide-white/10">{children}</tbody>,
                            tr: ({children}) => <tr>{children}</tr>,
                            th: ({children}) => <th className="px-4 py-2 text-left text-white font-semibold">{children}</th>,
                            td: ({children}) => <td className="px-4 py-2 text-gray-200">{children}</td>,
                            blockquote: ({children}) => <blockquote className="border-l-4 border-purple-500 pl-4 italic text-gray-300 my-3">{children}</blockquote>,
                            hr: () => <hr className="border-white/20 my-6" />,
                            strong: ({children}) => <strong className="font-bold text-white">{children}</strong>,
                            a: ({href, children}) => <a href={href} className="text-purple-400 hover:text-purple-300 underline">{children}</a>,
                          }}
                        >
                          {execution.output?.analysisMarkdown || 'No analysis available'}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <pre className="text-green-300 text-xs bg-green-500/10 rounded p-3 overflow-x-auto max-h-60">
                        {JSON.stringify(execution.output, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RequirementAnalyzerView({
  executions,
  onRestart,
  reloadingAgents,
  onSelectPRD,
  selectedPRDId,
  currentViewingPRDId,
  setCurrentViewingPRDId,
  currentActivity,
}: {
  executions: AgentExecution[];
  onRestart: (agentId: string) => void;
  reloadingAgents: Set<string>;
  onSelectPRD: (prdId: string) => void;
  selectedPRDId: string | null;
  currentViewingPRDId: string | null;
  setCurrentViewingPRDId: (prdId: string | null) => void;
  currentActivity: {
    activity: string | null;
    agentName: string | null;
    agentId: string | null;
  };
}) {
  const lastExecution = executions[0];

  // PRD 옵션이 있는 경우
  if (lastExecution?.output?.prdOptions && lastExecution.output.prdOptions.length > 0) {
    const prdOptions = lastExecution.output.prdOptions;

    // 현재 보고 있는 PRD
    const viewingPRD = currentViewingPRDId
      ? prdOptions.find((p: any) => p.id === currentViewingPRDId)
      : null;

    return (
      <div className="space-y-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">요구사항 분석 완료 ✨</h2>
            {lastExecution.status === 'COMPLETED' && (
              <span className="text-green-400 text-sm">완료됨</span>
            )}
          </div>

          {/* 현재 전체 PRD 보고 있는 경우 */}
          {viewingPRD ? (
            <div>
              <button
                onClick={() => setCurrentViewingPRDId(null)}
                className="mb-4 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-colors"
              >
                ← PRD 선택으로 돌아가기
              </button>
              <div className="bg-white/5 rounded-lg p-6 border border-white/10">
                <div className="text-white text-sm custom-markdown overflow-x-auto max-h-[600px]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {viewingPRD?.analysisMarkdown || 'No analysis available'}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ) : (
            /* PRD 카드 목록 */
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {prdOptions.map((prd: any) => (
                <div
                  key={prd.id}
                  className={`bg-white/5 rounded-lg p-4 border transition-all ${
                    selectedPRDId === prd.id
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-white/20 hover:border-purple-400'
                  }`}
                >
                  <div className="mb-3">
                    <h3 className="text-lg font-semibold text-white mb-1">{prd.name}</h3>
                    <p className="text-white/70 text-sm">{prd.description}</p>
                  </div>

                  {/* PRD 미리보기 */}
                  <div className="bg-white/5 rounded p-3 mb-3 max-h-48 overflow-y-auto">
                    <div className="text-white/80 text-xs custom-markdown line-clamp-6">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {prd?.analysisMarkdown || 'No analysis available'}
                      </ReactMarkdown>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentViewingPRDId(prd.id)}
                      className="flex-1 px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded text-sm transition-colors"
                    >
                      전체 보기
                    </button>
                    <button
                      onClick={() => onSelectPRD(prd.id)}
                      disabled={!!selectedPRDId}
                      className={`flex-1 px-3 py-2 rounded text-sm transition-colors ${
                        selectedPRDId === prd.id
                          ? 'bg-green-600 text-white cursor-default'
                          : 'bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50'
                      }`}
                    >
                      {selectedPRDId === prd.id ? '✓ 확정됨' : '확정 후 다음 진행'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 이전 버전 호환성 (단일 PRD인 경우)
  return (
    <div className="space-y-4">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">요구사항 분석</h2>
          {lastExecution && (
            <span className={`text-sm ${getStatusColor(lastExecution.status)}`}>
              {lastExecution.status === 'IDLE' ? '대기중' :
               lastExecution.status === 'RUNNING' ? '실행 중' :
               lastExecution.status === 'COMPLETED' ? '완료' : '실패'}
            </span>
          )}
        </div>

        {!lastExecution || lastExecution.status === 'IDLE' ? (
          <div className="text-white/70 text-center py-8">
            아직 실행되지 않았습니다
          </div>
        ) : lastExecution.status === 'RUNNING' ? (
          <div className="text-white/70 text-center py-8">
            <div className="animate-spin inline-block w-8 h-8 border-4 border-white/20 border-t-white rounded-full mb-4"></div>
            <p>요구사항 분석 중...</p>
            {currentActivity.activity && currentActivity.agentId === 'requirement-analyzer' && (
              <div className="mt-4 mx-auto max-w-md">
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
          </div>
        ) : (
          <div className="space-y-4">
            {lastExecution.status === 'FAILED' && lastExecution.error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div className="text-red-300 text-sm">{lastExecution.error.message}</div>
              </div>
            )}

            {lastExecution.output && (
              <div>
                <div className="text-green-400 text-sm font-medium mb-2">
                  {lastExecution.agentId === 'requirement-analyzer' && lastExecution.output?.analysisMarkdown
                    ? '요구사항 분석 보고서 (PRD)'
                    : '출력'}
                </div>

                {lastExecution.agentId === 'requirement-analyzer' && lastExecution.output?.analysisMarkdown ? (
                  <div className="text-white text-sm bg-white/5 rounded p-4 overflow-x-auto max-h-96 custom-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {lastExecution.output?.analysisMarkdown || 'No analysis available'}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <pre className="text-green-300 text-xs bg-green-500/10 rounded p-3 overflow-x-auto max-h-60">
                    {JSON.stringify(lastExecution.output, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  function getStatusColor(status: string) {
    switch (status) {
      case 'COMPLETED': return 'text-green-400';
      case 'RUNNING': return 'text-yellow-400';
      case 'FAILED': return 'text-red-400';
      default: return 'text-gray-400';
    }
  }
}

