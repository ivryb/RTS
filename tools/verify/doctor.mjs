// Read-only health check for a running Dune77 dev server.
// Usage: node tools/verify/doctor.mjs [baseURL]   (default http://localhost:5173)
// Exits 0 and prints a JSON status when the page loads, the game boots, and the
// ?verify=1 observation hook responds; exits 1 otherwise.
import { chromium } from "@playwright/test";

const baseURL = process.argv[2] ?? "http://localhost:5173";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${baseURL}/?seed=77&verify=1`, { timeout: 15_000 });
  await page.waitForFunction(
    () => Boolean(window.__dune77?.inspect()?.units.length),
    undefined,
    { timeout: 30_000 },
  );
  const status = await page.evaluate(() => {
    const snap = window.__dune77.inspect();
    return {
      ok: true,
      seed: document.querySelector("#seed")?.textContent ?? null,
      zoom: document.querySelector("#zoom-level")?.textContent ?? null,
      units: snap.units.length,
      buildings: snap.buildings.length,
      tick: snap.tick,
    };
  });
  console.log(JSON.stringify(status));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error).split("\n")[0] }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
