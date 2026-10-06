import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'http://localhost:5173';
const endpoint = `${origin}/prototypes/terrain-playground/`;
const { values: args } = parseArgs({ options: {
  help: { type: 'boolean', short: 'h' }, mountains: { type: 'boolean' },
  seed: { type: 'string' }, players: { type: 'string' }, variant: { type: 'string' },
  quality: { type: 'string' }, view: { type: 'string' }, baseline: { type: 'string' },
} });
if (args.help) {
  console.log(`Capture the existing terrain hub with one temporary headless browser.
Reuse Vite at ${origin}; this command never starts a server.

bun run preview:capture:mountains [options]
bun run preview:capture:terrain-hub [options]

  --seed INTEGER           Default: 56204
  --players 2|4|6|all       Default: 4 for mountains, all for terrain-hub
  --variant old|new|both   Default: new for mountains, both for terrain-hub
  --quality balanced|high Default: high; fixed for every view and variant
  --view JSON_OR_FILE      One camera: {"position":[x,y,z],"target":[x,y,z]}
  --baseline manifest.json Replay prior cameras, seed, players, quality and viewport
                           Conflicting options fail; --variant may select either version
                           Do not combine with --view
  --mountains              Overview, gameplay, close, low and opposite views
  --help, -h               Show this help without opening a browser

Terrain-hub defaults: overview, gameplay and route plan for 2/4/6 players,
plus a mobile overflow check. A custom --view replaces the default cameras.
Each run writes native device-scale PNGs, source snapshots and manifest.json
under art/workbench/renders/terrain-playground/runs/<unique-run>/.
Runs are unreviewed; successful automated checks do not approve appearance.

Examples:
  bun run preview:capture:mountains --variant both --seed 56204 --players 4
  bun run preview:capture:mountains --view '{"position":[-160,49,96],"target":[-130,22,61]}'
  bun run preview:capture:mountains --baseline path/to/manifest.json`);
  process.exit(0);
}

