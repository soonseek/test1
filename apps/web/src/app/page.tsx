'use client';

import { useState, useEffect } from 'react';
import HeroSection from '@/components/HeroSection';
import ProjectCard from '@/components/ProjectCard';
import ProjectCardSkeleton from '@/components/ProjectCardSkeleton';
import { Bot, Rocket, Wrench } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  statusMessage: string;
  createdAt: string;
  filesCount: number;
  executionsCount: number;
  deployment: {
    status: string;
    githubRepoUrl: string;
    netlifyUrl: string;
  } | null;
}

interface UploadedFile {
  s3Key: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await fetch('http://localhost:4000/api/projects');
      const data = await response.json();
      setProjects(data.projects || []);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async (prompt: string, files: UploadedFile[]) => {
    const response = await fetch('http://localhost:4000/api/projects/from-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        files,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      alert(`오류: ${error.error?.message || '프로젝트 생성 실패'}`);
      throw new Error('Project creation failed');
    }

    const data = await response.json();

    // 파일 업로드 완료 처리
    if (files.length > 0) {
      for (const file of files) {
        try {
          await fetch('http://localhost:4000/api/upload/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: data.project.id,
              s3Key: file.s3Key,
              fileName: file.fileName,
              fileType: file.fileType,
              fileSize: file.fileSize,
              description: prompt,
              parseDocument: true,
            }),
          });
        } catch (error) {
          console.error('Failed to complete file upload:', error);
        }
      }
    }

    // Redirect to survey page
    window.location.href = `/project/${data.project.id}/survey`;
  };

  const archiveProject = async (projectId: string, projectName: string) => {
    if (!confirm(`${projectName} 프로젝트를 아카이브하시겠습니까?`)) {
      return;
    }

    try {
      const response = await fetch(`http://localhost:4000/api/projects/${projectId}/archive`, {
        method: 'PATCH',
      });

      if (!response.ok) {
        alert('아카이브 실패');
        return;
      }

      await fetchProjects();
    } catch (error) {
      console.error('Failed to archive project:', error);
      alert('아카이브 실패');
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-midnight via-deep-indigo to-midnight relative overflow-hidden">
      {/* Mystical Background Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="mystical-blob absolute top-0 left-1/4 w-[500px] h-[500px] bg-vivid-purple" />
        <div className="mystical-blob absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-dark-magenta" style={{ animationDelay: '2s' }} />
        <div className="mystical-blob absolute top-1/2 left-1/2 w-[300px] h-[300px] bg-deep-indigo" style={{ animationDelay: '4s' }} />
      </div>

      <div className="relative max-w-7xl mx-auto space-y-16 md:space-y-24 py-12 md:py-20 px-4">
        {/* Hero Section */}
        <HeroSection onCreateProject={handleCreateProject} />

        {/* Projects List */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-4xl font-display font-bold text-white">
              내 프로젝트 {projects.length > 0 && <span className="text-mystic-violet font-normal">({projects.length})</span>}
            </h2>
            <button
              onClick={fetchProjects}
              className="px-5 py-2.5 glass-card hover:bg-white/10 text-white rounded-xl text-sm font-medium transition-all hover:shadow-glow flex items-center gap-2 group"
            >
              <span className="text-lg group-hover:rotate-180 transition-transform duration-500">🔄</span>
              <span>새로고침</span>
            </button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
                  <ProjectCardSkeleton />
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="glass-card rounded-2xl p-20 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-vivid-purple/5 to-transparent pointer-events-none" />
              <div className="relative">
                <div className="text-8xl mb-8 opacity-40 animate-float">📁</div>
                <h3 className="text-3xl font-display font-bold text-white mb-4">
                  아직 프로젝트가 없습니다
                </h3>
                <p className="text-mystic-violet text-lg max-w-md mx-auto">
                  위 프롬프트 입력창에 아이디어를 적어보세요!
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((project, index) => (
                <div
                  key={project.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <ProjectCard project={project} onArchive={archiveProject} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8">
          <div className="glass-card rounded-2xl p-8 text-center group hover:shadow-glow-lg transition-all relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-vivid-purple/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="w-20 h-20 mx-auto mb-5 bg-vivid-purple/20 rounded-2xl flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300">
                <Bot className="w-10 h-10 text-mystic-violet" />
              </div>
              <h3 className="text-2xl font-display font-bold text-white mb-3">AI 생성</h3>
              <p className="text-sm text-soft-lavender/80 leading-relaxed">
                Claude AI가 요구사항을 분석하여 자동으로 코드를 생성합니다
              </p>
            </div>
          </div>
          <div className="glass-card rounded-2xl p-8 text-center group hover:shadow-glow-lg transition-all relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-dark-magenta/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="w-20 h-20 mx-auto mb-5 bg-dark-magenta/20 rounded-2xl flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300">
                <Rocket className="w-10 h-10 text-mystic-violet" />
              </div>
              <h3 className="text-2xl font-display font-bold text-white mb-3">빠른 배포</h3>
              <p className="text-sm text-soft-lavender/80 leading-relaxed">
                GitHub & Netlify 자동 연동으로 클릭 한 번으로 배포합니다
              </p>
            </div>
          </div>
          <div className="glass-card rounded-2xl p-8 text-center group hover:shadow-glow-lg transition-all relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-deep-indigo/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="w-20 h-20 mx-auto mb-5 bg-deep-indigo/20 rounded-2xl flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300">
                <Wrench className="w-10 h-10 text-mystic-violet" />
              </div>
              <h3 className="text-2xl font-display font-bold text-white mb-3">자동 수정</h3>
              <p className="text-sm text-soft-lavender/80 leading-relaxed">
                발생한 이슈를 AI가 자동으로 감지하고 수정합니다
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
