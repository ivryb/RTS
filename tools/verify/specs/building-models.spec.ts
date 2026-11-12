import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  clickEntity,
  clickWorld,
  minimapPoint,
  openGame,
  screenPoint,
  snapshot,
  waitForSnapshot,
} from "../helpers";

// Buildings of one kind share one loaded model; these captures prove they still look the same.
// CAPTURE_LABEL names the run (for example before or after) so two runs sit side by side.
const evidenceDir = "art/workbench/verify/building-models";
const label = process.env.CAPTURE_LABEL ?? "run";
const shot = (page: Page, name: string) => page.screenshot({
  path: `${evidenceDir}/${label}-${name}.png`,
  timeout: 120_000,
});

/** Centers the camera on a world point: a minimap jump, then two corrections from where it projects. */
const focusOn = async (page: Page, x: number, z: number) => {
  const jump = await minimapPoint(page, x, z);
  await page.mouse.click(jump.x, jump.y);
  await page.waitForTimeout(1_000);
  const center = await page.evaluate(() => ({ x: innerWidth / 2, y: innerHeight / 2 }));
  let target = { x, z };
  for (let pass = 0; pass < 2; pass += 1) {
    const origin = await screenPoint(page, x, z, 0);
    const alongX = await screenPoint(page, x + 1, z, 0);
    const alongZ = await screenPoint(page, x, z + 1, 0);
    // Solve for the world shift that moves (x, z) to the screen center, then move the camera by it.
    const [a, b, c, d] = [alongX.x - origin.x, alongZ.x - origin.x, alongX.y - origin.y, alongZ.y - origin.y];
    const [ex, ey] = [origin.x - center.x, origin.y - center.y];
    const determinant = a * d - b * c;
    target = {
      x: target.x + (d * ex - b * ey) / determinant,
      z: target.z + (a * ey - c * ex) / determinant,
    };
    const point = await minimapPoint(page, target.x, target.z);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(1_000);
  }
  await page.mouse.move(5, 400);
  await page.waitForTimeout(1_000);
};

const zoom = async (page: Page, steps: number) => {
  const canvas = await page.locator("canvas").first().boundingBox();
  await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  for (let step = 0; step < Math.abs(steps); step += 1) {
    await page.mouse.wheel(0, steps > 0 ? -240 : 240);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1_500);
};

test("buildings look the same in every presentation state", async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openGame(page, 77);
  const opening = await snapshot(page);
  const home = opening.buildings.find((building) => building.id === "local-command-center")!;
  const enemy = opening.buildings.find((building) => building.id === "enemy-command-center")!;
  await page.waitForTimeout(2_000);
  await shot(page, "1-opening");

  await clickEntity(page, home.id);
  await page.waitForTimeout(1_000);
  await shot(page, "2-command-center-selected");

  // A Scout Drone starts a Turret a few metres away; the close capture shows it early in construction.
  const scout = opening.units.find((unit) => unit.id === "scout-drone-1")!;
  await zoom(page, 3);
  await focusOn(page, scout.x, scout.z);
  await clickEntity(page, scout.id);
  await page.click('[data-action="build"]');
  await page.click('[data-build-kind="turret"]');
  const candidates = [[-6, 0], [6, 0], [0, 6], [0, -6], [-5, 5], [5, 5], [-5, -5], [5, -5]] as const;
  let placed = false;
  for (const [dx, dz] of candidates) {
    const point = await screenPoint(page, scout.x + dx, scout.z + dz, 0);
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(300);
    await clickWorld(page, scout.x + dx, scout.z + dz, { y: 0 });
    await page.waitForTimeout(500);
    const current = await snapshot(page);
    if (current.buildings.some((building) => building.lifecycle === "constructing")) {
      placed = true;
      break;
    }
  }
  expect(placed).toBe(true);
  const site = (await snapshot(page)).buildings.find((building) => building.lifecycle === "constructing")!;
  await waitForSnapshot(page, (snap) => snap.units.some((unit) =>
    unit.id === scout.id && unit.order === "build" && !unit.moving), 60_000);
  await focusOn(page, site.x, site.z);
  await shot(page, "3-turret-under-construction");
  await zoom(page, -3);

  await focusOn(page, enemy.x, enemy.z);
  await shot(page, "4-enemy-base");
  await clickEntity(page, "enemy-turret-left");
  await page.waitForTimeout(1_000);
  await shot(page, "4b-enemy-turret-selected");
  await clickEntity(page, "enemy-command-center");
  await page.waitForTimeout(1_000);
  await shot(page, "5-enemy-command-center-selected");

  await zoom(page, 6);
  await focusOn(page, home.x, home.z);
  await clickEntity(page, home.id);
  await page.mouse.move(5, 400);
  await shot(page, "6-command-center-close");
  await focusOn(page, enemy.x, enemy.z);
  await shot(page, "7-enemy-base-close");

  // A restart frees the first match's shared models and loads them again for the next one.
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(2_000);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.__dune77!.ready());
  await zoom(page, -6);
  await focusOn(page, enemy.x, enemy.z);
  await shot(page, "8-enemy-base-after-restart");
});
