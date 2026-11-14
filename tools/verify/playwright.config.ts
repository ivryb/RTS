import { defineConfig } from "@playwright/test";
import { chromiumArgs } from "../chromium.ts";

export default defineConfig({
  testDir: ".",
  testMatch: "specs/*.spec.ts",
  // Full-render specs are slow on Boat; see the verify-dune77 skill's render modes.
  timeout: process.platform === "darwin" ? 60_000 : 300_000,
  workers: 1,
  use: {
    launchOptions: { args: chromiumArgs },
    baseURL: process.env.VERIFY_BASE_URL ?? "http://localhost:5173",
  },
});
