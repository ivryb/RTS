import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { states } from "./states";
const output = "art/workbench/renders/ui-review";
mkdirSync(output, { recursive: true });
for (const state of states) {
  test(state, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tools/ui-review/?frame=1&state=${state}`);
    await expect(page.locator("html")).toHaveAttribute("data-review-ready", state);
    await page.screenshot({ path: `${output}/${state}.jpg`, type: "jpeg", quality: 85 });
    const buttons = page.locator(".action-grid button:visible");
    for (const button of await buttons.all()) {
      expect(await button.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
test.afterAll(() => {
  writeFileSync(`${output}/index.html`, `<!doctype html><title>Dune77 UI snapshots</title><style>body{background:#222;color:#eee;font:16px system-ui}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(480px,1fr));gap:20px}img{width:100%}a{color:inherit}</style><h1>Dune77 UI states</h1><main>${states.map((state) => `<article><h2>${state}</h2><a href="${state}.jpg"><img src="${state}.jpg" loading="lazy"></a></article>`).join("")}</main>`);
});
