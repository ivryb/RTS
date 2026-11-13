// Copy of tools/preview/playwright.config.ts with Chromium args from PREVIEW_ARGS (JSON), for D77-11 timing.
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "../tools/preview",
  testMatch: ["previewCapture.spec.ts"],
  timeout: 600_000,
  workers: 1,
  use: {
    launchOptions: { args: JSON.parse(process.env.PREVIEW_ARGS ?? "[]") },
    baseURL: "http://localhost:5173",
    viewport: { width: 3240, height: 900 },
    deviceScaleFactor: 1,
  },
});
