import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  clickEntity,
  openGame,
  screenPoint,
  snapshot,
  waitForSnapshot,
  type BuildingSnapshot,
} from "../helpers";

const evidenceDir = "art/workbench/verify/construction";
const SCOUT = "scout-drone-1";
/** The game's closest zoom, as a multiple of its default. */
const CLOSEST = 3;

type Kind = "turret" | "command-center";
interface Frame {
  file: string;
  progress: number;
  lifecycle: string;
  /** The Scout Drone's order and whether it is still travelling. */
  drone: string;
}

const siteState = async (page: Page, id: string) => {
  const snap = await snapshot(page);
  const drone = snap.units.find((unit) => unit.id === SCOUT)!;
  return {
    site: snap.buildings.find((building) => building.id === id),
    drone: `${drone.order}${drone.moving ? ", moving" : ""}`,
  };
};

/** Screenshots the site as it stands, and records what the simulation said at that moment. */
const shoot = async (page: Page, site: BuildingSnapshot, name: string, frames: Frame[], size: [number, number]) => {
  const { site: current, drone } = await siteState(page, site.id);
  const centre = await screenPoint(page, site.x, site.z, site.kind === "turret" ? 1 : 2.5);
  const file = `${name}-${String(frames.length).padStart(2, "0")}.jpg`;
  await page.screenshot({
    path: `${evidenceDir}/${file}`,
    type: "jpeg",
    quality: 92,
    clip: { x: centre.x - size[0] / 2, y: centre.y - size[1] / 2, width: size[0], height: size[1] },
    timeout: 120_000,
  });
  frames.push({
    file,
    progress: current?.constructionProgress ?? -1,
    lifecycle: current?.lifecycle ?? "removed",
    drone,
  });
  return current;
};

const look = (page: Page, x: number, z: number, zoom = 1) =>
  page.evaluate(([viewX, viewZ, viewZoom]) => window.__dune77!.view(viewX, viewZ, viewZoom), [x, z, zoom] as const);

/** Places a site through the HUD and the canvas, at the first spot around the drone the game accepts. */
const placeSite = async (page: Page, kind: Kind, distance: number) => {
  const drone = (await snapshot(page)).units.find((unit) => unit.id === SCOUT)!;
  for (let turn = 0; turn < 12; turn += 1) {
    const x = drone.x + Math.cos(turn * Math.PI / 6) * distance;
    const z = drone.z + Math.sin(turn * Math.PI / 6) * distance;
    const known = new Set((await snapshot(page)).buildings.map((building) => building.id));
    await look(page, drone.x, drone.z);
    await clickEntity(page, SCOUT);
    await page.click('[data-action="build"]');
    await page.click(`[data-build-kind="${kind}"]`);
    await look(page, x, z);
    const point = await screenPoint(page, x, z);
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y);
    try {
      const placed = await waitForSnapshot(page, (snap) =>
        snap.buildings.some((building) => !known.has(building.id)), 4_000);
      return placed.buildings.find((building) => !known.has(building.id))!;
    } catch {
      await page.keyboard.press("Escape");
    }
  }
  throw new Error(`No valid spot for a ${kind} around the Scout Drone`);
};

/** Right-clicks the site, which sends the selected drone back to work on it. */
const resume = async (page: Page, site: BuildingSnapshot) => {
  for (const height of [0.4, 1.2, 2.5]) {
    const point = await screenPoint(page, site.x, site.z, height);
    await page.mouse.click(point.x, point.y, { button: "right" });
    await page.waitForTimeout(400);
    const drone = (await snapshot(page)).units.find((unit) => unit.id === SCOUT)!;
    if (drone.order === "build") return;
  }
  throw new Error("The drone did not go back to the site");
};

/** How many pixels of the page a capture covers, at default zoom and at the closest zoom. */
const frameSize = (kind: Kind, zoom: "default" | "close"): [number, number] =>
  zoom === "default" ? (kind === "turret" ? [280, 210] : [460, 340]) : kind === "turret" ? [520, 400] : [900, 600];

const progressOf = async (page: Page, id: string) => (await siteState(page, id)).site?.constructionProgress ?? 0;

/** Captures frames until the site is complete, then through the half second its scaffold takes to drop. */
const followToCompletion = async (page: Page, site: BuildingSnapshot, name: string, frames: Frame[], size: [number, number]) => {
  for (;;) {
    const current = await shoot(page, site, name, frames, size);
    if (current?.lifecycle === "active") break;
  }
  // The game steps at most 50 ms a frame, so the drop is spread over ten rendered frames.
  for (let index = 0; index < 12; index += 1) await shoot(page, site, `${name}-complete`, frames, size);
};

