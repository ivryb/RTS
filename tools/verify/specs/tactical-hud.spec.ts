import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { clickEntity, minimapPoint, openGame, screenPoint, snapshot, waitForSnapshot } from '../helpers';

const evidence = 'art/workbench/verify/hud';

test('minimap navigates without changing zoom and ignores its outside corners', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGame(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await clickEntity(page, 'local-command-center');
  const gridSize = await page.locator('.action-grid').evaluate((grid) => {
    const style = getComputedStyle(grid);
    return [style.gridTemplateColumns.split(' ').length, style.gridTemplateRows.split(' ').length];
  });
  expect(gridSize).toEqual([4, 3]);
  await expect(page.locator('.building-card img')).toHaveAttribute('src', /command-center-portrait/);
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/command-center.jpg`, type: 'jpeg', quality: 90 });
  const zoom = await page.locator('#zoom-level').textContent();
  const map = page.locator('#minimap');
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
  const centered = await screenPoint(page, 0, 0);
  expect(Math.abs(centered.x - 720)).toBeLessThanOrEqual(2);
  expect(await page.locator('#zoom-level').textContent()).toBe(zoom);
  await map.click({ position: { x: 2, y: 2 } });
  expect(await screenPoint(page, 0, 0)).toEqual(centered);
  await map.focus();
  await page.keyboard.press('ArrowRight');
  const panned = await screenPoint(page, 0, 0);
  expect(panned.x).toBeLessThan(centered.x);
  expect(await page.locator('#zoom-level').textContent()).toBe(zoom);
  await page.screenshot({ path: `${evidence}/minimap-navigation.jpg`, type: 'jpeg', quality: 90 });
  await page.setViewportSize({ width: 640, height: 720 });
  expect(await page.locator('.action-grid').evaluate((grid) => {
    const style = getComputedStyle(grid);
    return [style.gridTemplateColumns.split(' ').length, style.gridTemplateRows.split(' ').length];
  })).toEqual([4, 3]);
  const panel = (await page.locator('#unit-panel').boundingBox())!;
  const minimap = (await page.locator('.minimap-panel').boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(640);
  expect(minimap.y + minimap.height).toBeLessThanOrEqual(panel.y);
  await page.screenshot({ path: `${evidence}/compact.jpg`, type: 'jpeg', quality: 90 });
  expect(errors).toEqual([]);
});


test('right-clicking the minimap moves the selected unit to that world location', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGame(page);
  await clickEntity(page, 'ghostrunner-1');
  const unit = (await snapshot(page)).units.find((unit) => unit.id === 'ghostrunner-1')!;
  const target = { x: unit.x - 10, z: unit.z + 10 };
  const point = await minimapPoint(page, target.x, target.z);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await waitForSnapshot(page, (state) => {
    const moved = state.units.find((unit) => unit.id === 'ghostrunner-1')!;
    return !moved.moving && Math.hypot(moved.x - target.x, moved.z - target.z) < 1;
  });
});


test('enemy selection shows inspection without command buttons or targeting hotkeys', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGame(page);
  const enemy = (await snapshot(page)).units.find((unit) => unit.ownerId !== 'local-player')!;
  const point = await minimapPoint(page, enemy.x, enemy.z);
  await page.mouse.click(point.x, point.y);
  await clickEntity(page, enemy.id);
  await expect(page.locator('#unit-panel')).toBeVisible();
  await expect(page.locator('.action-grid')).toBeHidden();
  await page.keyboard.press('a');
  await expect(page.locator('#game')).not.toHaveClass(/is-targeting/);
  await page.keyboard.press('m');
  await expect(page.locator('#game')).not.toHaveClass(/is-targeting/);
  await page.screenshot({ path: `${evidence}/enemy-inspection.jpg`, type: 'jpeg', quality: 90 });
});
