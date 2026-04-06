import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function createNextConfig(phase: string): NextConfig {
  return {
    reactStrictMode: true,
    // Keep dev artifacts separate from production build output so stale .next files
    // from `next build` cannot poison local `next dev` on Windows.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    outputFileTracingRoot: path.join(process.cwd(), "../.."),
  };
}
