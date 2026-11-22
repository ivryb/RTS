import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  clickEntity, clickWorld, dragSelectUnits, openGame, screenPoint, snapshot, waitForSnapshot, type MatchSnapshot,
} from "../helpers";

/**
 * Regression capture of every ground marker in docs/ground_markers.md, at the default camera and
 * in the full render: the placement cursor (valid and blocked, both buildings), and the selection
 * of a building, a Titanium Deposit, an enemy unit and building, a squad, a crowd of 24 in its
 * tightest formation, an army with every unit size, and each vehicle alone.
 * Writes art/workbench/verify/ground-markers/<state>.jpg. Run it on main and on a branch and compare.
 */
const evidenceDir = "art/workbench/verify/ground-markers";
const WIDE = { width: 900, height: 600 };
const CLOSE = { width: 600, height: 400 };
/** One vehicle and the sand around it. */
const LONE = { width: 360, height: 240 };

type Ground = { x: number; z: number };

const look = (page: Page, { x, z }: Ground) =>
  page.evaluate(([viewX, viewZ]) => window.__dune77!.view(viewX, viewZ, 1), [x, z] as const);

const shoot = async (page: Page, name: string, centre: Ground, crop = WIDE) => {
  // Park the pointer, so no hover state lands in the picture.
  await page.mouse.move(5, 500);
  await shootUnderPointer(page, name, centre, crop);
};

const shootUnderPointer = async (page: Page, name: string, centre: Ground, crop = WIDE) => {
  // A full-render frame takes about half a second on Boat; let a few land after the last input.
  await page.waitForTimeout(2500);
  const middle = await screenPoint(page, centre.x, centre.z, 0.8);
  await page.screenshot({
    path: `${evidenceDir}/${name}.jpg`,
    type: "jpeg",
    quality: 92,
    clip: { x: middle.x - crop.width / 2, y: middle.y - crop.height / 2, ...crop },
    timeout: 120_000,
  });
};

const localIds = (snap: MatchSnapshot) =>
  snap.units.filter((unit) => unit.ownerId === "local-player").map((unit) => unit.id);

const centreOf = (points: readonly Ground[]): Ground => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
});

/**
 * Centres the camera on the units and box-selects them, failing at once if any is left out.
 * One unit is clicked: a box round a single unit is drawn at its feet and misses a hovering hull.
 */
const selectAll = async (page: Page, ids: string[]) => {
  const units = (await snapshot(page)).units.filter((unit) => ids.includes(unit.id));
  const centre = centreOf(units);
  await look(page, centre);
  await page.keyboard.press("Escape");
  await (ids.length === 1 ? clickEntity(page, ids[0]!) : dragSelectUnits(page, ids));
  const { unitIds } = (await snapshot(page)).selected;
  const missed = ids.filter((id) => !unitIds.includes(id));
  if (missed.length) throw new Error(`selectAll: left out [${missed}]`);
  return centre;
};

/** Walks the units onto open sand, selects them again and returns the middle of where they stand. */
const gatherAt = async (page: Page, ids: string[], to: Ground, reach: number) => {
  await selectAll(page, ids);
  await clickWorld(page, to.x, to.z, { y: 0, button: "right" });
  await waitForSnapshot(page, (snap) => ids.every((id) => {
    const unit = snap.units.find((candidate) => candidate.id === id)!;
    return !unit.moving && Math.hypot(unit.x - to.x, unit.z - to.z) < reach;
  }), 180_000);
  return selectAll(page, ids);
};

