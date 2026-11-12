import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "capture.spec.ts", workers: 1, timeout: 30000,
  use: { baseURL: process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:5173", viewport: { width: 1440, height: 900 } },
});
