import { chromium } from "@playwright/test";
import { chromiumArgs } from "../chromium.ts";
import { mkdir, writeFile } from "node:fs/promises";

// Reuses the dev server. Each run gets a fresh browser and exercises real input.
const outputDirectory = "art/workbench/performance";
const label = process.argv[2] ?? "combat";
await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: chromiumArgs,
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.perfCapture = { recording: false, frames: [], gl: [], longTasks: [] };
    for (const name of [
      "compileShader", "linkProgram", "getProgramParameter", "getProgramInfoLog", "bufferSubData",
    ]) {
      const original = WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name] = function (...args) {
        const start = performance.now();
        const result = original.apply(this, args);
        if (window.perfCapture.recording) {
          window.perfCapture.gl.push({ name, start, ms: performance.now() - start });
        }
        return result;
      };
    }
    new PerformanceObserver((list) => {
      if (!window.perfCapture.recording) return;
      window.perfCapture.longTasks.push(...list.getEntries().map((entry) => ({
        start: entry.startTime, ms: entry.duration,
      })));
    }).observe({ type: "longtask" });
    let previous = 0;
    function frame(time) {
      if (window.perfCapture.recording) window.perfCapture.frames.push({ time, ms: time - previous });
      previous = time;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });

  const startupStarted = performance.now();
  await page.goto(`${process.env.VERIFY_BASE_URL ?? "http://localhost:5173"}/?seed=77&verify=1`);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => window.__dune77?.inspect()?.tick > 5);
  await page.evaluate(() => window.__dune77.ready());
  const startupMs = performance.now() - startupStarted;
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector("#game").getContext("webgl2");
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 650);
  await page.waitForTimeout(500);
  const points = await page.evaluate(() => window.__dune77.inspect().units
    .filter((unit) => unit.ownerId === "local-player")
    .map((unit) => window.__dune77.project(unit.x, unit.z, 1.1)));
  await page.mouse.move(Math.min(...points.map((p) => p.x)) - 12, Math.min(...points.map((p) => p.y)) - 12);
  await page.mouse.down();
  await page.mouse.move(Math.max(...points.map((p) => p.x)) + 12, Math.max(...points.map((p) => p.y)) + 12, { steps: 8 });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.__dune77.inspect().selected.unitIds);
  if (selected.length !== 3) throw new Error("Selection failed");
  const target = await page.evaluate(() => {
    const enemy = window.__dune77.inspect().units.find((unit) => unit.id === "enemy-ghostrunner-1");
    return window.__dune77.project(enemy.x, enemy.z, 1);
  });
  if (target.x < 0 || target.x > 1440 || target.y < 0 || target.y > 900) {
    throw new Error("Combat target is outside the viewport");
  }
  const cdp = await page.context().newCDPSession(page);
  if (process.env.PROFILE_CPU) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
  }
  await page.evaluate(() => { window.perfCapture.recording = true; });
  await page.waitForTimeout(1500);
  await page.mouse.click(target.x, target.y, { button: "right" });
  await page.waitForTimeout(10000);
  if (process.env.PROFILE_CPU) {
    const { profile } = await cdp.send("Profiler.stop");
    await writeFile(`${outputDirectory}/${label}.cpuprofile`, JSON.stringify(profile));
  }
  const result = await page.evaluate(() => ({ ...window.perfCapture, snapshot: window.__dune77.inspect() }));
  if (errors.length) throw new Error(errors.join("\n"));
  if (!result.snapshot.units.some((unit) => unit.ownerId === "local-player" && unit.health < unit.maxHealth)) {
    throw new Error("The run never reached combat");
  }
  const sorted = result.frames.map((frame) => frame.ms).sort((a, b) => a - b);
  const summary = {
    gpu,
    startupMs,
    frames: sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted.at(-1),
    over50: sorted.filter((ms) => ms > 50).length,
    gl: Object.fromEntries(Object.entries(Object.groupBy(result.gl, (call) => call.name))
      .map(([name, calls]) => [name, {
        count: calls.length,
        max: Math.max(...calls.map((call) => call.ms)),
        total: calls.reduce((sum, call) => sum + call.ms, 0),
      }])),
    longTasks: result.longTasks,
  };
  console.log(JSON.stringify(summary, null, 2));
  await writeFile(`${outputDirectory}/${label}-summary.json`, JSON.stringify(summary, null, 2));
  await writeFile(`${outputDirectory}/${label}.json`, JSON.stringify(result));
  await page.screenshot({ path: `${outputDirectory}/${label}.png` });
} finally {
  await browser.close();
}
