"use client";

import { STATES, type StateKey, type WiState, type WiType } from "@/lib/engine";
import { avatarHue, initials } from "@/lib/format";

export function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  const hue = avatarHue(name);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42,
      background: `oklch(0.62 0.12 ${hue})` }}>{initials(name)}</span>
  );
}

export function laneClass(stateKey: string): string {
  return "lane-" + (STATES[stateKey as StateKey] ? STATES[stateKey as StateKey].lane : "off");
}

/* ---------------- WORK-ITEM TYPES (Jira / Azure DevOps style) ---------------- */
export const WI_TYPES: Record<WiType, { label: string; mono: string; color: string }> = {
  epic:    { label: "Epic",    mono: "E", color: "oklch(0.55 0.16 295)" },
  feature: { label: "Feature", mono: "F", color: "oklch(0.52 0.14 300)" },
  story:   { label: "Story",   mono: "S", color: "oklch(0.58 0.13 150)" },
  task:    { label: "Task",    mono: "T", color: "oklch(0.55 0.13 245)" },
  bug:     { label: "Bug",     mono: "B", color: "oklch(0.585 0.18 25)" },
};

export const WI_STATES: Record<WiState, { label: string; color: string }> = {
  todo:        { label: "To Do",       color: "var(--text-3)" },
  in_progress: { label: "In Progress", color: "oklch(0.55 0.13 245)" },
  in_review:   { label: "In Review",   color: "oklch(0.55 0.16 295)" },
  blocked:     { label: "Blocked",     color: "var(--bad)" },
  done:        { label: "Done",        color: "var(--ok)" },
};

export function TypeBox({ type, size = 18 }: { type: WiType; size?: number }) {
  const t = WI_TYPES[type] || WI_TYPES.task;
  return (
    <span className="wibox mono" title={t.label}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.56), background: t.color }}>{t.mono}</span>
  );
}

export function StateBadge({ stateKey }: { stateKey: StateKey }) {
  const st = STATES[stateKey];
  return (
    <span className={"statebadge " + laneClass(stateKey)}>
      <span className="d" style={{ background: "var(--lc)" }}></span>
      {st ? st.label : stateKey}
    </span>
  );
}
