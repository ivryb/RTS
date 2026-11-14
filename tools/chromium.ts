/**
 * Chromium args for every Playwright launch in this repository: configs, capture scripts and
 * the terrain hub. On a Mac they select the real GPU. Boat has no GPU, and without them Chromium
 * falls back to its built-in SwiftShader, which draws the game ten times slower than Mesa's
 * llvmpipe (docs/research/2026-11-13-boat-rendering.md). llvmpipe needs the GPU blocklist
 * ignored, or the page gets no WebGL2 at all.
 */
export const chromiumArgs = process.platform === "darwin"
  ? ["--use-angle=metal"]
  : ["--use-angle=gl", "--ignore-gpu-blocklist"];
