import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { clickEntity, clickWorld, openGame, screenPoint, snapshot, waitForSnapshot, type MatchSnapshot } from "../helpers";

const evidenceDir = "art/workbench/verify/titanium-deposit";
const scoutId = "scout-drone-1";
const scoutIn = (snap: MatchSnapshot) => snap.units.find((unit) => unit.id === scoutId)!;

test("a Titanium Deposit that a Scout Drone mines out turns into its depleted rock", async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true });
  // Full render: the stills are the evidence of how the two states look. 24 Titanium is two trips.
  await openGame(page, 77, { render: "full", titanium: 24 });
  const opening = await snapshot(page);
  const home = scoutIn(opening);
  const nearest = [...opening.titaniumDeposits].sort((a, b) =>
    Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0]!;
  const depositIn = (snap: MatchSnapshot) => snap.titaniumDeposits.find((deposit) => deposit.id === nearest.id)!;
  expect(opening.titaniumDeposits.every((deposit) => deposit.shown === "full")).toBe(true);

  // Order: select the Scout, then right-click the rock. The ray has to meet the model, so try a few heights.
  await page.evaluate(([x, z]) => window.__dune77!.view(x, z, 1), [nearest.x, nearest.z] as const);
  await clickEntity(page, scoutId);
  for (const height of [1.2, 0.5, 2]) {
    await clickWorld(page, nearest.x, nearest.z, { y: height, button: "right" });
    if (await waitForSnapshot(page, (snap) => scoutIn(snap).order === "gather", 4_000).then(() => true, () => false)) break;
  }
  await waitForSnapshot(page, (snap) => Boolean(scoutIn(snap).miningLaser), 90_000);
  expect(depositIn(await snapshot(page)).shown).toBe("full");
  await page.screenshot({ path: `${evidenceDir}/game-full-mined.png`, timeout: 120_000 });

  // The Scout empties the deposit on its second trip. The rock stays, as its depleted model.
  const emptied = await waitForSnapshot(page, (snap) => depositIn(snap).amount === 0 && depositIn(snap).shown === "depleted", 180_000);
  expect(emptied.titaniumDeposits.filter((deposit) => deposit.shown === "depleted").map((deposit) => deposit.id)).toEqual([nearest.id]);
  await waitForSnapshot(page, (snap) => !scoutIn(snap).miningLaser);
  // Boat draws two to three frames a second; let the swapped model and its shadow reach the screen.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${evidenceDir}/game-depleted.png`, timeout: 120_000 });
  await page.evaluate(([x, z]) => window.__dune77!.view(x, z, 2.6), [nearest.x, nearest.z] as const);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${evidenceDir}/game-depleted-close.png`, timeout: 120_000 });

  // The mined-out rock is still a deposit the player can select, and the panel says it is spent.
  for (const height of [1.2, 0.5, 2]) {
    const point = await screenPoint(page, nearest.x, nearest.z, height);
    await page.mouse.click(point.x, point.y);
    if ((await snapshot(page)).selected.depositIds.includes(nearest.id)) break;
  }
  expect((await snapshot(page)).selected.depositIds).toEqual([nearest.id]);
  await expect(page.getByText("Deposit exhausted")).toBeVisible();
});
