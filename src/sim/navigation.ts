import {
  init,
  NavMeshQuery,
  type CylinderObstacle,
  type NavMesh,
  type TileCache,
} from "recast-navigation";
import { generateSoloNavMesh, generateTileCache } from "recast-navigation/generators";
import { createTerrainIndices, MAP_SIZE, sampleHeight, type TerrainSurface } from "../map";
import { TERRAIN_MOUNTAIN_BLOCKED_THRESHOLD } from "../mapConstants";
import {
  GROUND_NAVIGATION_RADII,
  MAXIMUM_WALKABLE_SLOPE,
  NAVIGATION_CELL_HEIGHT,
  NAVIGATION_CELL_SIZE,
  NAVIGATION_CLEARANCE,
} from "../navigationConfig";
import type { SimPoint } from "./units";

let initialized = false;
let initialization: Promise<void> | undefined;

export type NavigationModuleFactory = NonNullable<Parameters<typeof init>[0]>;

export const initializeNavigation = (moduleFactory?: NavigationModuleFactory) => initialization ??= init(moduleFactory).then(() => {
  initialized = true;
});

const METERS_PER_SIM_UNIT = 1 / 1_000;
const OBSTACLE_BOTTOM = -16;
const OBSTACLE_TOP = 24;
const OBSTACLE_SEGMENTS = 16;
const SOLO_NAVIGATION_CELL_SIZE = 0.25;
const TILE_SIZE = 32;
const MAX_TEMPORARY_OBSTACLES = 512;
const TEMPORARY_OBSTACLE_HEIGHT = 40;
const TEMPORARY_OBSTACLE_BATCH_SIZE = 32;

export interface NavigationObstacle {
  position: SimPoint;
  radius: number;
}

interface NavigationLayer {
  navMesh: NavMesh;
  query: NavMeshQuery;
  cellSize: number;
  navigationRadius: number;
  tileCache?: TileCache;
  temporaryObstacles?: Map<string, CylinderObstacle>;
}

const radiusClass = (radius: number) => {
  const meters = radius * METERS_PER_SIM_UNIT;
  return GROUND_NAVIGATION_RADII.find((candidate) => meters <= candidate)
    ?? Math.ceil(meters / NAVIGATION_CELL_SIZE) * NAVIGATION_CELL_SIZE;
};

const addFloor = (positions: number[], indices: number[]) => {
  const half = MAP_SIZE / 2;
  const offset = positions.length / 3;
  positions.push(-half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half);
  indices.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
};

const createTerrainGeometry = (terrain: TerrainSurface) => {
  const row = terrain.segments + 1;
  const positions = new Float32Array(row * row * 3);
  // Generated maps author walkability through their mountain mask. Keeping
  // that navigation mesh flat prevents visual hill tessellation from opening
  // or closing routes, while units still render at the sampled terrain height.
  let offset = 0;
  for (let z = 0; z <= terrain.segments; z += 1) {
    for (let x = 0; x <= terrain.segments; x += 1) {
      positions[offset++] = (x / terrain.segments - 0.5) * terrain.size;
      positions[offset++] = terrain.mountainMask ? 0 : terrain.heights[z * row + x]!;
      positions[offset++] = (z / terrain.segments - 0.5) * terrain.size;
    }
  }
  const terrainIndices = createTerrainIndices(terrain.segments);
  if (!terrain.mountainMask) return { positions, indices: terrainIndices };

  const indices: number[] = [];
  for (let index = 0; index < terrainIndices.length; index += 3) {
    const a = terrainIndices[index]!;
    const b = terrainIndices[index + 1]!;
    const c = terrainIndices[index + 2]!;
    if (terrain.mountainMask[a]! >= TERRAIN_MOUNTAIN_BLOCKED_THRESHOLD
      || terrain.mountainMask[b]! >= TERRAIN_MOUNTAIN_BLOCKED_THRESHOLD
      || terrain.mountainMask[c]! >= TERRAIN_MOUNTAIN_BLOCKED_THRESHOLD) continue;
    indices.push(a, b, c);
  }
  return { positions, indices };
};

