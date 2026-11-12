import { defineConfig } from "vite";

// The game plus each internal tool page; the build serves them at the same paths as the dev server.
const pages = [
  "index.html",
  "prototypes/terrain-playground/index.html",
  "prototypes/procedural-buildings/index.html",
  "tools/preview/index.html",
  "tools/ui-review/index.html",
];

export default defineConfig({
  optimizeDeps: { exclude: ["recast-navigation"] },
  worker: { format: "es" },
  build: { rolldownOptions: { input: pages } },
  // Boat's preview links (`box url 5173`) reach the dev server from *.on.boat.dev.
  server: { host: true, allowedHosts: [".on.boat.dev"] },
});
