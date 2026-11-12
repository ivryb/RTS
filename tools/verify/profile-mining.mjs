// Cost of the Scout Drone mining effect, from the mining preview scene: the same drones around one
// Titanium Deposit, once extracting and once idle. The difference is what the effect adds.
// Usage (dev server running): node tools/verify/profile-mining.mjs [label] [drones]
// Draw calls and triangles are exact and machine-independent. The update time is JavaScript only,
// on this machine's CPU; it excludes drawing, which Boat does in software.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const outputDirectory = "art/workbench/performance";
const label = process.argv[2] ?? "mining";
const drones = Number(process.argv[3]) || 20;
const frames = 20_000;
const repeats = 7;
const base = process.env.VERIFY_BASE_URL ?? "http://localhost:5173";
await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  args: process.platform === "darwin" ? ["--use-angle=metal"] : ["--use-angle=gl", "--ignore-gpu-blocklist"],
});

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

try {
  const measure = async (mining) => {
    const page = await browser.newPage({ viewport: { width: 3240, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/tools/preview/?scene=mining&seed=77&drones=${drones}&mining=${mining ? 1 : 0}`);
    await page.waitForFunction(() => window.__previewReady === true, undefined, { timeout: 120_000 });
    await page.evaluate((count) => window.__previewMeasure(count), frames);
    const runs = [];
    for (let index = 0; index < repeats; index += 1) {
      runs.push(await page.evaluate((count) => window.__previewMeasure(count), frames));
    }
    await page.close();
    if (errors.length) throw new Error(errors.join("\n"));
    const updates = runs.map((run) => run.updateMs * 1000);
    return {
      calls: runs[0].calls,
      triangles: runs[0].triangles,
      updateMicroseconds: { median: median(updates), min: Math.min(...updates), max: Math.max(...updates) },
    };
  };
  const idle = await measure(false);
  const extracting = await measure(true);
  const report = {
    label,
    drones,
    framesPerRun: frames,
    runs: repeats,
    idle,
    extracting,
    effect: {
      calls: extracting.calls - idle.calls,
      triangles: extracting.triangles - idle.triangles,
      updateMicroseconds: extracting.updateMicroseconds.median - idle.updateMicroseconds.median,
    },
  };
  await writeFile(`${outputDirectory}/mining-${label}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
