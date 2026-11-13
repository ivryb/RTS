// Prints the WebGL renderer the preview page gets with the given Chromium args.
import { chromium } from "@playwright/test";
const browser = await chromium.launch({ args: JSON.parse(process.argv[2] ?? "[]") });
const page = await browser.newPage();
await page.goto("http://localhost:5173/tools/preview/?scene=units&seed=77");
console.log(process.argv[2] ?? "[]", await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  return gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL);
}));
await browser.close();