const addCylinder = (
  positions: number[],
  indices: number[],
  obstacle: NavigationObstacle,
  clearance: number,
) => {
  const centerX = obstacle.position.x * METERS_PER_SIM_UNIT;
  const centerZ = obstacle.position.z * METERS_PER_SIM_UNIT;
  const radius = obstacle.radius * METERS_PER_SIM_UNIT + clearance;
  const offset = positions.length / 3;
  for (let index = 0; index < OBSTACLE_SEGMENTS; index += 1) {
    const angle = index / OBSTACLE_SEGMENTS * Math.PI * 2;
    const x = centerX + Math.cos(angle) * radius;
    const z = centerZ + Math.sin(angle) * radius;
    positions.push(x, OBSTACLE_BOTTOM, z, x, OBSTACLE_TOP, z);
  }
  const topCenter = positions.length / 3;
  positions.push(centerX, OBSTACLE_TOP, centerZ);
  for (let index = 0; index < OBSTACLE_SEGMENTS; index += 1) {
    const next = (index + 1) % OBSTACLE_SEGMENTS;
    const bottom = offset + index * 2;
    const nextBottom = offset + next * 2;
    indices.push(bottom, nextBottom, nextBottom + 1, bottom, nextBottom + 1, bottom + 1);
    indices.push(topCenter, nextBottom + 1, bottom + 1);
  }
};

const temporaryObstacleKey = (obstacle: NavigationObstacle) => [
  obstacle.position.x,
  obstacle.position.z,
  obstacle.radius,
].join(":");

const updateTileCache = (layer: NavigationLayer) => {
  if (!layer.tileCache) return;
  for (let update = 0; update < 1_024; update += 1) {
    const result = layer.tileCache.update(layer.navMesh);
    if (!result.success) throw new Error(`Failed to update navigation tiles: ${result.status}`);
    if (result.upToDate) return;
  }
  throw new Error("Navigation tile updates did not settle");
};

const syncTemporaryObstacles = (
  layer: NavigationLayer,
  obstacles: readonly NavigationObstacle[],
  terrain: TerrainSurface,
) => {
  if (!layer.tileCache || !layer.temporaryObstacles) return;
  const desired = new Map(obstacles.map((obstacle) => [temporaryObstacleKey(obstacle), obstacle]));
  let queued = 0;
  const flush = () => {
    if (!queued) return;
    updateTileCache(layer);
    queued = 0;
  };

  for (const [key, obstacle] of layer.temporaryObstacles) {
    if (desired.has(key)) continue;
    const result = layer.tileCache.removeObstacle(obstacle);
    if (!result.success) throw new Error(`Failed to remove navigation obstacle: ${result.status}`);
    layer.temporaryObstacles.delete(key);
    queued += 1;
    if (queued >= TEMPORARY_OBSTACLE_BATCH_SIZE) flush();
  }
  for (const [key, obstacle] of desired) {
    if (layer.temporaryObstacles.has(key)) continue;
    const x = obstacle.position.x * METERS_PER_SIM_UNIT;
    const z = obstacle.position.z * METERS_PER_SIM_UNIT;
    const result = layer.tileCache.addCylinderObstacle(
      { x, y: (terrain.mountainMask ? 0 : sampleHeight(terrain, x, z)) - 2, z },
      obstacle.radius * METERS_PER_SIM_UNIT
        + layer.navigationRadius
        + NAVIGATION_CLEARANCE,
      TEMPORARY_OBSTACLE_HEIGHT,
    );
    if (!result.success) throw new Error(`Failed to add navigation obstacle: ${result.status}`);
    layer.temporaryObstacles.set(key, result.obstacle);
    queued += 1;
    if (queued >= TEMPORARY_OBSTACLE_BATCH_SIZE) flush();
  }
  flush();
};

const createLayer = (
  obstacles: readonly NavigationObstacle[],
  navigationRadius: number,
  terrain?: TerrainSurface,
  terrainGeometry?: ReturnType<typeof createTerrainGeometry>,
): NavigationLayer => {
  if (!initialized) throw new Error("Recast navigation must be initialized before creating a match");
  if (terrain && terrainGeometry) {
    const generated = generateTileCache(terrainGeometry.positions, terrainGeometry.indices, {
      cs: NAVIGATION_CELL_SIZE,
      ch: NAVIGATION_CELL_HEIGHT,
      tileSize: TILE_SIZE,
      expectedLayersPerTile: 1,
      maxObstacles: MAX_TEMPORARY_OBSTACLES,
      walkableSlopeAngle: MAXIMUM_WALKABLE_SLOPE,
      walkableHeight: 20,
      walkableClimb: 5,
      walkableRadius: Math.ceil(navigationRadius / NAVIGATION_CELL_SIZE),
      maxSimplificationError: 1.3,
      maxVertsPerPoly: 6,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    });
    if (!generated.success) throw new Error(`Failed to build navigation tiles: ${generated.error}`);
    const layer: NavigationLayer = {
      navMesh: generated.navMesh,
      query: new NavMeshQuery(generated.navMesh, { maxNodes: 4_096 }),
      cellSize: NAVIGATION_CELL_SIZE,
      navigationRadius,
      tileCache: generated.tileCache,
      temporaryObstacles: new Map(),
    };
    syncTemporaryObstacles(layer, obstacles, terrain);
    return layer;
  }

  const positions: number[] = [];
  const indices: number[] = [];
  addFloor(positions, indices);
  for (const obstacle of obstacles) {
    addCylinder(positions, indices, obstacle, navigationRadius + NAVIGATION_CLEARANCE);
  }
  const generated = generateSoloNavMesh(positions, indices, {
    cs: SOLO_NAVIGATION_CELL_SIZE,
    ch: NAVIGATION_CELL_HEIGHT,
    walkableSlopeAngle: MAXIMUM_WALKABLE_SLOPE,
    walkableHeight: 20,
    walkableClimb: 5,
    walkableRadius: 0,
    maxEdgeLen: 24,
    maxSimplificationError: 1.3,
    minRegionArea: 8,
    mergeRegionArea: 20,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
  });
  if (!generated.success) throw new Error(`Failed to build navigation mesh: ${generated.error}`);
  return {
    navMesh: generated.navMesh,
    query: new NavMeshQuery(generated.navMesh, { maxNodes: 4_096 }),
    cellSize: SOLO_NAVIGATION_CELL_SIZE,
    navigationRadius,
  };
};

