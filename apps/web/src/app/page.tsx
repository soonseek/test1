'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-purple-900 via-purple-800 to-amber-600">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="text-6xl mb-4">🪄</div>
          <h1 className="text-4xl font-bold text-white mb-2">
            MAGIC WAND
          </h1>
          <p className="text-purple-200">
            프리랜서 웹 개발자를 위한 MVP 자동 생성 플랫폼
          </p>
        </div>

        {/* Card */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20 space-y-4">
          <h2 className="text-xl font-semibold text-white text-center">
            새로운 프로젝트를 시작합니다
          </h2>

          <Link href="/project/new">
            <button className="w-full bg-gradient-to-r from-purple-600 to-amber-500 text-white font-semibold py-3 px-6 rounded-lg hover:from-purple-700 hover:to-amber-600 transition-all duration-200 magic-glow">
              새 프로젝트 만들기 ✨
            </button>
          </Link>

          <p className="text-sm text-purple-200 text-center">
            프로젝트 정보를 입력하고 설문조사를 완료하면<br/>
            AI가 MVP를 자동으로 생성합니다
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl mb-1">🤖</div>
            <p className="text-xs text-purple-200">AI 생성</p>
          </div>
          <div className="text-center">
            <div className="text-2xl mb-1">⚡</div>
            <p className="text-xs text-purple-200">빠른 배포</p>
          </div>
          <div className="text-center">
            <div className="text-2xl mb-1">🔧</div>
            <p className="text-xs text-purple-200">자동 수정</p>
          </div>
        </div>
      </div>
    </main>
  );
}
