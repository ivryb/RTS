import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "previewCapture.spec.ts",
  timeout: 30_000,
  workers: 1,
  use: {
    // Vite 8 binds the IPv6 loopback only, so 127.0.0.1 no longer answers.
    baseURL: "http://localhost:5173",
    viewport: { width: 3240, height: 900 },
    deviceScaleFactor: 1,
  },
});
