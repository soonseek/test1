'use client';

import { useState, useRef, KeyboardEvent, DragEvent } from 'react';
import { Upload, Sparkles, X } from 'lucide-react';

interface UploadedFile {
  s3Key: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface HeroSectionProps {
  onCreateProject: (prompt: string, files: UploadedFile[]) => Promise<void>;
}

export default function HeroSection({ onCreateProject }: HeroSectionProps) {
  const [prompt, setPrompt] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const file = files[0];
    setUploadingFile(true);

    try {
      const presignedResponse = await fetch('http://localhost:4000/api/upload/presigned-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
        }),
      });

      if (!presignedResponse.ok) {
        throw new Error('Failed to get presigned URL');
      }

      const { presignedUrl, fileKey } = await presignedResponse.json();

      await fetch(presignedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      setUploadedFiles([
        ...uploadedFiles,
        {
          s3Key: fileKey,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        },
      ]);
    } catch (error) {
      console.error('File upload error:', error);
      alert('파일 업로드 실패');
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const removeFile = (index: number) => {
    setUploadedFiles(uploadedFiles.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      alert('프롬프트를 입력해주세요');
      return;
    }

    setCreatingProject(true);
    try {
      await onCreateProject(prompt, uploadedFiles);
      setPrompt('');
      setUploadedFiles([]);
    } catch (error) {
      console.error('Project creation error:', error);
    } finally {
      setCreatingProject(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSubmit();
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8 animate-scale-in">
      {/* Header */}
      <div className="text-center space-y-5">
        <div className="relative inline-block">
          <div className="text-8xl mb-6 animate-float">🪄</div>
          <div className="absolute inset-0 blur-2xl bg-vivid-purple/20 rounded-full animate-pulse-glow -z-10" />
        </div>
        <h1 className="text-6xl md:text-7xl font-display font-bold text-white mb-4 tracking-tight">
          MAGIC WAND
        </h1>
        <p className="text-xl md:text-2xl text-mystic-violet font-light">
          모두를 위한 MVP 자동 생성 플랫폼
        </p>
      </div>

      {/* Interactive Prompt Input */}
      <div
        className="relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div
          className={`gradient-border-animated rounded-2xl p-[2px] transition-all duration-300 ${
            isDragging ? 'scale-[1.02] shadow-glow-lg' : ''
          }`}
        >
          <div className="glass-card rounded-2xl p-8 space-y-6">
            {/* Prompt Textarea */}
            <div className="space-y-3">
              <label className="block text-white font-display font-semibold text-lg">
                만들고 싶은 것을 자유롭게 적어주세요 ✨
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="예: 포트폴리오 사이트를 만들고 싶어. 프로젝트 목록과 각 프로젝트의 상세 페이지, 그리고 소개 페이지가 필요해."
                className="w-full px-6 py-4 rounded-xl bg-black/30 border border-vivid-purple/20 text-white placeholder-white/40 focus:outline-none focus:border-vivid-purple/50 focus:ring-2 focus:ring-vivid-purple/30 focus:shadow-inner-glow min-h-[140px] resize-none text-base transition-all duration-200"
                disabled={creatingProject}
              />
              <div className="flex items-center justify-between text-sm">
                <span className="text-mystic-violet/80 flex items-center gap-1.5">
                  <span className="text-base">💡</span>
                  <span>Ctrl+Enter 또는 Cmd+Enter로 빠르게 생성</span>
                </span>
                <span className="text-mystic-violet/60 font-mono text-xs">{prompt.length} 자</span>
              </div>
            </div>

            {/* Uploaded Files */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                {uploadedFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between bg-black/30 rounded-lg px-4 py-3 border border-vivid-purple/10 animate-slide-in group hover:border-vivid-purple/30 hover:bg-black/40 transition-all"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="text-mystic-violet flex-shrink-0">📎</span>
                      <span className="text-white text-sm truncate">
                        {file.fileName}
                      </span>
                      <span className="text-mystic-violet/60 text-xs font-mono flex-shrink-0">
                        {(file.fileSize / 1024).toFixed(1)}KB
                      </span>
                    </div>
                    <button
                      onClick={() => removeFile(index)}
                      className="p-1 text-white/40 hover:text-red-400 hover:bg-red-400/10 rounded transition-all"
                      disabled={creatingProject}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Drag & Drop Hint */}
              {isDragging && (
              <div className="absolute inset-0 bg-vivid-purple/10 border-2 border-dashed border-vivid-purple rounded-2xl flex items-center justify-center backdrop-blur-sm z-10">
                <div className="text-center">
                  <Upload className="w-14 h-14 text-mystic-violet mx-auto mb-3 animate-bounce" />
                  <p className="text-white font-display font-semibold text-lg">파일을 여기에 놓으세요</p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => handleFileSelect(e.target.files)}
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                disabled={creatingProject}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile || creatingProject}
                className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 border border-vivid-purple/20 hover:border-vivid-purple/40 hover:shadow-glow"
              >
                {uploadingFile ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    <span>업로드 중...</span>
                  </>
                ) : (
                  <>
                    <Upload size={18} />
                    <span>파일 첨부</span>
                  </>
                )}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!prompt.trim() || creatingProject}
                className="flex-1 relative overflow-hidden bg-gradient-to-r from-vivid-purple to-dark-magenta text-white font-display font-bold py-3 px-6 rounded-xl hover:shadow-glow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                {creatingProject ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    <span>생성 중...</span>
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Sparkles size={18} />
                    <span>프로젝트 생성</span>
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}