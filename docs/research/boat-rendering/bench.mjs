// Frame-time benchmark for the live game on Boat. Usage (dev server on :5173):
//   LABEL=base ARGS='["--use-angle=gl","--ignore-gpu-blocklist"]' VIEW=1280x720 SECONDS=15 TWEAKS=noshadow,pr0.5 node docs/research/boat-rendering/bench.mjs
// Reports frame intervals, main-thread time per frame (whole rAF callback and renderer.render alone),
// and CPU seconds per Chromium thread over the recorded window, read from /proc.
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";

const label = process.env.LABEL ?? "base";
const args = JSON.parse(process.env.ARGS ?? '["--use-angle=gl","--ignore-gpu-blocklist"]');
const [width, height] = (process.env.VIEW ?? "1280x720").split("x").map(Number);
const seconds = Number(process.env.SECONDS ?? 15);
const tweaks = (process.env.TWEAKS ?? "").split(",").filter(Boolean);
const channel = process.env.CHANNEL || undefined;
const scenario = process.env.SCENARIO ?? "idle";
const out = "art/workbench/performance/boat-rendering";
mkdirSync(out, { recursive: true });

function threadTimes() {
  const times = {};
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    let cmd;
    try { cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8"); } catch { continue; }
    if (!/chrom|headless_shell/.test(cmd.split("\0")[0])) continue;
    const type = cmd.match(/--type=([a-z-]+)/)?.[1] ?? "browser";
    const sub = cmd.match(/--utility-sub-type=([a-zA-Z.]+)/)?.[1];
    for (const tid of readdirSync(`/proc/${pid}/task`)) {
      try {
        const comm = readFileSync(`/proc/${pid}/task/${tid}/comm`, "utf8").trim();
        const stat = readFileSync(`/proc/${pid}/task/${tid}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        const ticks = Number(fields[11]) + Number(fields[12]);
        const name = comm.replace(/\d+$/, "N");
        const key = `${type}${sub ? `(${sub.split(".").pop()})` : ""}:${name}`;
        times[key] = (times[key] ?? 0) + ticks;
        times[`${pid}/${tid}`] = ticks;
      } catch {}
    }
  }
  return times;
}

const browser = await chromium.launch({ args, channel });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(process.env.DSF ?? 1) });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(({ tweaks }) => {
    const bench = (window.__bench = { recording: false, frames: [], callbacks: [], renders: [], renderer: null, scene: null });
    // Three.js announces each renderer and scene to this hook; no game code changes needed.
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener("observe", ({ detail }) => {
      if (!detail?.render || !detail?.shadowMap || bench.renderer) return;
      bench.renderer = detail;
      const render = detail.render.bind(detail);
      detail.render = (scene, camera) => {
        if (scene.isScene && !scene.parent) bench.scene = scene;
        const t = performance.now();
        render(scene, camera);
        if (bench.recording) bench.renders.push(performance.now() - t);
      };
    });
    if (tweaks.includes("noaa")) {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, options) {
        return getContext.call(this, type, this.id === "game" ? { ...options, antialias: false } : options);
      };
    }
    const raf = window.requestAnimationFrame.bind(window);
    let previous = 0;
    window.requestAnimationFrame = (callback) => raf((time) => {
      const t = performance.now();
      callback(time);
      if (bench.recording) { bench.callbacks.push(performance.now() - t); bench.frames.push(time - previous); }
      previous = time;
    });
  }, { tweaks });

  const started = Date.now();
  await page.goto(`${process.env.VERIFY_BASE_URL ?? "http://localhost:5173"}/?seed=77&verify=1`);
  await page.waitForLoadState("networkidle");
  const networkIdleMs = Date.now() - started;
  await page.waitForFunction(() => window.__dune77?.inspect()?.tick > 5, undefined, { timeout: 240_000 });
  const firstTicksMs = Date.now() - started;
  await page.evaluate(() => window.__dune77.ready());
  const startupMs = Date.now() - started;
  const clockAtReady = await page.textContent("#match-clock");

  const info = await page.evaluate((tweaks) => {
    const { renderer, scene } = window.__bench;
    const gl = renderer.getContext();
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    for (const tweak of tweaks) {
      if (tweak === "noshadow") {
        renderer.shadowMap.enabled = false;
        scene.traverse((o) => { for (const m of [o.material].flat()) if (m) m.needsUpdate = true; });
      }
      if (tweak.startsWith("pr")) { renderer.setPixelRatio(Number(tweak.slice(2))); renderer.setSize(innerWidth, innerHeight, false); }
      if (tweak.startsWith("hide:")) for (const name of tweak.slice(5).replaceAll("_", " ").split("+")) {
        const o = scene.getObjectByName(name); if (!o) throw new Error(`no object ${name}`); o.visible = false;
      }
      if (tweak === "noterrain") scene.traverse((o) => { if (o.userData.terrain) o.userData.terrain.visible = false; });
      if (tweak === "vegnocast") scene.getObjectByName("Vegetation").traverse((o) => { o.castShadow = false; });
      if (tweak === "envnocast") scene.getObjectByName("Terrain environment").traverse((o) => { o.castShadow = false; });
      if (tweak.startsWith("shadow") && tweak !== "shadow") scene.traverse((o) => {
        if (!o.isDirectionalLight) return; o.shadow.mapSize.set(+tweak.slice(6), +tweak.slice(6)); o.shadow.map?.dispose(); o.shadow.map = null;
      });
      if (tweak === "empty") for (const child of scene.children) child.visible = false;
    }
    return {
      gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      cores: navigator.hardwareConcurrency,
      drawingBuffer: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
      samples: gl.getParameter(gl.SAMPLES),
      top: scene.children.map((c) => c.name || c.type),
      // Triangles per drawn mesh, before culling, grouped by the nearest named ancestor.
      meshTriangles: (() => {
        const groups = {};
        scene.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          let a = o; while (a.parent && !(a.parent.name && a.parent.name !== "") ) a = a.parent;
          let names = []; for (let p = o; p; p = p.parent) if (p.name) names.push(p.name);
          const key = names.slice(-3).reverse().join(" > ") || "(unnamed)";
          const g = o.geometry; const tri = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
          const e = (groups[key] ??= { meshes: 0, triangles: 0, castShadow: 0 }); e.meshes++; e.triangles += tri; if (o.castShadow) e.castShadow += tri;
        });
        return Object.fromEntries(Object.entries(groups).sort((a, b) => b[1].triangles - a[1].triangles).slice(0, 15));
      })(),
    };
  }, tweaks);

  if (scenario === "combat") {
    // Same opening encounter as tools/verify/profile-combat.mjs: send the three Ghostrunners at the enemy.
    await page.mouse.move(width / 2, height / 2);
    const pts = await page.evaluate(() => window.__dune77.inspect().units
      .filter((u) => u.ownerId === "local-player" && u.kind === "ghostrunner").map((u) => window.__dune77.project(u.x, u.z, 1.1)));
    await page.mouse.move(Math.min(...pts.map((p) => p.x)) - 14, Math.min(...pts.map((p) => p.y)) - 14);
    await page.mouse.down();
    await page.mouse.move(Math.max(...pts.map((p) => p.x)) + 14, Math.max(...pts.map((p) => p.y)) + 14, { steps: 4 });
    await page.mouse.up();
    const target = await page.evaluate(() => { const e = window.__dune77.inspect().units.find((u) => u.id === "enemy-ghostrunner-1"); return window.__dune77.project(e.x, e.z, 1); });
    await page.mouse.click(target.x, target.y, { button: "right" });
  }
  await page.waitForTimeout(4000); // shader variants after tweaks, first combat frames
  const before = threadTimes();
  const t0 = Date.now();
  await page.evaluate(() => { window.__bench.recording = true; window.__bench.renderer.info.autoReset = true; });
  await page.waitForTimeout(seconds * 1000);
  const result = await page.evaluate(() => {
    const b = window.__bench; b.recording = false;
    return { frames: b.frames, callbacks: b.callbacks, renders: b.renders, info: { calls: b.renderer.info.render.calls, triangles: b.renderer.info.render.triangles } };
  });
  const wallS = (Date.now() - t0) / 1000;
  const after = threadTimes();
  const cpu = {};
  for (const [key, ticks] of Object.entries(after)) {
    if (key.includes("/")) continue;
    const used = (ticks - (before[key] ?? 0)) / 100 / wallS;
    if (used > 0.02) cpu[key] = Number(used.toFixed(2));
  }
  const busiest = Object.entries(after).filter(([k]) => k.includes("/")).map(([k, v]) => (v - (before[k] ?? 0)) / 100 / wallS).sort((a, b) => b - a)[0];
  const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); const q = (p) => Number((s[Math.floor((s.length - 1) * p)] ?? NaN).toFixed(1)); return { n: s.length, p50: q(0.5), p95: q(0.95), max: q(1) }; };
  const frames = stats(result.frames);
  const summary = {
    label, scenario, args, view: `${width}x${height}`, tweaks, ...info,
    startup: { networkIdleMs, firstTicksMs, readyMs: startupMs }, clockAtReady,
    fps: Number((result.frames.length / wallS).toFixed(2)),
    frameMs: frames, callbackMs: stats(result.callbacks), renderCallMs: stats(result.renders),
    drawCalls: result.info.calls, triangles: result.info.triangles,
    cpuCoresByThread: Object.fromEntries(Object.entries(cpu).sort((a, b) => b[1] - a[1])),
    busiestThreadCores: Number(busiest.toFixed(2)),
    errors,
  };
  console.log(JSON.stringify(summary));
  writeFileSync(`${out}/${label}.json`, JSON.stringify(summary, null, 2));
  await page.screenshot({ path: `${out}/${label}.png`, timeout: 120_000 });
} finally {
  await browser.close();
}
