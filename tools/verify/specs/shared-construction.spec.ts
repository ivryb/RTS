import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  clickEntity,
  openGame,
  screenPoint,
  snapshot,
  waitForSnapshot,
  type BuildingSnapshot,
  type MatchSnapshot,
} from "../helpers";

const evidenceDir = "art/workbench/verify/shared-construction";
const FIRST = "scout-drone-1";
const COMMAND_CENTER = "local-command-center";
/** Ticks one drone takes to build a Command Center: 60 seconds at 10 ticks a second. */
const ONE_DRONE_TICKS = 600;

const look = (page: Page, x: number, z: number, zoom = 1) =>
  page.evaluate(([viewX, viewZ, viewZoom]) => window.__dune77!.view(viewX, viewZ, viewZoom), [x, z, zoom] as const);

const unitIn = (snap: MatchSnapshot, id: string) => snap.units.find((unit) => unit.id === id)!;
const siteIn = (snap: MatchSnapshot, id: string) => snap.buildings.find((building) => building.id === id)!;
const working = (snap: MatchSnapshot, id: string) => {
  const unit = unitIn(snap, id);
  return unit.order === "build" && !unit.moving;
};

/** Selects a unit or building with the camera on it, through the real canvas click. */
const select = async (page: Page, id: string) => {
  const snap = await snapshot(page);
  const entity = snap.units.find((unit) => unit.id === id) ?? siteIn(snap, id);
  await look(page, entity.x, entity.z);
  await clickEntity(page, id);
};

/** Places a Command Center site with the first drone, at the first spot around it the game accepts. */
const placeSite = async (page: Page) => {
  const drone = unitIn(await snapshot(page), FIRST);
  for (let turn = 0; turn < 12; turn += 1) {
    const x = drone.x + Math.cos(turn * Math.PI / 6) * 12;
    const z = drone.z + Math.sin(turn * Math.PI / 6) * 12;
    const known = new Set((await snapshot(page)).buildings.map((building) => building.id));
    await select(page, FIRST);
    await page.click('[data-action="build"]');
    await page.click('[data-build-kind="command-center"]');
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
  throw new Error("No valid spot for a Command Center around the Scout Drone");
};

/** Right-clicks the site with a drone selected, which sends that drone to build it. */
const sendToSite = async (page: Page, droneId: string, site: BuildingSnapshot) => {
  await select(page, droneId);
  await look(page, site.x, site.z);
  for (const height of [0.4, 1.2, 2.5]) {
    const point = await screenPoint(page, site.x, site.z, height);
    await page.mouse.click(point.x, point.y, { button: "right" });
    await page.waitForTimeout(400);
    if (unitIn(await snapshot(page), droneId).order === "build") return;
  }
  throw new Error(`${droneId} did not go to the site`);
};

/** Progress per tick, relative to one drone's rate, measured over at least 30 ticks. */
const relativeRate = async (page: Page, siteId: string, droneIds: readonly string[]) => {
  const start = await snapshot(page);
  const end = await waitForSnapshot(page, (snap) => snap.tick >= start.tick + 30, 30_000);
  for (const snap of [start, end]) {
    expect(droneIds.every((id) => working(snap, id))).toBe(true);
  }
  const progress = siteIn(end, siteId).constructionProgress - siteIn(start, siteId).constructionProgress;
  return progress / (end.tick - start.tick) * ONE_DRONE_TICKS;
};

/** The HUD line the selected site shows, such as "Construction 12% · working". */
const hudLine = async (page: Page, siteId: string) => {
  await select(page, siteId);
  return (await page.locator("#unit-panel").innerText()).match(/Construction \d+% · \w+/)?.[0];
};

test("two Scout Drones build one Command Center together without interrupting each other", async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(evidenceDir, { recursive: true });
  await openGame(page, 77);

  // A second drone, trained at the Command Center.
  await select(page, COMMAND_CENTER);
  await page.click('[data-train-kind="scout-drone"]');
  const trained = await waitForSnapshot(page, (snap) => snap.units.some((unit) =>
    unit.ownerId === "local-player" && unit.kind === "scout-drone" && unit.id !== FIRST), 30_000);
  const second = trained.units.find((unit) =>
    unit.ownerId === "local-player" && unit.kind === "scout-drone" && unit.id !== FIRST)!.id;

  // The first drone places a site and starts building it.
  const site = await placeSite(page);
  await waitForSnapshot(page, (snap) => working(snap, FIRST) && siteIn(snap, site.id).constructionProgress > 0, 60_000);
  const alone = await relativeRate(page, site.id, [FIRST]);

  // The second drone joins: the first keeps building while it flies in, and both work once it arrives.
  await sendToSite(page, second, site);
  expect(working(await snapshot(page), FIRST)).toBe(true);
  await waitForSnapshot(page, (snap) => working(snap, FIRST) && working(snap, second), 60_000);
  const together = await relativeRate(page, site.id, [FIRST, second]);
  const sharedLine = await hudLine(page, site.id);
  await look(page, site.x, site.z, 1.6);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${evidenceDir}/two-drones-working.png`, timeout: 120_000 });
  await look(page, site.x, site.z, 3);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${evidenceDir}/two-drones-working-close.png`, timeout: 120_000 });

  // The first drone leaves: the second keeps building alone.
  await select(page, FIRST);
  await page.keyboard.press("s");
  await waitForSnapshot(page, (snap) => unitIn(snap, FIRST).order === "idle");
  const afterLeaving = await relativeRate(page, site.id, [second]);
  const oneLeftLine = await hudLine(page, site.id);

  // The second drone leaves too: now nothing builds, and the site is paused.
  await select(page, second);
  await page.keyboard.press("s");
  await waitForSnapshot(page, (snap) => unitIn(snap, second).order === "idle");
  const paused = siteIn(await snapshot(page), site.id).constructionProgress;
  const pausedLine = await hudLine(page, site.id);
  await look(page, site.x, site.z, 1.6);
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: `${evidenceDir}/paused.png`, timeout: 120_000 });
  const stillPaused = siteIn(await snapshot(page), site.id).constructionProgress;

  const result = { site: site.id, second, alone, together, afterLeaving, sharedLine, oneLeftLine, pausedLine, paused, stillPaused };
  writeFileSync(`${evidenceDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
  expect(alone).toBeCloseTo(1, 2);
  // Two drones build at 4/3 of one drone's rate: 3T / (n + 2) is 75% of the time.
  expect(together).toBeCloseTo(4 / 3, 2);
  expect(afterLeaving).toBeCloseTo(1, 2);
  expect(sharedLine).toMatch(/· working$/);
  expect(oneLeftLine).toMatch(/· working$/);
  expect(pausedLine).toMatch(/· paused$/);
  expect(stillPaused).toBe(paused);
});
