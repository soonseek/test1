'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function NewProjectPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    wizardLevel: 'APPRENTICE' as 'APPRENTICE' | 'SKILLED' | 'ARCHMAGE',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 프로젝트 생성
      const response = await fetch('http://localhost:4000/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        alert(`오류: ${error.error?.message || '프로젝트 생성 실패'}`);
        return;
      }

      const data = await response.json();
      const projectId = data.project.id;

      // 설문조사 페이지로 이동
      router.push(`/project/${projectId}/survey`);
    } catch (error) {
      alert(`오류: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-midnight via-deep-indigo to-midnight relative overflow-hidden">
      {/* Background Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="mystical-blob absolute top-0 left-1/3 w-[400px] h-[400px] bg-vivid-purple" />
        <div className="mystical-blob absolute bottom-0 right-1/3 w-[350px] h-[350px] bg-dark-magenta" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="pt-8 pb-6">
          <Link href="/">
            <button className="text-mystic-violet hover:text-white mb-6 inline-flex items-center gap-2 group transition-colors">
              <span className="group-hover:-translate-x-1 transition-transform">←</span>
              <span>뒤로가기</span>
            </button>
          </Link>
          <h1 className="text-4xl md:text-5xl font-display font-bold text-white mb-3">
            새 프로젝트 만들기
          </h1>
          <p className="text-xl text-mystic-violet">
            프로젝트 정보를 입력하세요
          </p>
        </div>

        {/* Form */}
        <div className="glass-card rounded-2xl p-8 animate-scale-in">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 프로젝트명 */}
            <div>
              <label className="block text-white font-display font-semibold mb-3 text-lg">
                프로젝트명 *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-5 py-4 rounded-xl bg-black/30 border border-vivid-purple/20 text-white placeholder-white/40 focus:outline-none focus:border-vivid-purple/50 focus:ring-2 focus:ring-vivid-purple/30 focus:shadow-inner-glow transition-all"
                placeholder="예: 포트폴리오 사이트"
              />
            </div>

            {/* 설명 */}
            <div>
              <label className="block text-white font-display font-semibold mb-3 text-lg">
                프로젝트 설명 *
              </label>
              <textarea
                required
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-5 py-4 rounded-xl bg-black/30 border border-vivid-purple/20 text-white placeholder-white/40 focus:outline-none focus:border-vivid-purple/50 focus:ring-2 focus:ring-vivid-purple/30 focus:shadow-inner-glow min-h-[120px] resize-none transition-all"
                placeholder="이 프로젝트에 대해 간단히 설명해주세요"
              />
            </div>

            {/* 마법사 레벨 */}
            <div>
              <label className="block text-white font-display font-semibold mb-3 text-lg">
                마법사 레벨 *
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { value: 'APPRENTICE', label: '인턴 마법사', desc: '템플릿 기반', icon: '🧙‍♂️' },
                  { value: 'SKILLED', label: '숙련자 마법사', desc: '50% 커스터마이징', icon: '🧙' },
                  { value: 'ARCHMAGE', label: '대마법사', desc: '완전 자유', icon: '🧙‍♀️' },
                ].map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, wizardLevel: level.value as any })}
                    className={`p-5 rounded-xl border-2 text-left transition-all group ${
                      formData.wizardLevel === level.value
                        ? 'border-vivid-purple bg-vivid-purple/20 text-white shadow-glow'
                        : 'border-vivid-purple/20 text-white/70 hover:border-vivid-purple/40 hover:bg-black/20'
                    }`}
                  >
                    <div className="text-3xl mb-2 group-hover:scale-110 transition-transform">{level.icon}</div>
                    <div className="font-display font-semibold text-base mb-1">{level.label}</div>
                    <div className="text-xs text-mystic-violet/80">{level.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 버튼들 */}
            <div className="flex gap-4 pt-6">
              <Link href="/" className="flex-1 px-6 py-4 rounded-xl border-2 border-vivid-purple/30 text-white text-center font-display font-semibold hover:bg-white/10 hover:border-vivid-purple/50 transition-all">
                취소
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 relative overflow-hidden bg-gradient-to-r from-vivid-purple to-dark-magenta text-white font-display font-bold py-4 px-6 rounded-xl hover:shadow-glow-xl transition-all disabled:opacity-50 group"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                <span className="relative">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                      <span>처리 중...</span>
                    </span>
                  ) : (
                    '다음 →'
                  )}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
