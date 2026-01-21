'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface CollectedData {
  designStyle?: string;
  colorTheme?: string;
  authType?: string;
  requiredPages?: string[];
  databaseTables?: string[];
  externalApis?: string[];
  specialRequests?: string[];
}

export default function SurveyPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [chatState, setChatState] = useState<'in_progress' | 'completed'>('in_progress');
  const [collected, setCollected] = useState<CollectedData>({});
  const [project, setProject] = useState<any>(null);
  const [startingMagic, setStartingMagic] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 초기 채팅 시작
  useEffect(() => {
    // 프로젝트 정보 가져오기
    fetch(`http://localhost:4000/api/projects/${projectId}`)
      .then(res => res.json())
      .then(data => {
        setProject(data.project);
      });

    // 첫 AI 메시지 가져오기
    startChat();
  }, [projectId]);

  // 메시지가 추가될 때마다 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startChat = async () => {
    try {
      const response = await fetch(`http://localhost:4000/api/survey-chat/${projectId}`);
      const data = await response.json();

      setMessages([{
        role: 'assistant',
        content: data.message,
        timestamp: new Date(),
      }]);

      setChatState(data.state);
      setCollected(data.collected || {});
    } catch (error) {
      console.error('Failed to start chat:', error);
    } finally {
      setInitialLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setLoading(true);

    // 사용자 메시지 추가
    const newMessages: Message[] = [
      ...messages,
      {
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
      },
    ];
    setMessages(newMessages);

    try {
      const response = await fetch(`http://localhost:4000/api/survey-chat/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage,
          collected,
        }),
      });

      const data = await response.json();

      // AI 응답 추가
      setMessages([
        ...newMessages,
        {
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
        },
      ]);

      setChatState(data.state);
      setCollected(data.collected || {});
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setLoading(false);
    }
  };

  const startMagic = async () => {
    setStartingMagic(true);

    try {
      // 설문 완료 처리
      await fetch(`http://localhost:4000/api/survey-chat/${projectId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collected }),
      });

      // 마법 시작 페이지로 이동
      router.push(`/project/${projectId}/magic`);
    } catch (error) {
      console.error('Failed to complete survey:', error);
      alert('설문 완료에 실패했습니다');
      setStartingMagic(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!project) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-midnight via-deep-indigo to-midnight flex items-center justify-center">
        <div className="relative">
          <div className="animate-spin w-16 h-16 border-4 border-vivid-purple/30 border-t-vivid-purple rounded-full" />
          <div className="absolute inset-0 animate-pulse bg-vivid-purple/20 rounded-full blur-xl" />
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-midnight via-deep-indigo to-midnight flex flex-col relative overflow-hidden">
      {/* Background Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="mystical-blob absolute top-0 right-1/4 w-[350px] h-[350px] bg-vivid-purple" />
        <div className="mystical-blob absolute bottom-0 left-1/4 w-[300px] h-[300px] bg-dark-magenta" style={{ animationDelay: '3s' }} />
      </div>

      {/* Header */}
      <div className="relative glass-card border-b border-vivid-purple/20 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <h1 className="text-2xl font-display font-bold text-white">{project.name}</h1>
          <div className="flex-1"></div>
          {chatState === 'completed' && (
            <button
              onClick={startMagic}
              disabled={startingMagic}
              className="px-6 py-2.5 bg-gradient-to-r from-vivid-purple to-dark-magenta text-white font-display font-bold rounded-xl hover:shadow-glow-xl transition-all disabled:opacity-50 flex items-center gap-2"
            >
              <span className="text-xl">🪄</span>
              <span>{startingMagic ? '마법 시작 중...' : '마법 시작'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="relative flex-1 overflow-y-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-5">
          {initialLoading && (
            <div className="flex justify-start animate-fade-in">
              <div className="glass-card rounded-2xl px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl animate-float">🪄</span>
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 bg-mystic-violet rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2.5 h-2.5 bg-mystic-violet rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2.5 h-2.5 bg-mystic-violet rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-in`}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-5 py-4 ${
                  message.role === 'user'
                    ? 'bg-gradient-to-r from-vivid-purple to-dark-magenta text-white shadow-glow'
                    : 'glass-card text-white'
                }`}
              >
                <div className="flex items-start gap-3">
                  {message.role === 'assistant' && (
                    <span className="text-3xl flex-shrink-0">🪄</span>
                  )}
                  <div className="flex-1 min-w-0">
                    {message.role === 'assistant' ? (
                      <div className="custom-markdown prose prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    )}
                    <p className="text-xs text-mystic-violet/60 mt-3 font-mono">
                      {new Date(message.timestamp).toLocaleTimeString('ko-KR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {loading && !initialLoading && (
            <div className="flex justify-start animate-fade-in">
              <div className="glass-card rounded-2xl px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl animate-float">🪄</span>
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 bg-mystic-violet rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2.5 h-2.5 bg-mystic-violet rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2.5 h-2.5 bg-mystic-violet rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      {chatState === 'in_progress' && (
        <div className="relative glass-card border-t border-vivid-purple/20 px-4 py-5">
          <div className="max-w-4xl mx-auto">
            <div className="flex gap-3">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="응답을 입력하세요... (Enter로 전송, Shift+Enter로 줄바꿈)"
                disabled={loading}
                className="flex-1 px-5 py-4 rounded-xl bg-black/30 border border-vivid-purple/20 text-white placeholder-white/40 focus:outline-none focus:border-vivid-purple/50 focus:ring-2 focus:ring-vivid-purple/30 focus:shadow-inner-glow resize-none transition-all"
                rows={1}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="px-8 py-4 bg-gradient-to-r from-vivid-purple to-dark-magenta text-white font-display font-bold rounded-xl hover:shadow-glow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <span>전송</span>
                <span className="text-lg">→</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 마법 시작 버튼 (Backdrop 오버레이) */}
      {chatState === 'completed' && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in">
          <div className="glass-card rounded-3xl p-10 max-w-lg w-full mx-4 shadow-glow-xl animate-scale-in">
            <div className="text-center">
              <div className="relative inline-block mb-6">
                <div className="text-7xl animate-float">✨</div>
                <div className="absolute inset-0 blur-2xl bg-vivid-purple/30 rounded-full animate-pulse-glow" />
              </div>
              <h2 className="text-3xl font-display font-bold text-white mb-4">
                마법을 시작할 준비가 되었습니다!
              </h2>
              <p className="text-mystic-violet/90 text-lg mb-8">
                수집된 요구사항을 바탕으로 AI가 자동으로 프로젝트를 생성합니다.
              </p>

              {/* 수집된 정보 요약 */}
              <div className="bg-black/40 border border-vivid-purple/20 rounded-xl p-5 mb-8 text-left">
                <h3 className="text-white font-display font-semibold mb-3 text-lg">수집된 정보:</h3>
                <div className="space-y-2 text-sm text-soft-lavender/90">
                  {collected.designStyle && <div className="flex items-center gap-2"><span className="text-vivid-purple">•</span> 디자인: {collected.designStyle}</div>}
                  {collected.colorTheme && <div className="flex items-center gap-2"><span className="text-vivid-purple">•</span> 색상: {collected.colorTheme}</div>}
                  {collected.authType && <div className="flex items-center gap-2"><span className="text-vivid-purple">•</span> 인증: {collected.authType}</div>}
                  {collected.requiredPages && (
                    <div className="flex items-center gap-2"><span className="text-vivid-purple">•</span> 페이지: {Array.isArray(collected.requiredPages) ? collected.requiredPages.join(', ') : collected.requiredPages}</div>
                  )}
                  {collected.databaseTables && (
                    <div className="flex items-center gap-2"><span className="text-vivid-purple">•</span> 데이터: {Array.isArray(collected.databaseTables) ? collected.databaseTables.join(', ') : collected.databaseTables}</div>
                  )}
                </div>
              </div>

              <button
                onClick={startMagic}
                disabled={startingMagic}
                className="w-full relative overflow-hidden px-8 py-5 bg-gradient-to-r from-vivid-purple to-dark-magenta text-white font-display font-bold text-xl rounded-xl hover:shadow-glow-xl transition-all disabled:opacity-50 group"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                <span className="relative">
                  {startingMagic ? (
                    <span className="flex items-center justify-center gap-3">
                      <div className="animate-spin w-6 h-6 border-3 border-white border-t-transparent rounded-full" />
                      <span>마법 시작 중...</span>
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <span className="text-2xl">🪄</span>
                      <span>마법 시작!</span>
                    </span>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
