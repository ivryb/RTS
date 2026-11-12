import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "specs/*.spec.ts",
  // Boat has no GPU: Mesa's llvmpipe draws the full game at 2-3 frames per second.
  timeout: process.platform === "darwin" ? 60_000 : 300_000,
  workers: 1,
  use: {
    // Avoid software WebGL stalls on macOS during input and screenshot checks.
    launchOptions: { args: process.platform === "darwin" ? ["--use-angle=metal"] : ["--use-angle=gl", "--ignore-gpu-blocklist"] },
    baseURL: process.env.VERIFY_BASE_URL ?? "http://localhost:5173",
  },
});
