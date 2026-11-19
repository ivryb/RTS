import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { clickWorld, dragSelectUnits, openGame, snapshot, waitForSnapshot } from "../helpers";

const evidenceDir = "art/workbench/verify/death-effects";
const RUNNERS = ["ghostrunner-1", "ghostrunner-2", "ghostrunner-3"];

test("a unit killed in the opening fight dies into a wreck without a shader compiling", async ({ page }) => {
  // The fight runs at the simulation's real pace, and Boat draws the full game slowly.
  test.setTimeout(900_000);
  mkdirSync(evidenceDir, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openGame(page, 77, { render: "full" });
  const programs = () => page.evaluate(() => window.__dune77!.programs());
  const compiled = new Set(await programs());
  // A program carries the name of the first material that compiled it: the flashes share the
  // fire's program, and the ruins' large scorch marks share the small ones'.
  expect([...new Set([...compiled].map((program) => program.split("|")[0]))]
    .filter((name) => name.startsWith("Death ")).sort()).toEqual([
    "Death fire",
    "Death scorch marks",
    "Death smoke and dust",
  ]);

  await dragSelectUnits(page, RUNNERS);
  const enemy = (await snapshot(page)).units.find((unit) => unit.id === "enemy-ghostrunner-1")!;
  // The enemy post is off screen at the start; the camera goes there, the selection stays.
  await page.evaluate(([x, z]) => window.__dune77!.view(x, z), [enemy.x, enemy.z]);
  await clickWorld(page, enemy.x, enemy.z, { button: "right" });
  await waitForSnapshot(page, (snap) => snap.units.some((unit) => RUNNERS.includes(unit.id) && unit.order !== "idle"));
  const fight = await waitForSnapshot(page, (snap) => snap.units.some((unit) => unit.health <= 0), 600_000);
  const casualty = fight.units.find((unit) => unit.health <= 0)!;
  await page.evaluate(([x, z]) => window.__dune77!.view(x, z, 2), [casualty.x, casualty.z]);

  // The game steps at most 50 ms a rendered frame, so each capture is a later moment of the death.
  for (let index = 0; index < 8; index += 1) {
    await page.screenshot({ path: `${evidenceDir}/${casualty.kind}-dying-${index}.jpg`, type: "jpeg", quality: 90, timeout: 120_000 });
  }
  await page.waitForTimeout(20_000);
  await page.screenshot({ path: `${evidenceDir}/${casualty.kind}-wreck.jpg`, type: "jpeg", quality: 90, timeout: 120_000 });

  expect(errors).toEqual([]);
  // A program that appears during play stalled a frame to compile. Every material a death draws
  // with is named, so none may appear. The shadow pass's one shared depth material has no name
  // and is left out: three.js keys its programs by light count and by the mesh it drew before,
  // and this fight compiles one or two of them with or without death effects.
  const added = (await programs()).filter((program) => !compiled.has(program));
  expect(added.filter((program) => !program.startsWith("|"))).toEqual([]);
});
