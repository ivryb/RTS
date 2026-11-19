// Captures the death-effects preview. Needs a dev server on port 5173 and ffmpeg, so run it on Boat:
//   box 'bun run dev >/tmp/vite.log 2>&1 & until curl -sf -o /dev/null http://localhost:5173; do sleep 1; done;
//        bun run preview:capture:death-effects clips scout-drone,behemoth'
//   box pull art/workbench/renders/previews/death-effects/
// Usage: capture.mjs <clips|measure> [scenario[,scenario]]
//   clips    writes per scenario a 30 fps clip and a frame strip for each camera, plus aftermath stills.
//   measure  runs the scenario three times and writes cost.json: draw calls, triangles, update time.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { chromiumArgs } from "../../chromium.ts";

const [mode = "clips", scenarioList] = process.argv.slice(2);
const baseURL = process.env.VERIFY_BASE_URL ?? "http://localhost:5173";
const outputRoot = "art/workbench/renders/previews/death-effects";
const PANEL = { width: 1280, height: 720 };
const FRAMES_PER_SECOND = 30;
const MEASURE_RUNS = 3;
const allScenarios = [
  "scout-drone", "hornet", "behemoth", "ghostrunner",
  "command-center", "turret", "construction-site", "turret-site",
  "mass-fight", "skirmish", "slope", "wreck-cap", "base-assault",
];
const scenarios = scenarioList ? scenarioList.split(",") : allScenarios;
const font = execFileSync("fc-match", ["-f", "%{file}", "sans:bold"]).toString();

const openStage = async (browser, scenario) => {
  const page = await browser.newPage({
    viewport: { width: PANEL.width * 2, height: PANEL.height },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (error) => console.error(`${scenario}: ${error.message}`));
  await page.goto(`${baseURL}/tools/preview/death-effects/?scenario=${scenario}`);
  await page.waitForFunction(() => Boolean(window.__stage), undefined, { timeout: 180_000 });
  return page;
};

const ffmpeg = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);

/** A grid of labelled moments from one camera. `keepPixels` crops the middle at 1:1 instead of shrinking. */
const writeStrip = (shots, view, keepPixels, path) => {
  const left = view === "gameplay" ? 0 : PANEL.width;
  const crop = keepPixels
    ? `crop=${PANEL.width / 2}:${PANEL.height / 2}:${left + PANEL.width / 4}:${PANEL.height / 4}`
    : `crop=${PANEL.width}:${PANEL.height}:${left}:0,scale=${PANEL.width / 2}:${PANEL.height / 2}`;
  const tiles = shots.map(({ seconds }, index) =>
    `[${index}:v]${crop},drawtext=fontfile=${font}:text='${seconds.toFixed(2)} s':x=12:y=12:fontsize=22`
    + `:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=7,setsar=1[t${index}]`);
  const columns = 4;
  const rows = Math.ceil(shots.length / columns);
  ffmpeg([
    ...shots.flatMap(({ file }) => ["-i", file]),
    "-filter_complex",
    `${tiles.join(";")};${shots.map((_, index) => `[t${index}]`).join("")}`
    + `concat=n=${shots.length}:v=1,tile=${columns}x${rows}:padding=4:color=0x241b13[out]`,
    "-map", "[out]", "-frames:v", "1", "-q:v", "3", path,
  ]);
};

const captureClips = async (scenario) => {
  const directory = `${outputRoot}/${scenario}`;
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(`${directory}/frames`, { recursive: true });
  const browser = await chromium.launch({ args: chromiumArgs });
  const page = await openStage(browser, scenario);
  const meta = await page.evaluate(() => window.__stage.scenario);
  const shoot = async (seconds, file) => {
    await page.evaluate((time) => window.__stage.advanceTo(time), seconds);
    await page.screenshot({ path: file, type: "jpeg", quality: 92, timeout: 120_000 });
  };
  const frameCount = Math.round(meta.clipSeconds * FRAMES_PER_SECOND);
  const frameFile = (index) => `${directory}/frames/f${String(index).padStart(4, "0")}.jpg`;
  for (let index = 0; index <= frameCount; index += 1) {
    await shoot(index / FRAMES_PER_SECOND, frameFile(index));
  }
  const shots = meta.stripTimes.map((seconds) => ({
    seconds,
    file: frameFile(Math.round(seconds * FRAMES_PER_SECOND)),
  }));
  for (const seconds of meta.aftermathTimes) {
    const file = `${directory}/after-${seconds}s.jpg`;
    await shoot(seconds, file);
    shots.push({ seconds, file });
  }
  await browser.close();
  for (const [view, left] of [["gameplay", 0], ["close", PANEL.width]]) {
    ffmpeg([
      "-framerate", String(FRAMES_PER_SECOND), "-i", `${directory}/frames/f%04d.jpg`,
      "-vf", `crop=${PANEL.width}:${PANEL.height}:${left}:0`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart",
      `${directory}/${view}.mp4`,
    ]);
    writeStrip(shots, view, meta.buildings.length === 0 && meta.units.length < 10,
      `${directory}/strip-${view}.jpg`);
  }
  rmSync(`${directory}/frames`, { recursive: true });
  console.log(`${scenario}: ${frameCount + 1} frames, ${meta.clipSeconds} s`);
};

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const percentile = (values, share) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * share))];

const measure = async (scenario) => {
  const runs = [];
  for (let run = 0; run < MEASURE_RUNS; run += 1) {
    // A fresh browser for each run: a second page in a used browser measured several times slower.
    const browser = await chromium.launch({ args: chromiumArgs });
    const page = await openStage(browser, scenario);
    // The first steps after loading still compile code, so they are stepped but not counted.
    await page.evaluate(() => window.__stage.measure(0.1));
    const quiet = await page.evaluate(() => window.__stage.measure(0.4));
    const active = await page.evaluate(() => window.__stage.measure(6));
    await browser.close();
    const updates = active.map((frame) => frame.updateMs);
    runs.push({
      quietDrawCalls: median(quiet.map((frame) => frame.drawCalls)),
      quietTriangles: median(quiet.map((frame) => frame.triangles)),
      quietUpdateMs: median(quiet.map((frame) => frame.updateMs)),
      peakDrawCalls: Math.max(...active.map((frame) => frame.drawCalls)),
      peakTriangles: Math.max(...active.map((frame) => frame.triangles)),
      endDrawCalls: active.at(-1).drawCalls,
      endTriangles: active.at(-1).triangles,
      meanUpdateMs: updates.reduce((total, value) => total + value, 0) / updates.length,
      p95UpdateMs: percentile(updates, 0.95),
      peakUpdateMs: Math.max(...updates),
    });
  }
  const summary = Object.fromEntries(Object.keys(runs[0]).map((key) => {
    const values = runs.map((run) => run[key]);
    return [key, { median: median(values), min: Math.min(...values), max: Math.max(...values) }];
  }));
  const directory = `${outputRoot}/${scenario}`;
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/cost.json`, JSON.stringify({
    scenario, runs: MEASURE_RUNS, stepsPerSecond: 60, secondsMeasured: 6, summary,
  }, null, 2));
  console.log(`${scenario}: ${JSON.stringify(summary)}`);
};

for (const scenario of scenarios) await (mode === "measure" ? measure : captureClips)(scenario);
