/* Shared UI constants. LANE_FILTERS lives here (not in App.tsx) so the Backlog
   view and the app shell share one definition — the lane filter that used to
   sit in the sidebar now belongs to the Backlog page. */
export const LANE_FILTERS = [
  { key: "all", label: "All" },
  { key: "discovery", label: "Discovery" },
  { key: "build", label: "Build" },
  { key: "verify", label: "Verify" },
  { key: "release", label: "Release" },
  { key: "closed", label: "Closed" },
] as const;
