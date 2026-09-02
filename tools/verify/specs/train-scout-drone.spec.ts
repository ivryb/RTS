import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { clickEntity, openGame, waitForSnapshot } from "../helpers";

const evidenceDir = "art/workbench/verify/train-scout-drone";

test("train a Scout Drone from the Command Center", async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true });
  await openGame(page, 77);
  await waitForSnapshot(page, (snap) =>
    snap.buildings.some((building) => building.id === "local-command-center"));

  await clickEntity(page, "local-command-center");
  await page.click('[data-train-kind="scout-drone"]');
  await waitForSnapshot(page, (snap) =>
    (snap.buildings.find((building) => building.id === "local-command-center")
      ?.productionQueue?.length ?? 0) > 0);
  await page.screenshot({ path: `${evidenceDir}/queued.jpg`, type: "jpeg", quality: 90 });

  const spawned = await waitForSnapshot(page, (snap) =>
    snap.units.some((unit) => unit.ownerId === "local-player"
      && unit.kind === "scout-drone"), 30_000);
  expect(spawned.outcome).toBeUndefined();
  await page.screenshot({ path: `${evidenceDir}/drone-trained.jpg`, type: "jpeg", quality: 90 });
});
