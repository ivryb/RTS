import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: { exclude: ["recast-navigation"] },
  worker: { format: "es" },
});
