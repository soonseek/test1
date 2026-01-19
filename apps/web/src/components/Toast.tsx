'use client';

import React, { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

const ToastItem: React.FC<ToastProps> = ({ toast, onRemove }) => {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const duration = toast.duration || 5000;
    const interval = 50;
    const step = 100 / (duration / interval);

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev <= step) {
          clearInterval(timer);
          onRemove(toast.id);
          return 0;
        }
        return prev - step;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [toast.id, toast.duration, onRemove]);

  const bgColor = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-blue-600',
    warning: 'bg-yellow-600',
  }[toast.type];

  const icon = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠',
  }[toast.type];

  return (
    <div
      className={`${bgColor} text-white px-6 py-4 rounded-lg shadow-lg flex items-start gap-3 min-w-[320px] max-w-md relative overflow-hidden transition-all duration-300`}
    >
      <span className="text-xl flex-shrink-0">{icon}</span>
      <p className="flex-1 text-sm font-medium whitespace-pre-wrap">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 hover:opacity-70 transition-opacity"
      >
        ✕
      </button>
      <div
        className={`absolute bottom-0 left-0 h-1 bg-white/30 transition-all duration-${toast.duration || 5000}`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
};
