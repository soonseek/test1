'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

export default function SurveyPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [loading, setLoading] = useState(false);
  const [surveySchema, setSurveySchema] = useState<any>(null);
  const [answers, setAnswers] = useState<any>({});
  const [project, setProject] = useState<any>(null);

  useEffect(() => {
    // 설문조스키마 가져오기
    fetch(`http://localhost:4000/api/survey/start?projectId=${projectId}&wizardLevel=SKILLED`)
      .then(res => res.json())
      .then(data => {
        setSurveySchema(data.surveySchema);
      });

    // 프로젝트 정보 가져오기
    fetch(`http://localhost:4000/api/projects/${projectId}`)
      .then(res => res.json())
      .then(data => {
        setProject(data.project);
      });
  }, [projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 임시 저장
      await fetch(`http://localhost:4000/api/survey/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answers),
      });

      // 제출
      const response = await fetch(`http://localhost:4000/api/survey/${projectId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...answers,
          answers,
          wizardLevel: project?.wizardLevel,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        alert(`오류: ${error.error?.message || '설문조사 제출 실패'}`);
        return;
      }

      // 마법 시작 페이지로 이동
      router.push(`/project/${projectId}/magic`);
    } catch (error) {
      alert(`오류: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  if (!surveySchema || !project) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-amber-600 flex items-center justify-center p-4">
        <div className="text-white text-center">로딩 중...</div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-amber-600 p-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="pt-8 pb-4">
          <Link href="/">
            <button className="text-white/70 hover:text-white mb-4 inline-block">
              ← 뒤로가기
            </button>
          </Link>
          <h1 className="text-3xl font-bold text-white mb-2">
            {project.name}
          </h1>
          <p className="text-purple-200">
            {project.wizardLevel} 마법사 레벨
          </p>
        </div>

        {/* Survey */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
          <form onSubmit={handleSubmit} className="space-y-8">
            {surveySchema.sections?.map((section: any, sectionIdx: number) => (
              <div key={sectionIdx} className="space-y-4">
                <h2 className="text-xl font-semibold text-white">
                  {section.title}
                </h2>

                {section.questions?.map((question: any, questionIdx: number) => (
                  <div key={questionIdx}>
                    <label className="block text-white font-medium mb-2">
                      {question.label}
                      {question.required && <span className="text-red-400"> *</span>}
                    </label>

                    {/* 라디오 버튼 */}
                    {question.type === 'radio' && question.options && (
                      <div className="space-y-2">
                        {question.options.map((option: any, optIdx: number) => (
                          <label key={optIdx} className="flex items-center gap-3 p-3 rounded-lg bg-white/10 border border-white/20 hover:bg-white/20 cursor-pointer">
                            <input
                              type="radio"
                              name={`q-${sectionIdx}-${questionIdx}`}
                              required
                              value={option.value}
                              checked={answers[question.id] === option.value}
                              onChange={(e) => {
                                setAnswers({
                                  ...answers,
                                  [question.id]: e.target.value,
                                });
                              }}
                              className="w-4 h-4"
                            />
                            <span className="text-white">{option.label}</span>
                          </label>
                        ))}
                      </div>
                    )}

                    {/* 텍스트 입력 */}
                    {question.type === 'text' && (
                      <input
                        type="text"
                        required={question.required}
                        placeholder={question.placeholder}
                        onChange={(e) => {
                          setAnswers({
                            ...answers,
                            [question.id]: e.target.value,
                          });
                        }}
                        className="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    )}

                    {/* 텍스트에리어 */}
                    {question.type === 'textarea' && (
                      <textarea
                        required={question.required}
                        placeholder={question.placeholder}
                        rows={3}
                        onChange={(e) => {
                          setAnswers({
                            ...answers,
                            [question.id]: e.target.value,
                          });
                        }}
                        className="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[100px]"
                      />
                    )}

                    {/* 멀티셀렉트 */}
                    {question.type === 'multiselect' && question.options && (
                      <div className="space-y-2">
                        {question.options.map((option: any, optIdx: number) => (
                          <label key={optIdx} className="flex items-center gap-3 p-3 rounded-lg bg-white/10 border border-white/20 hover:bg-white/20 cursor-pointer">
                            <input
                              type="checkbox"
                              value={option.value}
                              onChange={(e) => {
                                const current = answers[question.id] || [];
                                if (e.target.checked) {
                                  setAnswers({
                                    ...answers,
                                    [question.id]: [...current, option.value],
                                  });
                                } else {
                                  setAnswers({
                                    ...answers,
                                    [question.id]: current.filter((v: string) => v !== option.value),
                                  });
                                }
                              }}
                              className="w-4 h-4"
                            />
                            <span className="text-white">{option.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {/* 버튼들 */}
            <div className="flex gap-4 pt-4 border-t border-white/20">
              <Link href="/" className="flex-1 px-6 py-3 rounded-lg border border-white/30 text-white text-center hover:bg-white/10">
                취소
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-gradient-to-r from-purple-600 to-amber-500 text-white font-semibold py-3 px-6 rounded-lg hover:from-purple-700 hover:to-amber-600 transition-all disabled:opacity-50"
              >
                {loading ? '제출 중...' : '마법 시작 🪄'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
