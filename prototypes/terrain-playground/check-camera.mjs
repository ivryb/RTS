import { chromium } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Reuse Vite and exercise actual input against the same controller as the game.
const output = resolve('art/workbench/renders/terrain-playground/camera-checks');
mkdirSync(output, { recursive: true });
const run = mkdtempSync(`${output}/game-`);
const browser = await chromium.launch({ headless: true, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] });
const errors = [];
const checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const ready = () => page.waitForFunction(() => document.body.dataset.ready === 'true', undefined, { timeout: 90000 });
  const inspect = () => page.evaluate(() => window.terrainProfiler.inspect());
  const shot = name => page.screenshot({ path: `${run}/${name}.png` });
  await page.goto('http://localhost:5173/prototypes/terrain-playground/?variant=new&seed=56204&players=4');
  await ready();
  assert.equal((await inspect()).projection, 'OrthographicCamera');
  assert.equal((await page.locator('#camera-zoom').textContent()), '1.00×');
  await shot('default');
  checks.push('Defaults to the game orthographic camera at 1.00×');

  await page.mouse.move(700, 420);
  for (const [delta, zoom, label, name] of [[50000, .78, '0.60×', 'wide'], [-50000, 3.9, '3.00×', 'close']]) {
    await page.mouse.wheel(0, delta);
    await page.waitForFunction(label => document.querySelector('#camera-zoom').textContent === label, label);
    assert.ok(Math.abs((await inspect()).zoom - zoom) < 1e-12);
    await shot(name);
  }
  checks.push('Real wheel input clamps to the production 0.60×–3.00× range');

  let before = await inspect();
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(790, 450, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  assert.notDeepEqual((await inspect()).view.target, before.view.target);
  for (const key of ['w', 'ArrowLeft']) {
    before = await inspect();
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(target => JSON.stringify(window.terrainProfiler.inspect().view.target) !== JSON.stringify(target), before.view.target);
    } finally { await page.keyboard.up(key); }
  }
  checks.push('Middle drag, WASD and arrow keys move the game camera');

  before = await inspect();
  await page.mouse.down();
  await page.mouse.move(850, 490, { steps: 4 });
  await page.mouse.up();
  assert.deepEqual((await inspect()).view, before.view);
  for (const variant of ['old', 'new']) {
    await page.locator(`[data-terrain="${variant}"]`).click();
    await ready();
    assert.deepEqual((await inspect()).view.target, before.view.target);
    assert.equal((await inspect()).zoom, before.zoom);
  }
  checks.push('Left drag does not orbit; Old/New switching preserves focus and zoom');

  await page.locator('#camera').click();
  assert.equal(await page.locator('#camera-zoom').textContent(), '1.00×');
  // Let a pending input redraw settle, then prove idle rAF does no GPU work.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const frame = (await inspect()).draw.frame;
  await page.waitForTimeout(100);
  assert.equal((await inspect()).draw.frame, frame);
  checks.push('Reset restores default zoom; the idle camera does not continuously render');

  await page.locator('#camera-mode').selectOption('inspect');
  await page.waitForURL('**camera=inspect**');
  await ready();
  assert.equal((await inspect()).projection, 'PerspectiveCamera');
  const view = { position: [-160, 49, 96], target: [-130, 22, 61] };
  await page.evaluate(view => window.terrainProfiler.setView(view), view);
  assert.deepEqual((await inspect()).view, view);
  assert.deepEqual((await inspect()).shaderErrors, []);
  checks.push('Free camera retains exact perspective inspection coordinates');
  assert.deepEqual(errors, []);
  writeFileSync(`${run}/verification.json`, JSON.stringify({ checks, errors }, null, 2) + '\n');
  console.log(`${checks.length} camera checks passed; captures: ${run}`);
} finally { await browser.close(); }
