import type { Page } from "@playwright/test";

export interface UnitSnapshot {
  id: string;
  kind: string;
  ownerId: string;
  x: number;
  z: number;
  health: number;
  maxHealth: number;
  order: string;
  moving: boolean;
  attacking: boolean;
}

export interface BuildingSnapshot {
  id: string;
  kind: string;
  ownerId: string;
  lifecycle: string;
  constructionProgress: number;
  x: number;
  z: number;
  health: number;
  maxHealth: number;
  productionQueue?: { id: string; kind: string }[];
}

export interface MatchSnapshot {
  tick: number;
  outcome?: string;
  units: UnitSnapshot[];
  buildings: BuildingSnapshot[];
  selected: { unitIds: string[]; buildingIds: string[] };
}

declare global {
  interface Window {
    __dune77?: {
      ready: () => Promise<void>;
      inspect: () => MatchSnapshot | null;
      view: (x: number, z: number, zoom?: number) => void;
      programs: () => string[];
      project: (x: number, z: number, y?: number) => {
        x: number;
        y: number;
        behind: boolean;
      };
      minimap: (x: number, z: number) => { x: number; y: number } | undefined;
    };
  }
}

/** Opens a deterministic match with the read-only verify hook enabled.
 * Waits until simulation frames arrive AND model GLBs finish loading,
 * otherwise raycast picking silently misses buildings that have no presentation yet.
 * `light` draws no shadows, rocks, vegetation or antialiasing, about six times faster on Boat,
 * and tags the match bar "Light render". A spec whose assertions or captures depend on what
 * players see passes `{ render: "full" }`. */
export async function openGame(page: Page, seed = 77, { render = "light" }: { render?: "light" | "full" } = {}) {
  await page.goto(`./?seed=${seed}&verify=1${render === "light" ? "&render=light" : ""}`);
  await page.waitForFunction(() =>
    Boolean(window.__dune77?.inspect()?.units.length),
  );
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.__dune77!.ready());
}

export const snapshot = (page: Page) =>
  page.evaluate(() => window.__dune77!.inspect()!);

export async function waitForSnapshot(
  page: Page,
  predicate: (snapshot: MatchSnapshot) => boolean,
  timeout = 20_000,
) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const current = await snapshot(page);
    if (predicate(current)) return current;
    if (Date.now() > deadline) throw new Error("waitForSnapshot timed out");
    await page.waitForTimeout(250);
  }
}

/** Projects world coordinates to screen pixels.
 * y is height above the terrain surface at (x, z), default terrain level. */
export const screenPoint = (page: Page, x: number, z: number, y = 0) =>
  page.evaluate(([wx, wz, wy]) => window.__dune77!.project(wx, wz, wy), [x, z, y]);

/** Projects world coordinates to viewport pixels on the minimap, using the map's real size. */
export async function minimapPoint(page: Page, x: number, z: number) {
  const point = await page.evaluate(([wx, wz]) => window.__dune77!.minimap(wx, wz), [x, z]);
  if (!point) throw new Error("minimapPoint: no map is loaded");
  return point;
}

export async function clickWorld(
  page: Page,
  x: number,
  z: number,
  options: { y?: number; button?: "left" | "right" } = {},
) {
  const point = await screenPoint(page, x, z, options.y ?? 1);
  await page.mouse.click(point.x, point.y, { button: options.button ?? "left" });
}

const ENTITY_CLICK_HEIGHTS = [1.1, 2.5, 4, 6, 8];

/** Left-clicks an entity by id through the real canvas input path.
 * The ray must hit a unit's click cylinder or a building's visible model, and the
 * nearest hit wins, so it retries from low to tall and confirms via inspect().selected. */
export async function clickEntity(page: Page, id: string) {
  for (const y of ENTITY_CLICK_HEIGHTS) {
    const point = await page.evaluate(([entityId, height]) => {
      const snap = window.__dune77!.inspect()!;
      const entity = snap.units.find((unit) => unit.id === entityId)
        ?? snap.buildings.find((building) => building.id === entityId);
      return entity ? window.__dune77!.project(entity.x, entity.z, height) : null;
    }, [id, y] as const);
    if (!point) throw new Error(`clickEntity: unknown entity ${id}`);
    await page.mouse.click(point.x, point.y);
    const selected = await page.evaluate(() => window.__dune77!.inspect()!.selected);
    if (selected.unitIds.includes(id) || selected.buildingIds.includes(id)) return;
  }
  throw new Error(`clickEntity: could not select ${id}`);
}

/** Drag-selects specific units by id. The camera's screen axes are world diagonals,
 * so the box is computed in screen space around the projected unit positions. */
export async function dragSelectUnits(page: Page, ids: string[]) {
  const points = await page.evaluate((wanted) => {
    const snap = window.__dune77!.inspect()!;
    return wanted.flatMap((id) => {
      const unit = snap.units.find((candidate) => candidate.id === id);
      return unit ? [window.__dune77!.project(unit.x, unit.z, 1.1)] : [];
    });
  }, ids);
  if (points.length !== ids.length) {
    throw new Error(`dragSelectUnits: missing units, wanted [${ids}]`);
  }
  const margin = 12;
  const left = Math.min(...points.map((point) => point.x)) - margin;
  const right = Math.max(...points.map((point) => point.x)) + margin;
  const top = Math.min(...points.map((point) => point.y)) - margin;
  const bottom = Math.max(...points.map((point) => point.y)) + margin;
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 8 });
  await page.mouse.up();
}
