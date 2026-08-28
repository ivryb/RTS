import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "previewCapture.spec.ts",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1800, height: 1200 },
    deviceScaleFactor: 1,
  },
});
