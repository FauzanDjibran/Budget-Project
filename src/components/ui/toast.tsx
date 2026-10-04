"use client";

import { createContext, useCallback, useContext, useState } from "react";

type Toast = { id: number; title: string; body?: string; kind?: "ok" | "err" };

const ToastContext = createContext<
  (title: string, body?: string, kind?: "ok" | "err") => void
>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((title: string, body?: string, kind?: "ok" | "err") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, title, body, kind }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* A live region, so a result that only ever appears here — saved,
          refused — is read out rather than seen or missed. */}
      <div id="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind ?? ""}`}>
            <div className="t">
              <b>{t.title}</b>
              {t.body && <span>{t.body}</span>}
            </div>
            <button
              className="x"
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
              aria-label="Tutup"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
