import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["previewCapture.spec.ts", "cameraClipping.spec.ts"],
  timeout: 30_000,
  workers: 1,
  use: {
    // Avoid software WebGL stalls on macOS during input and screenshot checks.
    launchOptions: { args: process.platform === "darwin" ? ["--use-angle=metal"] : [] },
    // Vite 8 binds the IPv6 loopback only, so 127.0.0.1 no longer answers.
    baseURL: process.env.VERIFY_BASE_URL ?? "http://localhost:5173",
    viewport: { width: 3240, height: 900 },
    deviceScaleFactor: 1,
  },
});
