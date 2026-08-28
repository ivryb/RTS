import { mkdirSync } from "node:fs";
import { test } from "@playwright/test";

const outputDirectory = "art/workbench/renders/previews";
const scenes = ["buildings", "units"] as const;
const terrainSeeds = [77, 1234, 2026] as const;

mkdirSync(outputDirectory, { recursive: true });

for (const seed of terrainSeeds) {
  test(`capture terrain seed ${seed}`, async ({ page }) => {
    const started = Date.now();
    await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
    await page.goto(`/tools/preview/?scene=terrain&seed=${seed}&capture=${started}`);
    await page.waitForFunction(() => window.__previewReady === true);
    const filename = seed === terrainSeeds[0] ? "terrain.jpg" : `terrain-seed-${seed}.jpg`;
    await page.screenshot({ path: `${outputDirectory}/${filename}`, type: "jpeg", quality: 90 });
    console.log(`terrain seed ${seed}: ${Date.now() - started}ms`);
  });
}

for (const scene of scenes) {
  test(`capture ${scene}`, async ({ page }) => {
    const started = Date.now();
    await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
    await page.goto(`/tools/preview/?scene=${scene}&seed=77&capture=${started}`);
    await page.waitForFunction(() => window.__previewReady === true);
    await page.screenshot({ path: `${outputDirectory}/${scene}.jpg`, type: "jpeg", quality: 90 });
    console.log(`${scene}: ${Date.now() - started}ms`);
  });
}

test("capture units Behemoth barrage", async ({ page }) => {
  const started = Date.now();
  await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
  await page.goto(`/tools/preview/?scene=units&seed=77&effect=behemoth-barrage&capture=${started}`);
  await page.waitForFunction(() => window.__previewReady === true);
  await page.screenshot({
    path: `${outputDirectory}/behemoth-barrage.jpg`,
    type: "jpeg",
    quality: 92,
  });
  await page.evaluate(() => window.__previewStepEffect?.(0.95));
  await page.screenshot({
    path: `${outputDirectory}/behemoth-barrage-impact.jpg`,
    type: "jpeg",
    quality: 92,
  });
  await page.evaluate(() => window.__previewStepEffect?.(3));
  await page.screenshot({
    path: `${outputDirectory}/behemoth-barrage-aftermath.jpg`,
    type: "jpeg",
    quality: 92,
  });
  console.log(`Behemoth barrage: ${Date.now() - started}ms`);
});
