// Captures Titanium Deposits in the live game at gameplay and close zoom.
// Usage: bun tools/verify/capture-ore.mjs --out <dir> [--model <glb>] [--seed 77] [--deposits 0,1] [--base http://localhost:5173]
// --model serves one candidate GLB in place of every production titanium model, without touching assets/.
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string" },
    seed: { type: "string", default: "77" },
    deposits: { type: "string", default: "0,1" },
    base: { type: "string", default: "http://localhost:5173" },
  },
});
if (!values.out) throw new Error("--out <dir> is required");
mkdirSync(values.out, { recursive: true });

const views = [["gameplay", 1], ["close", 2.6]];
const browser = await chromium.launch({ args: process.platform === "darwin" ? ["--use-angle=metal"] : [] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  if (values.model) await page.route(/titanium-[a-z-]+\.glb/, route => route.fulfill({ path: values.model, contentType: "model/gltf-binary" }));
  await page.goto(`${values.base}/?seed=${values.seed}&verify=1`, { timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__dune77?.inspect()?.titaniumDeposits.length), undefined, { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.__dune77.ready());
  const deposits = await page.evaluate(() => window.__dune77.inspect().titaniumDeposits);
  const files = [];
  for (const index of values.deposits.split(",").map(Number)) {
    const deposit = deposits[index];
    if (!deposit) continue;
    for (const [name, zoom] of views) {
      await page.evaluate(([x, z, zoom]) => window.__dune77.view(x, z, zoom), [deposit.x, deposit.z, zoom]);
      await page.waitForTimeout(600);
      const file = `${values.out}/deposit-${index}-${name}.png`;
      await page.screenshot({ path: file });
      files.push(file);
    }
  }
  console.log(JSON.stringify({ ok: errors.length === 0, deposits: deposits.length, files, errors }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
