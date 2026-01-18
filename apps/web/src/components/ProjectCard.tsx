'use client';

import Link from 'next/link';
import { MoreVertical, FileText, Zap } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

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

interface ProjectCardProps {
  project: Project;
  onArchive: (projectId: string, projectName: string) => void;
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'deployed':
      return 'border-green-500/50 text-green-400';
    case 'running':
      return 'border-yellow-500/50 text-yellow-400';
    case 'completed':
      return 'border-blue-500/50 text-blue-400';
    case 'failed':
      return 'border-red-500/50 text-red-400';
    case 'ready':
      return 'border-purple-500/50 text-purple-400';
    default:
      return 'border-gray-500/50 text-gray-400';
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'deployed':
      return '🚀';
    case 'running':
      return '⚡';
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    case 'ready':
      return '⏳';
    default:
      return '📋';
  }
};

export default function ProjectCard({ project, onArchive }: ProjectCardProps) {
  const isPulsing = project.status === 'running';

  return (
    <div className="relative group">
      <Link href={`/project/${project.id}/magic`} className="block">
        <div className="glass-card glass-card-hover rounded-2xl p-6 h-full transition-all duration-300">
          {/* Header with Status */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {isPulsing && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                </span>
              )}
              <span
                className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(
                  project.status
                )}`}
              >
                {getStatusIcon(project.status)} {project.statusMessage}
              </span>
            </div>
            <span className="text-violet-muted/60 text-xs">
              {new Date(project.createdAt).toLocaleDateString('ko-KR')}
            </span>
          </div>

          {/* Project Info */}
          <h3 className="text-xl font-display font-bold text-white mb-2 line-clamp-1 group-hover:text-mystic-violet transition-colors">
            {project.name}
          </h3>
          <p className="text-soft-lavender/70 text-sm mb-4 line-clamp-2 leading-relaxed">
            {project.description}
          </p>

          {/* Stats */}
          <div className="flex items-center gap-3 text-sm text-mystic-violet/80 mb-4">
            <div className="flex items-center gap-1.5 bg-black/30 rounded-lg px-3 py-1.5 border border-vivid-purple/10 hover:border-vivid-purple/30 transition-colors">
              <FileText size={14} className="text-vivid-purple" />
              <span className="font-medium">{project.filesCount}</span>
            </div>
            <div className="flex items-center gap-1.5 bg-black/30 rounded-lg px-3 py-1.5 border border-vivid-purple/10 hover:border-vivid-purple/30 transition-colors">
              <Zap size={14} className="text-dark-magenta" />
              <span className="font-medium">{project.executionsCount}</span>
            </div>
          </div>

          {/* Deployment Info */}
          {project.deployment && (
            <div className="space-y-1.5 text-xs pt-3 border-t border-vivid-purple/10">
              {project.deployment.githubRepoUrl && (
                <div className="text-mystic-violet/80 truncate flex items-center gap-1.5 hover:text-vivid-purple transition-colors">
                  <span className="text-vivid-purple/60 flex-shrink-0">🔗</span>
                  <span className="truncate font-mono">{project.deployment.githubRepoUrl.replace('https://github.com/', '')}</span>
                </div>
              )}
              {project.deployment.netlifyUrl && (
                <div className="text-mystic-violet/80 truncate flex items-center gap-1.5 hover:text-vivid-purple transition-colors">
                  <span className="text-vivid-purple/60 flex-shrink-0">🚀</span>
                  <span className="truncate font-mono">{project.deployment.netlifyUrl.replace('https://', '')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </Link>

      {/* Menu Button */}
      <div className="absolute top-4 right-4">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              onClick={(e) => e.preventDefault()}
              className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
              title="프로젝트 관리"
            >
              <MoreVertical size={18} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="glass-card rounded-xl shadow-card min-w-[160px] p-1 z-50"
              sideOffset={5}
            >
              <DropdownMenu.Item
                className="px-4 py-2.5 text-sm text-white hover:bg-white/10 rounded-lg cursor-pointer outline-none transition-colors flex items-center gap-2"
                onSelect={(e) => {
                  e.preventDefault();
                  onArchive(project.id, project.name);
                }}
              >
                <span>📦</span>
                <span>아카이브</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}