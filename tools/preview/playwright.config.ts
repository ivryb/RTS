import { defineConfig } from "@playwright/test";
import { chromiumArgs } from "../chromium.ts";

export default defineConfig({
  testDir: ".",
  testMatch: ["previewCapture.spec.ts", "cameraClipping.spec.ts"],
  timeout: 30_000,
  workers: 1,
  use: {
    launchOptions: { args: chromiumArgs },
    // Vite 8 binds the IPv6 loopback only, so 127.0.0.1 no longer answers.
    baseURL: process.env.VERIFY_BASE_URL ?? "http://localhost:5173",
    viewport: { width: 3240, height: 900 },
    deviceScaleFactor: 1,
  },
});
