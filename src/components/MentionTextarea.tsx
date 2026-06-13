"use client";

import { useRef, useState } from "react";
import { activeMention, applyMention, matchNames } from "@/lib/mentions";

/* A textarea with @mention typeahead. Typing "@" opens a dropdown of matching
   user names; picking one rewrites the token to the canonical full name so the
   server's exact-match extractMentions fires. Keyboard: ↑/↓ to move, Enter/Tab
   to pick, Esc to dismiss; ⌘/Ctrl+Enter submits (when onSubmit is given). */

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  names: string[];
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  onSubmit?: () => void;
  className?: string;
  autoFocus?: boolean;
}

interface MenuState { start: number; matches: string[]; active: number; }

export function MentionTextarea({
  value, onChange, names, placeholder, rows = 2, maxLength, onSubmit, className, autoFocus,
}: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  function refresh(text: string, caret: number) {
    const m = activeMention(text, caret);
    if (!m) { setMenu(null); return; }
    const matches = matchNames(m.query, names).slice(0, 6);
    setMenu(matches.length ? { start: m.start, matches, active: 0 } : null);
  }

  function pick(name: string) {
    const el = ref.current;
    if (!el || !menu) return;
    const caret = el.selectionStart ?? value.length;
    const next = applyMention(value, menu.start, caret, name);
    onChange(next.value);
    setMenu(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(next.caret, next.caret); });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menu) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMenu({ ...menu, active: (menu.active + 1) % menu.matches.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMenu({ ...menu, active: (menu.active - 1 + menu.matches.length) % menu.matches.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(menu.matches[menu.active]); return; }
      if (e.key === "Escape") { e.preventDefault(); setMenu(null); return; }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) { e.preventDefault(); onSubmit(); }
  }

  const caretOf = (e: React.SyntheticEvent<HTMLTextAreaElement>) =>
    (e.target as HTMLTextAreaElement).selectionStart ?? value.length;

  return (
    <div className="mention-wrap">
      <textarea ref={ref} className={className} value={value} rows={rows} maxLength={maxLength}
        placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); refresh(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => refresh(value, caretOf(e))}
        onClick={(e) => refresh(value, caretOf(e))}
        onBlur={() => setTimeout(() => setMenu(null), 120)} />
      {menu &&
        <div className="mention-menu" role="listbox" aria-label="Mention a user">
          {menu.matches.map((n, i) => (
            <button key={n} type="button" role="option" aria-selected={i === menu.active} data-active={i === menu.active}
              onMouseDown={(e) => { e.preventDefault(); pick(n); }}>
              {n}
            </button>
          ))}
        </div>}
    </div>
  );
}
