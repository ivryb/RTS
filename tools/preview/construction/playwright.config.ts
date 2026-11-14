import { defineConfig } from "@playwright/test";
import { chromiumArgs } from "../../chromium.ts";

export default defineConfig({
  testDir: ".",
  testMatch: ["capture.spec.ts"],
  // Boat renders through software WebGL; a film is several hundred frames.
  timeout: 30 * 60_000,
  workers: 1,
  use: {
    launchOptions: { args: chromiumArgs },
    baseURL: process.env.VERIFY_BASE_URL ?? "http://localhost:5173",
    deviceScaleFactor: 1,
  },
});
