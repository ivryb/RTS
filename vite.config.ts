import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: { exclude: ["recast-navigation"] },
  worker: { format: "es" },
  // Boat's preview links (`box url 5173`) reach the dev server from *.on.boat.dev.
  server: { host: true, allowedHosts: [".on.boat.dev"] },
});
