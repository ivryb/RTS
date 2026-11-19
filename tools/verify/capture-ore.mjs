// Captures Titanium Deposits in the live game at gameplay and close zoom.
// Usage: bun tools/verify/capture-ore.mjs --out <dir> [--model <glb>] [--titanium 0] [--seed 77] [--deposits 0,6,20] [--mine 0] [--base http://localhost:5173]
// --model serves one candidate GLB in place of every production titanium model, without touching assets/.
// --titanium starts every deposit at that amount; 0 shows them all depleted.
// --mine sends the player's Scout Drone to that deposit through real clicks and captures it at work.
// On seed 77, deposit 0 sits on sand beside the player's base, 6 among scree rocks and 20 in dry grass.
// A deposit's variant is its index modulo three, so 0, 6 and 20 show two of the three; --model shows any.
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { chromiumArgs } from "../chromium.ts";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string" },
    titanium: { type: "string" },
    seed: { type: "string", default: "77" },
    deposits: { type: "string", default: "0,6,20" },
    mine: { type: "string" },
    base: { type: "string", default: "http://localhost:5173" },
  },
});
if (!values.out) throw new Error("--out <dir> is required");
mkdirSync(values.out, { recursive: true });

const views = [["gameplay", 1], ["close", 2.6]];
const browser = await chromium.launch({ args: chromiumArgs });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const files = [];
  page.on("pageerror", error => errors.push(String(error)));
  if (values.model) await page.route(/titanium-deposit-\d+\.glb/, route => route.fulfill({ path: values.model, contentType: "model/gltf-binary" }));
  const amount = values.titanium === undefined ? "" : `&titanium=${values.titanium}`;
  await page.goto(`${values.base}/?seed=${values.seed}&verify=1${amount}`, { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__dune77?.inspect()?.titaniumDeposits.length), undefined, { timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.__dune77.ready());
  const inspect = () => page.evaluate(() => window.__dune77.inspect());
  const project = (x, z, y) => page.evaluate(([x, z, y]) => window.__dune77.project(x, z, y), [x, z, y]);
  const deposits = (await inspect()).titaniumDeposits;
  const capture = async (deposit, prefix, before = async () => {}) => {
    for (const [name, zoom] of views) {
      await page.evaluate(([x, z, zoom]) => window.__dune77.view(x, z, zoom), [deposit.x, deposit.z, zoom]);
      // Boat renders two to three frames a second; wait for the moved camera and its shadows to draw.
      await page.waitForTimeout(1200);
      await before();
      const file = `${values.out}/${prefix}-${name}.png`;
      await page.screenshot({ path: file, timeout: 120_000 });
      files.push(file);
    }
  };
  for (const index of values.deposits.split(",").filter(Boolean).map(Number)) {
    if (deposits[index]) await capture(deposits[index], `deposit-${index}`);
  }
  const mined = values.mine === undefined ? undefined : deposits[Number(values.mine)];
  if (mined) {
    const scout = (await inspect()).units.find(unit => unit.kind === "scout-drone" && unit.ownerId === "local-player");
    await page.evaluate(([x, z]) => window.__dune77.view(x, z, 1), [(scout.x + mined.x) / 2, (scout.z + mined.z) / 2]);
    await page.waitForTimeout(1200);
    const from = await project(scout.x, scout.z, 1.1);
    await page.mouse.click(from.x, from.y);
    // A click lands only where the ray meets the rock itself, so try a few heights over its center.
    for (const height of [1, 0.4, 2, 3]) {
      const to = await project(mined.x, mined.z, height);
      await page.mouse.click(to.x, to.y, { button: "right" });
      await page.waitForTimeout(600);
      if ((await inspect()).units.find(unit => unit.id === scout.id)?.harvest) break;
    }
    // A Scout fills up in a few seconds and leaves, so each shot waits for the start of a fresh load,
    // then for Boat's slow frames to catch up with the simulation.
    const loading = limit => page.evaluate(([id, limit]) => {
      const unit = window.__dune77.inspect().units.find(unit => unit.id === id);
      return unit?.harvest?.phase === "extracting" && unit.cargoTitanium <= limit;
    }, [scout.id, limit]);
    await capture(mined, `mining-${values.mine}`, async () => {
      for (let attempt = 0; attempt < 12; attempt++) {
        while (!await loading(2)) await page.waitForTimeout(200);
        await page.waitForTimeout(1000);
        if (await loading(12)) return;
      }
    });
  }
  console.log(JSON.stringify({ ok: errors.length === 0, deposits: deposits.length, files, errors }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
