import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "specs/*.spec.ts",
  timeout: 60_000,
  workers: 1,
  use: {
    // Avoid software WebGL stalls on macOS during input and screenshot checks.
    launchOptions: { args: process.platform === "darwin" ? ["--use-angle=metal"] : [] },
    baseURL: process.env.VERIFY_BASE_URL ?? "http://localhost:5173",
  },
});
