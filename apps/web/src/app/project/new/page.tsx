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
    <main className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-amber-600 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="pt-8 pb-4">
          <Link href="/">
            <button className="text-white/70 hover:text-white mb-4 inline-block">
              ← 뒤로가기
            </button>
          </Link>
          <h1 className="text-3xl font-bold text-white mb-2">
            새 프로젝트 만들기
          </h1>
          <p className="text-purple-200">
            프로젝트 정보를 입력하세요
          </p>
        </div>

        {/* Form */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 프로젝트명 */}
            <div>
              <label className="block text-white font-medium mb-2">
                프로젝트명 *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="예: 포트폴리오 사이트"
              />
            </div>

            {/* 설명 */}
            <div>
              <label className="block text-white font-medium mb-2">
                프로젝트 설명 *
              </label>
              <textarea
                required
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[100px]"
                placeholder="이 프로젝트에 대해 간단히 설명해주세요"
              />
            </div>

            {/* 마법사 레벨 */}
            <div>
              <label className="block text-white font-medium mb-2">
                마법사 레벨 *
              </label>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { value: 'APPRENTICE', label: '인턴 마법사', desc: '템플릿 기반' },
                  { value: 'SKILLED', label: '숙련자 마법사', desc: '50% 커스터마이징' },
                  { value: 'ARCHMAGE', label: '대마법사', desc: '완전 자유' },
                ].map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, wizardLevel: level.value as any })}
                    className={`p-4 rounded-lg border-2 text-left transition-all ${
                      formData.wizardLevel === level.value
                        ? 'border-purple-500 bg-purple-500/20 text-white'
                        : 'border-white/30 text-white/70 hover:border-white/50'
                    }`}
                  >
                    <div className="font-medium">{level.label}</div>
                    <div className="text-xs opacity-80 mt-1">{level.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 버튼들 */}
            <div className="flex gap-4 pt-4">
              <Link href="/" className="flex-1 px-6 py-3 rounded-lg border border-white/30 text-white text-center hover:bg-white/10">
                취소
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-gradient-to-r from-purple-600 to-amber-500 text-white font-semibold py-3 px-6 rounded-lg hover:from-purple-700 hover:to-amber-600 transition-all disabled:opacity-50"
              >
                {loading ? '처리 중...' : '다음 →'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