test("ground-markers", async ({ page }) => {
  test.setTimeout(1_200_000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openGame(page, 77, { render: "full" });

  const snap = await snapshot(page);
  const base = snap.buildings.find((b) => b.kind === "command-center" && b.ownerId === "local-player")!;
  const deposit = [...snap.titaniumDeposits]
    .sort((a, b) => Math.hypot(a.x - base.x, a.z - base.z) - Math.hypot(b.x - base.x, b.z - base.z))[0]!;
  const local = localIds(snap);
  const scout = snap.units.find((unit) => unit.kind === "scout-drone" && unit.ownerId === "local-player")!;

  // Placement, from the Scout Drone's build menu: open sand, then ground a deposit takes up.
  const spots = {
    valid: { x: base.x + 14, z: base.z - 6 },
    blocked: { x: deposit.x + (base.x - deposit.x) * 0.25, z: deposit.z + (base.z - deposit.z) * 0.25 },
  };
  for (const [kind, crop] of [["command-center", WIDE], ["turret", CLOSE]] as const) {
    await look(page, scout);
    await clickEntity(page, scout.id);
    await page.click('[data-action="build"]');
    await page.click(`[data-build-kind="${kind}"]`);
    for (const [state, spot] of Object.entries(spots)) {
      await look(page, spot);
      const point = await screenPoint(page, spot.x, spot.z);
      await page.mouse.move(point.x - 3, point.y);
      await page.mouse.move(point.x, point.y);
      await shootUnderPointer(page, `place-${kind}-${state}`, spot, crop);
    }
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }

  await look(page, base);
  await clickEntity(page, base.id);
  await shoot(page, "building", base);

  await look(page, deposit);
  const depositPoint = await screenPoint(page, deposit.x, deposit.z, 0.6);
  await page.mouse.click(depositPoint.x, depositPoint.y);
  await shoot(page, "deposit", deposit);

  const enemies = [
    ["enemy-unit", snap.units.find((unit) => unit.ownerId !== "local-player" && unit.kind === "ghostrunner")!],
    ["enemy-building", snap.buildings.find((b) => b.ownerId !== "local-player" && b.kind === "command-center")!],
  ] as const;
  for (const [name, enemy] of enemies) {
    await look(page, enemy);
    await clickEntity(page, enemy.id);
    await shoot(page, name, enemy);
  }

  // The squad starts behind the Command Center.
  const open = { x: base.x + 12, z: base.z - 4 };
  await shoot(page, "units", await gatherAt(page, local, open, 4), CLOSE);

  /** Queues the units at the Command Center, five to a queue, and waits until they stand at its rally point. */
  const train = async (recruits: readonly string[]) => {
    await look(page, base);
    for (let trained = 0; trained < recruits.length; trained += 5) {
      const batch = recruits.slice(trained, trained + 5);
      const expected = localIds(await snapshot(page)).length + batch.length;
      await clickEntity(page, base.id);
      for (const kind of batch) await page.click(`[data-train-kind="${kind}"]`);
      await waitForSnapshot(page, (now) => localIds(now).length >= expected, 120_000);
    }
    const settled = await waitForSnapshot(page, (now) =>
      now.units.every((unit) => unit.ownerId !== "local-player" || !unit.moving), 120_000);
    return localIds(settled);
  };

  // A crowd in its tightest formation: 20 more Ghostrunners.
  const field = { x: base.x + 16, z: base.z - 2 };
  const crowd = await train(Array.from({ length: 20 }, () => "ghostrunner"));
  await shoot(page, "crowd", await gatherAt(page, crowd, field, 12), CLOSE);

  // Every unit size in one selection.
  const army = await train(["hornet", "behemoth"]);
  await shoot(page, "army", await gatherAt(page, army, field, 14), CLOSE);

  // Each vehicle alone, on the open sand in front of the Command Center.
  const gathered = (await snapshot(page)).units.filter((unit) => army.includes(unit.id));
  for (const [kind, sand] of [
    ["hornet", { x: base.x - 1, z: base.z + 19 }],
    ["behemoth", { x: base.x + 10, z: base.z + 13 }],
  ] as const) {
    const vehicle = gathered.find((unit) => unit.kind === kind)!;
    const stand = await gatherAt(page, [vehicle.id], sand, 2);
    // The destination flag stays for 0.7 s of game time, 14 frames, which take Boat about 7 s:
    // longer than these short trips.
    await page.waitForTimeout(8000);
    await shoot(page, kind, stand, LONE);
  }
});
