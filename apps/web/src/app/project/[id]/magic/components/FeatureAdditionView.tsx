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

interface FeatureAdditionViewProps {
  executions: AgentExecution[];
  onRestart: (agentId: string) => void;
  reloadingAgents: Set<string>;
  projectId: string;
}

export default function FeatureAdditionView({
  executions,
  onRestart,
  reloadingAgents,
  projectId,
}: FeatureAdditionViewProps) {
  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
      <div className="text-center py-16">
        <div className="text-6xl mb-4">➕</div>
        <h2 className="text-2xl font-bold text-white mb-4">기능 추가</h2>
        <p className="text-white/70 mb-8 max-w-2xl mx-auto">
          MVP 배포 후 새로운 기능을 추가하고 싶을 때 사용합니다.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-8">
          <div className="bg-white/5 rounded-lg p-6 border border-white/10">
            <h3 className="text-white font-semibold text-lg mb-3">📝 요구사항 입력</h3>
            <p className="text-white/60 text-sm">
              추가할 기능에 대한 요구사항을 자연어로 입력합니다
            </p>
          </div>

          <div className="bg-white/5 rounded-lg p-6 border border-white/10">
            <h3 className="text-white font-semibold text-lg mb-3">🤖 AI 분석</h3>
            <p className="text-white/60 text-sm">
              AI가 요구사항을 분석하고 구현 방안을 제시합니다
            </p>
          </div>

          <div className="bg-white/5 rounded-lg p-6 border border-white/10">
            <h3 className="text-white font-semibold text-lg mb-3">💻 자동 구현</h3>
            <p className="text-white/60 text-sm">
              AI가 코드를 생성하고 자동으로 적용합니다
            </p>
          </div>

          <div className="bg-white/5 rounded-lg p-6 border border-white/10">
            <h3 className="text-white font-semibold text-lg mb-3">✅ 테스트 및 배포</h3>
            <p className="text-white/60 text-sm">
              자동으로 테스트를 진행하고 배포합니다
            </p>
          </div>
        </div>

        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 max-w-2xl mx-auto">
          <p className="text-yellow-300 text-sm">
            ⚠️ 기능 추가 기능은 현재 개발 중입니다. 곧 제공될 예정입니다.
          </p>
        </div>
      </div>
    </div>
  );
}
