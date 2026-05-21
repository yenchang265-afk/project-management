import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Worktrees live under the parent repo and share a lockfile, which makes
  // Next.js' file-tracing pick the wrong root and double-load eslint configs.
  // Pin the root to this directory so lint/build behave consistently.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
