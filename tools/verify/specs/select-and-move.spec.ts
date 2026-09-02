import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { clickWorld, dragSelectUnits, openGame, waitForSnapshot } from "../helpers";

const evidenceDir = "art/workbench/verify/select-and-move";

test("drag-select Ghostrunners and right-click move them", async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true });
  await openGame(page, 77);

  const runnerIds = ["ghostrunner-1", "ghostrunner-2", "ghostrunner-3"];
  await dragSelectUnits(page, runnerIds);
  const selected = await waitForSnapshot(page, (snap) =>
    snap.selected.unitIds.length === runnerIds.length);
  expect([...selected.selected.unitIds].sort()).toEqual([...runnerIds].sort());
  await page.screenshot({ path: `${evidenceDir}/selected.jpg`, type: "jpeg", quality: 90 });

  const start = await waitForSnapshot(page, (snap) =>
    runnerIds.every((id) => snap.units.find((unit) => unit.id === id)));
  const centerX = runnerIds.reduce(
    (total, id) => total + start.units.find((unit) => unit.id === id)!.x, 0,
  ) / runnerIds.length;
  const centerZ = runnerIds.reduce(
    (total, id) => total + start.units.find((unit) => unit.id === id)!.z, 0,
  ) / runnerIds.length;
  const destination = { x: centerX - 10, z: centerZ + 10 };
  await clickWorld(page, destination.x, destination.z, { button: "right" });
  await waitForSnapshot(page, (snap) =>
    runnerIds.every((id) => {
      const moved = snap.units.find((unit) => unit.id === id)!;
      return !moved.moving
        && Math.hypot(moved.x - destination.x, moved.z - destination.z) < 2;
    }), 30_000);
  await page.screenshot({ path: `${evidenceDir}/arrived.jpg`, type: "jpeg", quality: 90 });
});