function readJSON(path) { return JSON.parse(readFileSync(resolve(path), 'utf8')); }
function camera(value) {
  if (!value || !['position', 'target'].every(key => Array.isArray(value[key]) && value[key].length === 3 && value[key].every(Number.isFinite))) {
    throw new Error('A view requires finite position:[x,y,z] and target:[x,y,z] coordinates');
  }
  if (value.position.every((coordinate, i) => coordinate === value.target[i])) throw new Error('Camera position must differ from its target');
  return { position: value.position, target: value.target };
}
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function check(condition, message) { if (!condition) throw new Error(message); }
const baseline = args.baseline ? readJSON(args.baseline) : undefined;
if (baseline) check(baseline.schemaVersion === 1 && baseline.status === 'complete' && baseline.settings && baseline.captures?.length, 'Baseline must be a completed terrain capture manifest');
check(!(baseline && args.view), '--view cannot be combined with --baseline; baseline cameras are reused exactly');
const mode = baseline?.settings.mode ?? (args.mountains ? 'mountains' : 'hub');
check(['mountains', 'hub'].includes(mode), 'Invalid baseline capture mode');
if (args.mountains && mode !== 'mountains') throw new Error('--mountains conflicts with baseline mode');
const seed = Number(args.seed ?? baseline?.settings.seed ?? 56204);
check(Number.isSafeInteger(seed), '--seed must be a safe integer');
const players = args.players === 'all' ? [2, 4, 6] : args.players !== undefined ? [Number(args.players)] : baseline?.settings.players ?? (mode === 'mountains' ? [4] : [2, 4, 6]);
check(players.length > 0 && players.every(value => [2, 4, 6].includes(value)), '--players must be 2, 4, 6 or all');
const variant = args.variant ?? baseline?.settings.variant ?? (mode === 'mountains' ? 'new' : 'both');
check(['old', 'new', 'both'].includes(variant), '--variant must be old, new or both');
const quality = args.quality ?? baseline?.settings.quality ?? 'high';
check(['balanced', 'high'].includes(quality), '--quality must be balanced or high');
const viewport = baseline?.settings.viewport ?? { width: 1280, height: 800 };
const deviceScaleFactor = baseline?.settings.deviceScaleFactor ?? 1.5;
check(Number.isInteger(viewport.width) && viewport.width > 0 && Number.isInteger(viewport.height) && viewport.height > 0 && Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 0, 'Invalid baseline viewport');
for (const [key, value] of Object.entries({ seed, players, quality })) {
  if (baseline) check(equal(value, baseline.settings[key]), `--${key} conflicts with baseline settings`);
}
const customView = args.view ? camera(args.view.trim().startsWith('{') ? JSON.parse(args.view) : readJSON(args.view)) : undefined;
function defaultViews(players) {
  const scale = Math.sqrt(players / 2);
  return [
    { name: 'overview', view: { position: [230, 220, 260].map(n => n * scale), target: [0, 0, 0] } },
    { name: 'gameplay', view: { position: [110, 95, 125].map(n => n * scale), target: [0, 8, 0] } },
    ...(mode === 'mountains' ? [
      { name: 'close', view: { position: [-160, 49, 96], target: [-130, 22, 61] } },
      { name: 'low', view: { position: [-169, 31, 92], target: [-130, 23, 61] } },
      { name: 'opposite', view: { position: [-99, 51, 37], target: [-130, 22, 61] } },
    ] : [{ name: 'plan', routes: true, view: { position: [0, 420 * scale, .01], target: [0, 0, 0] } }]),
  ];
}
const views = baseline?.settings.views ?? Object.fromEntries(players.map(count => [count, customView ? [{ name: 'custom', view: customView }] : defaultViews(count)]));
for (const count of players) {
  check(Array.isArray(views[count]) && views[count].length > 0, `No baseline cameras for ${count} players`);
  const names = new Set();
  for (const view of views[count]) {
    check(/^[a-z0-9-]+$/.test(view.name) && !names.has(view.name), 'View names must be unique and contain only lowercase letters, numbers or hyphens');
    names.add(view.name); camera(view.view);
  }
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const runs = resolve(root, 'art/workbench/renders/terrain-playground/runs');
mkdirSync(runs, { recursive: true });
const run = mkdtempSync(resolve(runs, `${new Date().toISOString().replace(/[:.]/g, '-')}-seed-${seed}-`));
const manifest = {
  schemaVersion: 1, createdAt: new Date().toISOString(), status: 'running', review: 'unreviewed',
  settings: { mode, seed, players, variant, quality, viewport, deviceScaleFactor, views },
  baseline: args.baseline ? { path: resolve(args.baseline), sha256: sha256(readFileSync(resolve(args.baseline))) } : null,
  repository: { head: git('rev-parse', 'HEAD'), status: git('status', '--short') },
  captures: [], sources: [], assets: [], checks: {}, errors: [],
  recovery: 'Source snapshots preserve local edits. Asset hashes identify the exact local binaries; preparation recipes and source ledgers are snapshotted. Binary assets must remain at their recorded paths or be regenerated and verified against their hashes.',
};
const files = new Map();
function rememberFile(path, url, snapshot = false) {
  const absolute = resolve(root, path);
  const bytes = readFileSync(absolute), hash = sha256(bytes), previous = files.get(path);
  if (previous) {
    check(previous.sha256 === hash, `File changed during capture: ${path}`);
    if (url && !previous.urls.includes(url)) previous.urls.push(url);
    return;
  }
  const entry = { path, bytes: bytes.length, sha256: hash, urls: url ? [url] : [] };
  if (snapshot) {
    entry.snapshot = `source/${path}`;
    const destination = resolve(run, entry.snapshot);
    mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, bytes);
    manifest.sources.push(entry);
  } else manifest.assets.push(entry);
  files.set(path, entry);
}
const recipes = [
  'package.json', 'bun.lock', 'tsconfig.json', 'vite.config.ts', 'prototypes/terrain-playground/capture-multiplayer.mjs',
  'prototypes/terrain-playground/COMPOSITE.md', 'prototypes/terrain-playground/composite-sources.json',
  'prototypes/terrain-playground/prepare-directions.mjs',
  'tools/assets/prepare_oxide_cliff.py', 'tools/assets/prepare_biome_scree.py', 'tools/assets/prepare_biome_ground.py',
  'tools/assets/prepare_oxide_talus.py', 'tools/assets/fetch_terrain_composite_vegetation.py',
  'tools/assets/grade_terrain_biome_vegetation.py', 'tools/assets/prepare_savanna_vegetation.py',
  'tools/assets/prepare_terrain_runtime.py', 'tools/assets/prepare_terrain_runtime.mjs',
  'tools/assets/prepare_oasis_grass.py', 'tools/assets/oasis_grass.sources.json',
  'tools/assets/terrain_runtime.sources.json', 'tools/assets/terrain_composite_vegetation.sources.json',
  'tools/assets/terrain_biome_vegetation.sources.json', 'tools/assets/savanna_vegetation.sources.json',
  'art/workbench/terrain-composite/textures/geology-surface-sources.json',
  'art/workbench/terrain-composite/textures/biome-ground-sources.json',
  'art/workbench/terrain-composite/textures/cliff-side-source.json',
  'assets/models/procedural-manifest.json', 'assets/models/meshy-manifest.json',
];
for (const path of recipes) if (existsSync(resolve(root, path))) rememberFile(path, undefined, true);
// Browser requests omit type-only imports, including the untracked MapLayout
// contract. Preserve the small terrain source trees as well as requested modules.
for (const directory of ['src/mapGenerators', 'src/terrainRendering', 'prototypes/terrain-playground']) {
  for (const name of readdirSync(resolve(root, directory), { recursive: true })) {
    if (/\.(?:ts|tsx|mjs|css|html)$/.test(name)) rememberFile(`${directory}/${name}`, undefined, true);
  }
}
function rememberRequest(request) {
  const url = new URL(request.url());
  if (url.origin !== origin) return;
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const absolute = pathname.startsWith('/@fs/') ? pathname.slice(5) : resolve(root, `.${pathname}`);
  const path = relative(root, absolute);
  if (path.startsWith('..') || path.includes('node_modules/') || !existsSync(absolute)) return;
  if (!/\.(?:ts|tsx|js|mjs|css|html|json|glb|gltf|webp|png|jpe?g|ktx2|bin|wasm)$/.test(path)) return;
  try { rememberFile(path, request.url(), ['.ts', '.tsx', '.js', '.mjs', '.css', '.html'].includes(extname(path))); }
  catch (error) { manifest.errors.push(error.message); }
}
function saveManifest() {
  manifest.sources.sort((a, b) => a.path.localeCompare(b.path));
  manifest.assets.sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(resolve(run, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

let browser;
try {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
  check(response.ok, `Existing Vite server returned HTTP ${response.status}`);
  const { chromium } = await import('@playwright/test');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
  manifest.browser = { name: 'chromium', version: browser.version(), platform: process.platform };
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  page.on('request', request => {
    if (/titanium|ore-options/.test(request.url())) manifest.errors.push(`Retired ore asset requested: ${request.url()}`);
    rememberRequest(request);
  });
  page.on('pageerror', error => manifest.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') manifest.errors.push(message.text()); });
  async function ready(expectedVariant, count) {
    await page.waitForFunction(() => ['true', 'error'].includes(document.body.dataset.ready), undefined, { timeout: 90000 });
    await page.waitForLoadState('networkidle');
    const state = await page.evaluate(() => ({ ...document.body.dataset }));
    check(state.ready === 'true', `Scene failed to load: ${await page.locator('#status').textContent()}`);
    check(state.connected === 'true', `${expectedVariant}/${count}: disconnected sites`);
    check(expectedVariant !== 'new' || state.environmentAssets === 'ready', 'New terrain environment is not ready');
    const url = new URL(page.url());
    for (const [key, value] of Object.entries({ seed, players: count, variant: expectedVariant })) check(url.searchParams.get(key) === String(value), `Scene ${key} does not match requested ${value}`);
    check(await page.locator('#quality').inputValue() === quality, 'Scene quality does not match the run');
    check(manifest.errors.length === 0, manifest.errors.join('\n'));
  }
  async function capture(expectedVariant, count, specification, mobile = false) {
    const routes = await page.locator('#routes').getAttribute('aria-pressed') === 'true';
    if (routes !== Boolean(specification.routes)) await page.locator('#routes').click({ force: true });
    await page.evaluate(view => window.terrainProfiler.setView(view), specification.view);
    const inspect = await page.evaluate(() => window.terrainProfiler.inspect());
    check(equal(inspect.view, specification.view), 'Camera differs from requested view');
    check(Array.isArray(inspect.shaderErrors) && inspect.shaderErrors.length === 0, `Shader errors: ${JSON.stringify(inspect.shaderErrors)}`);
    const file = `${expectedVariant}-${count}-${specification.name}${mobile ? '-mobile' : ''}.png`;
    const png = await page.screenshot({ path: resolve(run, file), scale: 'device',
      style: mobile ? undefined : 'header,aside,footer,#terrain-inspector,#site-labels{display:none!important}',
    });
    check(png.subarray(1, 4).toString() === 'PNG', 'Capture is not a PNG');
    const pngSize = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    const capture = { file, variant: expectedVariant, seed, players: count, quality, name: specification.name, mobile, routes: Boolean(specification.routes), url: page.url(), png: { ...pngSize, bytes: png.length, sha256: sha256(png) }, ...inspect };
    manifest.captures.push(capture);
    check(pngSize.width === Math.round(inspect.viewport.width * deviceScaleFactor) && pngSize.height === Math.round(inspect.viewport.height * deviceScaleFactor), 'PNG was not captured at native device scale');
    if (baseline && !mobile) {
      const previous = baseline.captures.find(item => !item.mobile && item.players === count && item.name === specification.name && item.variant === expectedVariant)
        ?? baseline.captures.find(item => !item.mobile && item.players === count && item.name === specification.name);
      check(previous, `Baseline has no ${count}-player ${specification.name} capture`);
      for (const key of ['view', 'viewport', 'drawingBuffer']) check(equal(capture[key], previous[key]), `${key} differs from baseline: ${file}`);
      check(pngSize.width === previous.png.width && pngSize.height === previous.png.height, `PNG dimensions differ from baseline: ${file}`);
    }
    saveManifest();
    console.log(`${file}: PNG ${pngSize.width}×${pngSize.height}, drawing buffer ${inspect.drawingBuffer.join('×')}, pixel ratio ${inspect.viewport.pixelRatio}`);
  }
  const variants = variant === 'both' ? ['old', 'new'] : [variant];
  for (const count of players) {
    // Initialize once so Old/New share the sun target and shadow framing as well as the camera.
    await page.goto(`${endpoint}?mode=multiplayer&seed=${seed}&players=${count}&variant=old&quality=${quality}&camera=inspect`);
    await ready('old', count);
    for (const version of variants) {
      await page.getByRole('button', { name: version === 'old' ? 'Old terrain' : 'New terrain', exact: true }).click();
      await ready(version, count);
      for (const view of views[count]) await capture(version, count, view);
    }
  }
  check(await page.locator('#terrain-nav button').count() === 2, 'Expected exactly Old terrain and New terrain controls');
  const preservedView = await page.evaluate(() => window.terrainProfiler.inspect().view);
  for (const version of ['old', 'new']) {
    await page.getByRole('button', { name: version === 'old' ? 'Old terrain' : 'New terrain', exact: true }).click({ force: true });
    await ready(version, players.at(-1));
    check(equal(await page.evaluate(() => window.terrainProfiler.inspect().view), preservedView), 'Terrain switch moved the camera');
  }
  manifest.checks.terrainControls = 'passed';
  manifest.checks.cameraPreservation = 'passed';
  check(await page.locator('#ore-select, a[href*="ore-"], a[href*="directions.html"]').count() === 0, 'Retired ore controls are still present');
  manifest.checks.oreRemoval = 'passed';
  if (mode === 'hub') {
    // Changing player count remains an interaction check, independent of comparison captures.
    await page.locator('#players').selectOption(players.at(-1) === 4 ? '2' : '4', { force: true });
    const count = players.at(-1) === 4 ? 2 : 4;
    await ready('new', count);
    manifest.checks.playerSelector = 'passed';
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('new', count, defaultViews(count)[0], true);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile overflow');
    manifest.checks.mobileOverflow = 'passed';
  }
  for (const [path, entry] of files) check(sha256(readFileSync(resolve(root, path))) === entry.sha256, `File changed during capture: ${path}`);
  check(manifest.errors.length === 0, manifest.errors.join('\n'));
  manifest.status = 'complete';
} catch (error) {
  manifest.status = 'failed'; manifest.errors.push(error.message); process.exitCode = 1;
  console.error(error.message);
} finally {
  try { if (browser) await browser.close(); } finally {
    manifest.finishedAt = new Date().toISOString(); saveManifest();
    console.log(`Unreviewed ${manifest.status} run: ${resolve(run, 'manifest.json')}`);
  }
}
