import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { clickEntity, clickWorld, dragSelectUnits, screenPoint, snapshot, waitForSnapshot } from "../helpers";

/**
 * D77-16: records the Reticle markers' motion (`?markers=b`) at true speed. Boat draws two or
 * three full-render frames a second, so instead of filming the screen the spec freezes the
 * markers' clock (`window.__markerClock`), steps it one 60 fps frame at a time and screenshots
 * each step. Everything else in the game keeps its own time, so idle units move too fast.
 * Writes art/workbench/verify/markers/motion/<clip>.mp4 (60 fps), <clip>-quarter.mp4 (the same
 * frames at a quarter of the speed) and <clip>-strip.jpg (the frames around the motion, in order).
 */
const evidenceDir = "art/workbench/verify/markers/motion";
const FRAME_MS = 1000 / 60;
/** About 300 ms of stillness before and after each motion. */
const STILL = 18;
/** Frames given to a selection marker's 150 ms, and shown in its strip from two frames before. */
const APPEAR = 10;
/** Screen pixels of sand kept around every crop. */
const CLIP_PAD = 24;

type Clip = { x: number; y: number; width: number; height: number };
type Ground = { x: number; z: number };

const look = (page: Page, { x, z }: Ground) =>
  page.evaluate(([viewX, viewZ]) => window.__dune77!.view(viewX, viewZ, 1), [x, z] as const);

/** Resolves once the game has drawn a frame that began after this call. */
const drawn = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
}));

const setClock = (page: Page, frozen: boolean) =>
  page.evaluate((freeze) => { window.__markerClock = freeze ? performance.now() : undefined; }, frozen);

/** The screen rectangle around a ground disc and whatever stands `height` metres tall on it, with even sides for H.264. */
const clipAround = async (page: Page, centre: Ground, radius: number, height: number): Promise<Clip> => {
  const rim = await Promise.all(Array.from({ length: 16 }, (_, index) => {
    const angle = index / 16 * Math.PI * 2;
    return screenPoint(page, centre.x + Math.cos(angle) * radius, centre.z + Math.sin(angle) * radius);
  }));
  const top = await screenPoint(page, centre.x, centre.z, height);
  const even = (value: number) => Math.ceil(value / 2) * 2;
  const x = Math.floor(Math.min(...rim.map((point) => point.x))) - CLIP_PAD;
  const y = Math.floor(Math.min(top.y, ...rim.map((point) => point.y))) - CLIP_PAD;
  return {
    x,
    y,
    width: even(Math.max(...rim.map((point) => point.x)) + CLIP_PAD - x),
    height: even(Math.max(...rim.map((point) => point.y)) + CLIP_PAD - y),
  };
};

const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);

/** Collects one clip's frames; `finish` turns them into the two videos and the strip. */
const recorder = (page: Page, name: string, clip: Clip) => {
  const frames = `${evidenceDir}/frames-${name}`;
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  let count = 0;
  const frame = async () => {
    await drawn(page);
    await page.screenshot({ path: `${frames}/${String(count).padStart(4, "0")}.png`, clip, timeout: 120_000 });
    count += 1;
    // Step after the shot: whatever input comes next then starts its motion on the frame it lands in.
    await page.evaluate((step) => { window.__markerClock! += step; }, FRAME_MS);
  };
  return {
    frame,
    count: () => count,
    async hold(length: number) {
      for (let index = 0; index < length; index += 1) await frame();
    },
    /** `strip` lists the frames to lay out, `columns` to a row, each `tileWidth` pixels wide. */
    finish(strip: number[], columns: number, tileWidth: number) {
      const input = `${frames}/%04d.png`;
      const h264 = ["-c:v", "libx264", "-preset", "slow", "-crf", "12", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
      ffmpeg("-framerate", "60", "-i", input, ...h264, `${evidenceDir}/${name}.mp4`);
      ffmpeg("-framerate", "15", "-i", input, "-r", "60", ...h264, `${evidenceDir}/${name}-quarter.mp4`);
      const picked = strip.map((index) => `eq(n\\,${index})`).join("+");
      const rows = Math.ceil(strip.length / columns);
      ffmpeg(
        "-i", input,
        "-vf", `select=${picked},scale=${tileWidth}:-2:flags=lanczos,tile=${columns}x${rows}:padding=4:color=white`,
        "-frames:v", "1", "-q:v", "2", `${evidenceDir}/${name}-strip.jpg`,
      );
      rmSync(frames, { recursive: true, force: true });
      console.log(`${name}: ${count} frames, ${clip.width}x${clip.height}`);
    },
  };
};

const range = (from: number, length: number) => Array.from({ length }, (_, index) => from + index);

/** The share of strongly red pixels around a screen point: only a blocked placement cursor has any. */
const redShare = async (page: Page, centre: { x: number; y: number }) => {
  const shot = await page.screenshot({ clip: { x: centre.x - 150, y: centre.y - 150, width: 300, height: 300 }, timeout: 120_000 });
  return page.evaluate(async (png) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let red = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index]! > 180 && data[index]! - data[index + 1]! > 90) red += 1;
    }
    return red / (data.length / 4);
  }, shot.toString("base64"));
};

const hover = async (page: Page, spot: Ground) => {
  const point = await screenPoint(page, spot.x, spot.z);
  await page.mouse.move(point.x, point.y);
};

