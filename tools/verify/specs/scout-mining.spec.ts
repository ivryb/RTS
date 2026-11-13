import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { clickEntity, clickWorld, openGame, snapshot, waitForSnapshot, type MatchSnapshot } from "../helpers";

const evidenceDir = "art/workbench/verify/mining-laser";
const scoutId = "scout-drone-1";
const scoutIn = (snap: MatchSnapshot) => snap.units.find((unit) => unit.id === scoutId)!;

test("a mining Scout Drone fires a laser at the rock, and stops it to haul or on a new order", async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true });
  await openGame(page, 77);
  const opening = await snapshot(page);
  const home = scoutIn(opening);
  const deposit = [...opening.titaniumDeposits].sort((a, b) =>
    Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0]!;

  // Order: select the Scout, then right-click the rock. The ray has to meet the model, so try a few heights.
  await page.evaluate(([x, z]) => window.__dune77!.view(x, z, 1), [deposit.x, deposit.z] as const);
  await clickEntity(page, scoutId);
  const gathering = (snap: MatchSnapshot) => scoutIn(snap).order === "gather";
  for (const height of [1.2, 0.5, 2]) {
    await clickWorld(page, deposit.x, deposit.z, { y: height, button: "right" });
    // The order reaches the simulation worker and comes back a few frames later.
    if (await waitForSnapshot(page, gathering, 4_000).then(() => true, () => false)) break;
  }
  expect(scoutIn(await snapshot(page)).order).toBe("gather");
  expect(scoutIn(await snapshot(page)).miningLaser).toBeUndefined();

  // Mining: the beam runs from the drone's nose to a point on the rock, inside its footprint.
  const mining = scoutIn(await waitForSnapshot(page, (snap) => Boolean(scoutIn(snap).miningLaser), 90_000));
  const beam = mining.miningLaser!;
  expect(mining.harvest?.phase).toBe("extracting");
  expect(Math.hypot(beam.from[0] - mining.x, beam.from[2] - mining.z)).toBeLessThan(0.7);
  expect(Math.hypot(beam.to[0] - deposit.x, beam.to[2] - deposit.z)).toBeLessThan(deposit.radius / 1000);
  await page.screenshot({ path: `${evidenceDir}/game-mining-default-zoom.png`, timeout: 120_000 });
  await page.evaluate(([x, z]) => window.__dune77!.view(x, z, 0.6), [deposit.x, deposit.z] as const);
  await page.screenshot({ path: `${evidenceDir}/game-mining-farthest-zoom.png`, timeout: 120_000 });

  // Hauling: a full Scout leaves for the Command Center with its cargo bin and no beam.
  const hauling = scoutIn(await waitForSnapshot(page, (snap) => scoutIn(snap).harvest?.phase === "to-dropoff", 60_000));
  expect(hauling.cargoTitanium).toBeGreaterThan(0);
  expect(scoutIn(await waitForSnapshot(page, (snap) => !scoutIn(snap).miningLaser)).miningLaser).toBeUndefined();
  await page.evaluate(([x, z]) => window.__dune77!.view(x, z, 3), [mining.x, mining.z] as const);
  await page.screenshot({ path: `${evidenceDir}/game-hauling.png`, timeout: 120_000 });

  // Second trip, closest zoom, then a move order while the beam is on.
  const contacts: number[] = [];
  await waitForSnapshot(page, (snap) => Boolean(scoutIn(snap).miningLaser), 90_000);
  await page.screenshot({ path: `${evidenceDir}/game-mining-closest-zoom.png`, timeout: 120_000 });
  for (let sample = 0; sample < 6; sample += 1) {
    const laser = scoutIn(await snapshot(page)).miningLaser;
    if (laser) contacts.push(laser.to[1]);
    await page.waitForTimeout(250);
  }
  // Open ground a few metres straight back from the rock, still on screen at this zoom.
  const back = 3 / Math.hypot(mining.x - deposit.x, mining.z - deposit.z);
  await clickWorld(page, mining.x + (mining.x - deposit.x) * back, mining.z + (mining.z - deposit.z) * back, { button: "right" });
  const moved = scoutIn(await waitForSnapshot(page, (snap) => scoutIn(snap).order === "move"));
  expect(moved.harvest).toBeUndefined();
  expect(scoutIn(await waitForSnapshot(page, (snap) => !scoutIn(snap).miningLaser)).miningLaser).toBeUndefined();
  await page.screenshot({ path: `${evidenceDir}/game-new-order.png`, timeout: 120_000 });
  writeFileSync(`${evidenceDir}/game-run.json`, `${JSON.stringify({ seed: 77, deposit: deposit.id, beam, contactHeights: contacts }, null, 2)}\n`);
});