const toNavigationPoint = (point: SimPoint, terrain?: TerrainSurface) => {
  const x = point.x * METERS_PER_SIM_UNIT;
  const z = point.z * METERS_PER_SIM_UNIT;
  return { x, y: terrain && !terrain.mountainMask ? sampleHeight(terrain, x, z) : 0, z };
};

const toSimPoint = (point: { x: number; z: number }): SimPoint => ({
  x: Math.round(point.x / METERS_PER_SIM_UNIT),
  z: Math.round(point.z / METERS_PER_SIM_UNIT),
});

export class RecastNavigation {
  private obstacles: readonly NavigationObstacle[] = [];
  private signature = "";
  private readonly layers = new Map<number, NavigationLayer>();
  private readonly terrainGeometry?: ReturnType<typeof createTerrainGeometry>;

  constructor(private readonly terrain?: TerrainSurface) {
    if (terrain) this.terrainGeometry = createTerrainGeometry(terrain);
  }

  get hasTerrain() {
    return Boolean(this.terrain);
  }

  setObstacles(obstacles: readonly NavigationObstacle[]) {
    const signature = obstacles.map((obstacle) => [
      obstacle.position.x,
      obstacle.position.z,
      obstacle.radius,
    ].join(":")).join("|");
    if (signature === this.signature) return;
    this.obstacles = obstacles;
    this.signature = signature;
    if (!this.terrain) {
      this.destroyLayers();
      return;
    }
    for (const layer of this.layers.values()) {
      syncTemporaryObstacles(layer, obstacles, this.terrain);
    }
  }

  prepare(unitRadii: readonly number[]) {
    if (!this.obstacles.length && !this.terrain) return;
    for (const radius of new Set(unitRadii.map(radiusClass))) this.layer(radius);
  }

  plan(start: SimPoint, goal: SimPoint, unitRadius: number): SimPoint[] | undefined {
    if (!this.obstacles.length && !this.terrain) return [{ ...goal }];
    const layer = this.layer(radiusClass(unitRadius));
    const startPoint = toNavigationPoint(start, this.terrain);
    const goalPoint = toNavigationPoint(goal, this.terrain);
    const closestGoal = layer.query.findClosestPoint(goalPoint);
    if (!closestGoal.success) return undefined;
    const result = layer.query.computePath(startPoint, goalPoint, {
      halfExtents: { x: 3, y: 3, z: 3 },
      maxPathPolys: 512,
      maxStraightPathPoints: 512,
    });
    const last = result.path.at(-1);
    if (!result.success || !last
      || Math.hypot(last.x - closestGoal.point.x, last.z - closestGoal.point.z)
        > layer.cellSize * 2) {
      return undefined;
    }
    return result.path.slice(1).map(toSimPoint);
  }

  destroy() {
    this.destroyLayers();
    this.obstacles = [];
    this.signature = "";
  }

  private destroyLayers() {
    for (const { query, navMesh, tileCache } of this.layers.values()) {
      query.destroy();
      tileCache?.destroy();
      navMesh.destroy();
    }
    this.layers.clear();
  }

  private layer(radius: number) {
    let layer = this.layers.get(radius);
    if (!layer) {
      layer = createLayer(this.obstacles, radius, this.terrain, this.terrainGeometry);
      this.layers.set(radius, layer);
    }
    return layer;
  }
}
