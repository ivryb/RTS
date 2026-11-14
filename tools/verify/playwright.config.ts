import { defineConfig } from "@playwright/test";
import { chromiumArgs } from "../chromium.ts";

export default defineConfig({
  testDir: ".",
  testMatch: "specs/*.spec.ts",
  // Boat has no GPU: Mesa's llvmpipe draws the full render at 2 to 3 frames per second, light at about 14.
  timeout: process.platform === "darwin" ? 60_000 : 300_000,
  workers: 1,
  use: {
    launchOptions: { args: chromiumArgs },
    baseURL: process.env.VERIFY_BASE_URL ?? "http://localhost:5173",
  },
});
