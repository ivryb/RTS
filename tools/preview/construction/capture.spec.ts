import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { test, type Page } from "@playwright/test";

// CONSTRUCTION_SHOTS narrows the run, e.g. "gameplay,perf".
const only = process.env.CONSTRUCTION_SHOTS?.split(",");
const outputDirectory = "art/workbench/renders/previews/construction";

mkdirSync(outputDirectory, { recursive: true });

const open = async (page: Page, shot: string, width: number, height: number) => {
  await page.setViewportSize({ width, height });
  page.on("pageerror", (error) => console.log(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") console.log(`page ${message.type()}: ${message.text()}`);
  });
  await page.goto(`/tools/preview/construction/?shot=${shot}`);
  await page.waitForFunction(() => window.__constructionReady === true, undefined, { timeout: 300_000 });
};

/** Pixel width of each still; close shots of the Command Center need wider panels to fit it. */
const stills: Record<string, number> = {
  gameplay: 3240,
  "turret-close": 3240,
  "command-center-close": 5200,
  states: 3240,
  "states-turret": 3240,
  "states-command-center": 5200,
  completion: 3240,
  "completion-turret": 3240,
  destroyed: 3240,
  "destroyed-turret": 3240,
  damage: 3240,
  "damage-turret": 3240,
  "first-layer": 3240,
  "first-layer-turret": 3240,
  "cuts-turret": 3240,
  "cuts-command-center": 5200,
  shoulders: 5200,
  "drop-turret": 3240,
  drop: 3240,
  barrels: 3240,
  fit: 2400,
  slope: 3240,
};

for (const [shot, width] of Object.entries(stills)) {
  if (only && !only.includes(shot)) continue;
  test(`construction ${shot}`, async ({ page }) => {
    await open(page, shot, width, 900);
    await page.screenshot({ path: `${outputDirectory}/${shot}.png`, timeout: 120_000 });
  });
}

for (const shot of ["film", "film-turret", "film-command-center", "film-loss", "film-loss-turret"]) {
  if (only && !only.includes(shot)) continue;
  test(`construction ${shot}`, async ({ page }) => {
    await open(page, shot, 1280, 720);
    const frames = `${outputDirectory}/${shot}-frames`;
    rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames, { recursive: true });
    const count = await page.evaluate(() => window.__constructionFrameCount ?? 0);
    for (let index = 0; index < count; index += 1) {
      await page.evaluate((frame) => window.__constructionFrame?.(frame), index);
      await page.screenshot({
        path: `${frames}/${String(index).padStart(4, "0")}.jpg`,
        type: "jpeg",
        quality: 92,
        timeout: 120_000,
      });
    }
    // Real speed at 30 frames per second: the Turret's own 10 s build, or 12 s of the Command Center's 60 s.
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error", "-framerate", "30", "-i", `${frames}/%04d.jpg`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", `${outputDirectory}/${shot}.mp4`,
    ]);
    // CONSTRUCTION_KEEP_FRAMES leaves the stills behind, to judge a moment frame by frame.
    if (!process.env.CONSTRUCTION_KEEP_FRAMES) rmSync(frames, { recursive: true, force: true });
  });
}

if (!only || only.includes("perf")) {
  test("construction perf", async ({ page }) => {
    await open(page, "perf", 1600, 900);
    const report = await page.evaluate(() => window.__constructionPerf?.());
    writeFileSync(`${outputDirectory}/perf.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
    await page.screenshot({ path: `${outputDirectory}/perf.png`, timeout: 120_000 });
  });
}