test("marker-motion", async ({ page }) => {
  test.setTimeout(1_800_000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`./?${new URLSearchParams({ seed: "77", verify: "1", markers: "b" })}`);
  await page.waitForFunction(() => Boolean(window.__dune77?.inspect()?.units.length));
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.__dune77!.ready());

  const snap = await snapshot(page);
  const base = snap.buildings.find((b) => b.kind === "command-center" && b.ownerId === "local-player")!;
  const deposit = [...snap.titaniumDeposits]
    .sort((a, b) => Math.hypot(a.x - base.x, a.z - base.z) - Math.hypot(b.x - base.x, b.z - base.z))[0]!;
  const runners = snap.units.filter((u) => u.kind === "ghostrunner" && u.ownerId === "local-player");
  const scout = snap.units.find((u) => u.kind === "scout-drone" && u.ownerId === "local-player")!;

  // 1. Selecting the Command Center.
  await look(page, base);
  await page.mouse.move(5, 500);
  await drawn(page);
  await setClock(page, true);
  const building = recorder(page, "select-building", await clipAround(page, base, 6.6, 9));
  await building.hold(STILL);
  await clickEntity(page, base.id);
  await building.hold(APPEAR + STILL);
  building.finish(range(STILL - 2, APPEAR + 2), 6, 480);
  await setClock(page, false);

  // 2. The placement cursor crossing into blocked ground and back. The spot where it turns is
  // found first, at the game's own pace, by halving the stretch between a valid and a blocked spot.
  const valid = { x: base.x + 14, z: base.z - 6 };
  const blocked = { x: deposit.x + (base.x - deposit.x) * 0.25, z: deposit.z + (base.z - deposit.z) * 0.25 };
  const along = (share: number) => ({ x: valid.x + (blocked.x - valid.x) * share, z: valid.z + (blocked.z - valid.z) * share });
  const isBlocked = async (share: number) => {
    const spot = along(share);
    await look(page, spot);
    const point = await screenPoint(page, spot.x, spot.z);
    await page.mouse.move(point.x - 3, point.y);
    await page.mouse.move(point.x, point.y);
    await drawn(page);
    await drawn(page);
    return await redShare(page, point) > 0.01;
  };
  await look(page, scout);
  await clickEntity(page, scout.id);
  await page.click('[data-action="build"]');
  await page.click('[data-build-kind="command-center"]');
  expect(await isBlocked(0)).toBe(false);
  expect(await isBlocked(1)).toBe(true);
  let [open, shut] = [0, 1];
  for (let round = 0; round < 8; round += 1) {
    const middle = (open + shut) / 2;
    if (await isBlocked(middle)) shut = middle;
    else open = middle;
  }
  const length = Math.hypot(blocked.x - valid.x, blocked.z - valid.z);
  const edge = (open + shut) / 2;
  // The cursor travels 1.5 m either side of the edge in 12 frames: a quick, ordinary mouse move.
  const reach = 1.5 / length;
  const SLIDE = 12;
  const slide = (step: number) => along(edge - reach + 2 * reach * step / SLIDE);
  await look(page, along(edge));
  await hover(page, slide(0.2));
  await hover(page, slide(0));
  await drawn(page);
  await drawn(page);
  await setClock(page, true);
  const placement = recorder(page, "placement-blocked", await clipAround(page, along(edge), 5.58 + 0.3 + 0.4 + 1.5, 9));
  await placement.hold(STILL);
  for (let step = 1; step <= SLIDE; step += 1) {
    await hover(page, slide(step));
    await placement.frame();
  }
  await placement.hold(STILL + 6);
  const back = placement.count();
  for (let step = SLIDE - 1; step >= 0; step -= 1) {
    await hover(page, slide(step));
    await placement.frame();
  }
  await placement.hold(STILL + 2);
  // The cursor crosses the edge half-way through each slide; each row starts on the last frame of the old look.
  placement.finish([...range(STILL + SLIDE / 2, 12), ...range(back + SLIDE / 2 - 1, 12)], 6, 480);
  await setClock(page, false);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // 3. Box-selecting the squad. It starts behind the Command Center; walk it onto open sand first.
  const ids = [...runners.map((u) => u.id), scout.id];
  await look(page, base);
  await dragSelectUnits(page, ids);
  const sand = { x: base.x + 12, z: base.z - 4 };
  await clickWorld(page, sand.x, sand.z, { y: 0, button: "right" });
  await waitForSnapshot(page, (s) => ids.every((id) => {
    const unit = s.units.find((u) => u.id === id)!;
    return !unit.moving && Math.hypot(unit.x - sand.x, unit.z - sand.z) < 4;
  }), 180_000);
  const moved = (await snapshot(page)).units.filter((u) => ids.includes(u.id));
  const centre = {
    x: moved.reduce((sum, u) => sum + u.x, 0) / moved.length,
    z: moved.reduce((sum, u) => sum + u.z, 0) / moved.length,
  };
  const spread = Math.max(...moved.map((u) => Math.hypot(u.x - centre.x, u.z - centre.z)));
  await look(page, centre);
  // A click on empty sand, on the far side from the base, deselects.
  const away = Math.hypot(centre.x - base.x, centre.z - base.z) / 9;
  await clickWorld(page, centre.x + (centre.x - base.x) / away, centre.z + (centre.z - base.z) / away);
  expect((await snapshot(page)).selected.unitIds).toEqual([]);
  await page.mouse.move(5, 500);
  await drawn(page);
  await setClock(page, true);
  const squad = recorder(page, "select-squad", await clipAround(page, centre, spread + 3, 3.5));
  await squad.hold(STILL);
  await dragSelectUnits(page, ids);
  await page.mouse.move(5, 500);
  await squad.hold(APPEAR + STILL);
  squad.finish(range(STILL - 2, APPEAR + 2), 6, 480);
  expect((await snapshot(page)).selected.unitIds.sort()).toEqual([...ids].sort());
});
