"use client";

import { useEffect } from "react";

/* ---------------- TOASTS ---------------- */
export interface Toast {
  id: string;
  ok: boolean;
  message: string;
  type?: string;
  detail?: string | null;
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => onDismiss(t.id), t.ok ? 2600 : 6000));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts]);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div className={"toast " + (t.ok ? "ok" : "bad")} key={t.id}>
          <div className="ti">{t.ok ? "✓" : "✕"}</div>
          <div className="tt">
            <div className="ty">{t.ok ? "applied" : t.type}</div>
            <div className="tm">{t.message}</div>
            {t.detail && <div className="td">{t.detail}</div>}
          </div>
          <button className="tx" onClick={() => onDismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
