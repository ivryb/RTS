// Captures preview scenes with SwiftShader and with llvmpipe, reports per-pixel difference and preview frame rate.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const out = "art/workbench/performance/boat-rendering/compare"; mkdirSync(out, { recursive: true });
const sets = { swiftshader: [], llvmpipe: ["--use-angle=gl", "--ignore-gpu-blocklist"] };
const shots = {};
for (const [name, args] of Object.entries(sets)) {
  const browser = await chromium.launch({ args });
  for (const scene of ["units", "buildings", "terrain"]) {
    const page = await browser.newPage({ viewport: { width: 3240, height: 900 } });
    await page.goto(`http://localhost:5173/tools/preview/?scene=${scene}&seed=77&capture=0`);
    await page.waitForFunction(() => window.__previewReady === true, undefined, { timeout: 120_000 });
    const fps = await page.evaluate(() => new Promise((done) => { let n = 0; const t0 = performance.now();
      const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else done(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
    const path = `${out}/${scene}-${name}.png`;
    await page.screenshot({ path, timeout: 120_000 });
    (shots[scene] ??= {})[name] = path;
    console.log(name, scene, "fps", fps.toFixed(2));
    await page.close();
  }
  await browser.close();
}
// Pixel difference through a page canvas, so no image library is needed.
const browser = await chromium.launch({ args: sets.llvmpipe });
const page = await browser.newPage();
const { readFileSync } = await import("node:fs");
for (const [scene, p] of Object.entries(shots)) {
  const [a, b] = [p.swiftshader, p.llvmpipe].map((f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`);
  const r = await page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = new OffscreenCanvas(ia.width, ia.height), x = c.getContext("2d");
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
    x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, over8 = 0; for (let i = 0; i < da.length; i += 4) { const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i+1] - db[i+1]), Math.abs(da[i+2] - db[i+2])); sum += d; if (d > 8) over8++; }
    return { meanDiff: sum / (da.length / 4), pixelsOver8: over8 / (da.length / 4) };
  }, [a, b]);
  console.log(scene, JSON.stringify(r));
}
await browser.close();