const build = async (page: Page, kind: Kind) => {
  mkdirSync(evidenceDir, { recursive: true });
  const frames: Frame[] = [];
  await openGame(page, 77);
  // Every construction material is named "Construction ...", and a program carries that name.
  const constructionPrograms = async () => (await page.evaluate(() => window.__dune77!.programs()))
    .filter((program) => program.startsWith("Construction"));
  const compiled = new Set(await constructionPrograms());
  expect([...new Set([...compiled].map((program) => program.split("|")[0]))].sort()).toEqual([
    "Construction cut",
    "Construction cut shadow",
    "Construction deck",
    "Construction glow",
    "Construction scaffold",
  ]);
  /** The construction shader programs compiled since the match was ready. */
  const compiledSince = async () => (await constructionPrograms())
    .filter((program) => !compiled.has(program))
    .map((program) => program.slice(0, 300));

  // Just placed: the drone is stopped on its way, so the site waits with nothing built.
  const site = await placeSite(page, kind, 30);
  await page.keyboard.press("s");
  await waitForSnapshot(page, (snap) => snap.units.find((unit) => unit.id === SCOUT)!.order === "idle");
  expect(await progressOf(page, site.id)).toBe(0);
  await look(page, site.x, site.z);
  await shoot(page, site, `${kind}-placed-default`, frames, frameSize(kind, "default"));
  await look(page, site.x, site.z, CLOSEST);
  await shoot(page, site, `${kind}-placed-close`, frames, frameSize(kind, "close"));

  // With nothing built, the site is picked through its scaffold: selected by a click, and
  // resumed by a right-click on it.
  await look(page, site.x, site.z);
  await clickEntity(page, site.id);
  expect((await snapshot(page)).selected.buildingIds).toEqual([site.id]);
  const drone = (await snapshot(page)).units.find((unit) => unit.id === SCOUT)!;
  await look(page, drone.x, drone.z);
  await clickEntity(page, SCOUT);
  await look(page, site.x, site.z);
  await resume(page, site);

  // Working, then paused: the drone, still selected, is ordered away once work has begun.
  await waitForSnapshot(page, (snap) =>
    (snap.buildings.find((building) => building.id === site.id)?.constructionProgress ?? 0) > 0, 60_000);
  if (kind === "command-center") {
    for (let index = 0; index < 6; index += 1) {
      await shoot(page, site, `${kind}-working-default`, frames, frameSize(kind, "default"));
    }
  }
  // Every shader a site needs was compiled at startup, so no frame of the build stops for one.
  expect(await compiledSince()).toEqual([]);
  const away = await screenPoint(page, site.x + 9, site.z + 9);
  await page.mouse.click(away.x, away.y, { button: "right" });
  await waitForSnapshot(page, (snap) => snap.units.find((unit) => unit.id === SCOUT)!.order !== "build");
  const paused = await progressOf(page, site.id);
  expect(paused).toBeGreaterThan(0);
  expect(paused).toBeLessThan(1);
  await page.waitForTimeout(1_500);
  await shoot(page, site, `${kind}-paused-default`, frames, frameSize(kind, "default"));
  await look(page, site.x, site.z, CLOSEST);
  await shoot(page, site, `${kind}-paused-close`, frames, frameSize(kind, "close"));
  expect(await progressOf(page, site.id)).toBe(paused);

  // Resumed at the closest zoom and followed to completion.
  await resume(page, site);
  await waitForSnapshot(page, (snap) =>
    (snap.buildings.find((building) => building.id === site.id)?.constructionProgress ?? 0) > paused, 60_000);
  await followToCompletion(page, site, `${kind}-working-close`, frames, frameSize(kind, "close"));
  await look(page, site.x, site.z);
  await shoot(page, site, `${kind}-complete-default`, frames, frameSize(kind, "default"));

  writeFileSync(`${evidenceDir}/${kind}-frames.json`, `${JSON.stringify(frames, null, 2)}\n`);
  const final = (await siteState(page, site.id)).site!;
  expect(final.lifecycle).toBe("active");
  expect(final.health).toBe(final.maxHealth);
  expect(await compiledSince()).toEqual([]);
};

// Boat draws the game in software; a smaller window gives more frames of a ten-second build.
test.use({ viewport: { width: 1000, height: 780 } });

test("a Scout Drone builds a Turret inside a scaffold", async ({ page }) => {
  await build(page, "turret");
});

test("a Scout Drone builds a Command Center inside a scaffold", async ({ page }) => {
  test.setTimeout(600_000);
  await build(page, "command-center");
});

test("a Turret site is followed from placement to completion at default zoom", async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true });
  const frames: Frame[] = [];
  await openGame(page, 77);
  const site = await placeSite(page, "turret", 12);
  await look(page, site.x, site.z);
  await followToCompletion(page, site, "turret-uninterrupted-default", frames, frameSize("turret", "default"));
  writeFileSync(`${evidenceDir}/turret-uninterrupted-frames.json`, `${JSON.stringify(frames, null, 2)}\n`);
});
