import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const outputDirectory = "art/workbench/renders/previews";
const renderedSeeds = [77, 1234, 2026] as const;

mkdirSync(outputDirectory, { recursive: true });

test("switches between the 2D and rendered previews", async ({ page }) => {
  await page.goto("/prototypes/terrain-topology/?view=2d&seed=77&players=2");
  const planButton = page.getByRole("tab", { name: "2D plan" });
  const renderedButton = page.getByRole("tab", { name: "Rendered terrain" });

  await expect(page.locator("#terrain-2d")).toBeVisible();
  await expect(page.locator("#terrain-rendered")).toBeHidden();
  await expect(planButton).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#terrain-plan .node")).toHaveCount(26);
  await expect(page.locator("#terrain-plan .plan-route").first()).toBeVisible();

  await renderedButton.click();
  await expect(page.locator("#terrain-rendered")).toBeVisible();
  await expect(renderedButton).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/view=rendered/);

  await planButton.click();
  await expect(page.locator("#terrain-2d")).toBeVisible();
  await expect(planButton).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/view=2d/);
});

test("uses the documented default seed", async ({ page }) => {
  await page.goto("/prototypes/terrain-topology/?view=2d");
  await expect(page.locator("#seed")).toHaveValue("77");
  await expect(page.locator("#map-summary")).toContainText("Seed 77");
});

test("capture the 2D terrain plan", async ({ page }) => {
  const started = Date.now();
  await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
  await page.goto("/prototypes/terrain-topology/?view=2d&seed=77&players=2");
  await page.waitForFunction(() => window.__terrainPreviewReady === true);
  await page.screenshot({
    path: `${outputDirectory}/terrain-topology-2d-seed-77.jpg`,
    type: "jpeg",
    quality: 90,
  });
  console.log(`2D terrain plan: ${Date.now() - started}ms`);
});

for (const seed of renderedSeeds) {
  test(`capture rendered terrain seed ${seed}`, async ({ page }) => {
    const started = Date.now();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
    await page.goto(
      `/prototypes/terrain-topology/?view=rendered&seed=${seed}&players=2`,
    );
    await page.waitForFunction(() => window.__terrainPreviewReady === true);
    await expect(page.locator("#map-summary")).toContainText(`Seed ${seed}`);
    await expect.poll(() => page.locator("#terrain-rendered").evaluate((canvas) => canvas.width))
      .toBeGreaterThan(1);
    expect(pageErrors).toEqual([]);
    await page.screenshot({
      path: `${outputDirectory}/terrain-topology-rendered-seed-${seed}.jpg`,
      type: "jpeg",
      quality: 90,
    });
    console.log(`rendered terrain seed ${seed}: ${Date.now() - started}ms`);
  });
}
