/* ---------------- time / name formatting helpers ---------------- */

export function dur(ms: number): string {
  if (ms < 0) ms = 0;
  const m = ms / 60000;
  if (m < 60) return Math.max(1, Math.round(m)) + "m";
  const h = m / 60;
  if (h < 24) return (h < 10 ? h.toFixed(1) : Math.round(h)) + "h";
  const d = h / 24;
  return (d < 10 ? d.toFixed(1) : Math.round(d)) + "d";
}

export function timeAgo(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return Math.round(m) + "m ago";
  const h = m / 60;
  if (h < 24) return Math.round(h) + "h ago";
  const d = h / 24;
  if (d < 30) return Math.round(d) + "d ago";
  return new Date(ts).toLocaleDateString();
}

export function fullDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

export function avatarHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function fmtDays(ms: number): string {
  const d = Math.abs(ms) / 86400e3;
  return (d < 10 ? d.toFixed(1) : Math.round(d)) + "d";
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
