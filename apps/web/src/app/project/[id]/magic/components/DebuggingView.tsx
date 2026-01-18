'use client';

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

interface DebuggingViewProps {
  executions: AgentExecution[];
  onRestart: (agentId: string) => void;
  reloadingAgents: Set<string>;
  projectId: string;
}

export default function DebuggingView({
  executions,
  onRestart,
  reloadingAgents,
  projectId,
}: DebuggingViewProps) {
  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
      <div className="text-center py-16">
        <div className="text-6xl mb-4">🐛</div>
        <h2 className="text-2xl font-bold text-white mb-4">디버깅</h2>
        <p className="text-white/70 mb-8 max-w-2xl mx-auto">
          개발 과정에서 발생한 이슈를 디버깅하고 해결합니다.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-8">
          <div className="bg-white/5 rounded-lg p-6 border border-white/10">
            <h3 className="text-white font-semibold text-lg mb-3">📋 이슈 목록</h3>
            <p className="text-white/60 text-sm">
              발생한 에러와 경고를 확인하고 관리합니다
            </p>
          </div>

          <div className="bg-white/5 rounded-lg p-6 border border-white/10">
            <h3 className="text-white font-semibold text-lg mb-3">🔍 원인 분석</h3>
            <p className="text-white/60 text-sm">
              AI가 이슈의 원인을 분석하고 해결 방안을 제안합니다
            </p>
          </div>

          <div className="bg-white/5 rounded-lg p-6 border border-white/10">
            <h3 className="text-white font-semibold text-lg mb-3">🛠️ 자동 수정</h3>
            <p className="text-white/60 text-sm">
              간단한 이슈는 AI가 자동으로 수정합니다
            </p>
          </div>

          <div className="bg-white/5 rounded-lg p-6 border border-white/10">
            <h3 className="text-white font-semibold text-lg mb-3">✅ 수정 확인</h3>
            <p className="text-white/60 text-sm">
              수정 후 테스트를 통해 정상 동작을 확인합니다
            </p>
          </div>
        </div>

        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 max-w-2xl mx-auto">
          <p className="text-yellow-300 text-sm">
            ⚠️ 디버깅 기능은 현재 개발 중입니다. 곧 제공될 예정입니다.
          </p>
        </div>
      </div>
    </div>
  );
}
