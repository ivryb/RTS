import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { clickEntity, clickWorld, dragSelectUnits, screenPoint, snapshot, waitForSnapshot } from "../helpers";

/**
 * D77-16 design sketch: captures every ground marker of one option at the default camera.
 * `MARKERS=a bunx playwright test ... --grep marker-sketch`; without MARKERS it captures today's.
 * Writes art/workbench/verify/markers/<option>/{place-valid,place-blocked,building,deposit,units}.jpg.
 */
const option = process.env.MARKERS ?? "current";
const evidenceDir = `art/workbench/verify/markers/${option}`;
const CROP = { width: 900, height: 600 };

const look = (page: Page, x: number, z: number) =>
  page.evaluate(([viewX, viewZ]) => window.__dune77!.view(viewX, viewZ, 1), [x, z] as const);

const shoot = async (page: Page, name: string, x: number, z: number, crop = CROP) => {
  // A full-render frame takes about half a second on Boat; let a few land after the last input.
  await page.waitForTimeout(2500);
  const centre = await screenPoint(page, x, z, 0.8);
  await page.screenshot({
    path: `${evidenceDir}/${name}.jpg`,
    type: "jpeg",
    quality: 92,
    clip: { x: centre.x - crop.width / 2, y: centre.y - crop.height / 2, ...crop },
    timeout: 120_000,
  });
};

test("marker-sketch", async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  const query = new URLSearchParams({ seed: "77", verify: "1" });
  if (option !== "current") query.set("markers", option);
  await page.goto(`./?${query}`);
  await page.waitForFunction(() => Boolean(window.__dune77?.inspect()?.units.length));
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.__dune77!.ready());

  const snap = await snapshot(page);
  const base = snap.buildings.find((b) => b.kind === "command-center" && b.ownerId === "local-player")!;
  const deposit = [...snap.titaniumDeposits]
    .sort((a, b) => Math.hypot(a.x - base.x, a.z - base.z) - Math.hypot(b.x - base.x, b.z - base.z))[0]!;
  const runners = snap.units.filter((u) => u.kind === "ghostrunner" && u.ownerId === "local-player");
  const scout = snap.units.find((u) => u.kind === "scout-drone" && u.ownerId === "local-player")!;
  console.log(JSON.stringify({ base, deposit, runners: runners.map((u) => [u.id, u.x, u.z]), scout: [scout.x, scout.z] }));

  // Placement: the Scout Drone's build menu, the Command Center, hovered at two spots.
  const spots = {
    valid: { x: Number(process.env.VALID_X ?? base.x + 14), z: Number(process.env.VALID_Z ?? base.z - 6) },
    blocked: { x: deposit.x + (base.x - deposit.x) * 0.25, z: deposit.z + (base.z - deposit.z) * 0.25 },
  };
  await look(page, scout.x, scout.z);
  await clickEntity(page, scout.id);
  await page.click('[data-action="build"]');
  await page.click('[data-build-kind="command-center"]');
  for (const [name, spot] of Object.entries(spots)) {
    await look(page, spot.x, spot.z);
    const point = await screenPoint(page, spot.x, spot.z);
    await page.mouse.move(point.x - 3, point.y);
    await page.mouse.move(point.x, point.y);
    await shoot(page, `place-${name}`, spot.x, spot.z);
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await look(page, base.x, base.z);
  await clickEntity(page, base.id);
  await page.mouse.move(5, 500);
  await shoot(page, "building", base.x, base.z);

  await look(page, deposit.x, deposit.z);
  const depositPoint = await screenPoint(page, deposit.x, deposit.z, 0.6);
  await page.mouse.click(depositPoint.x, depositPoint.y);
  await page.mouse.move(5, 500);
  await shoot(page, "deposit", deposit.x, deposit.z);

  // The squad starts behind the Command Center; walk it onto open sand first.
  const ids = [...runners.map((u) => u.id), scout.id];
  await look(page, base.x, base.z);
  await dragSelectUnits(page, ids);
  const open = { x: base.x + 12, z: base.z - 4 };
  await clickWorld(page, open.x, open.z, { y: 0, button: "right" });
  await waitForSnapshot(page, (s) => ids.every((id) => {
    const unit = s.units.find((u) => u.id === id)!;
    return !unit.moving && Math.hypot(unit.x - open.x, unit.z - open.z) < 4;
  }), 120_000);
  const moved = (await snapshot(page)).units.filter((u) => ids.includes(u.id));
  const cx = moved.reduce((sum, u) => sum + u.x, 0) / moved.length;
  const cz = moved.reduce((sum, u) => sum + u.z, 0) / moved.length;
  await look(page, cx, cz);
  await page.keyboard.press("Escape");
  await dragSelectUnits(page, ids);
  await page.mouse.move(5, 500);
  await shoot(page, "units", cx, cz, { width: 600, height: 400 });
  console.log(JSON.stringify((await snapshot(page)).selected));
});
