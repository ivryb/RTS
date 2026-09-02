import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "specs/*.spec.ts",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: process.env.VERIFY_BASE_URL ?? "http://localhost:5173",
  },
});
