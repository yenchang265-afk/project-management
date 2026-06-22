/* In-memory sliding-window rate limiter — per-process, good enough for Phase 1
   (single Next.js instance). Swap for a shared store when scaling out. */
const hits = new Map<string, number[]>();

export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now);
  hits.set(key, arr);
  return false;
}

// Prune abandoned keys every 10 minutes so the Map doesn't grow without bound
// under sustained traffic from many distinct clients. Keys whose most recent hit
// is older than 10 minutes will have empty filtered arrays on next access anyway.
const _pruneTimer = setInterval(() => {
  const cutoff = Date.now() - 600_000;
  for (const [k, v] of hits) if (!v.length || v[v.length - 1] < cutoff) hits.delete(k);
}, 600_000);
// Don't keep the process alive (e.g. in vitest) just for housekeeping
(_pruneTimer as unknown as { unref?: () => void }).unref?.();

/** Best-effort client key for rate limiting (trust proxy header only as a bucket key). */
export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
