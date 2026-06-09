"use client";

import { useEffect, useState } from "react";
import App from "@/components/App";

/* Seed timestamps + relative times derive from Date.now(), so the tree only
   renders on the client to avoid SSR hydration mismatches. */
export default function Page() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <App />;
}
