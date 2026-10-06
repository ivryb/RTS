import { generateMapLayout, type MapLayout, type PlayerCount, type Point as MapPoint } from "./mapGenerators";
import { createTerrainEnvironment } from "./mapGenerators/environment";
import { TERRAIN_HILL_THRESHOLD } from "./mapConstants";
import type { TerrainSurface } from "./terrainWalkability";
import {
  CellFlag,
  createPlacementGrid,
  intersects,
  type PlacementGrid,
} from "./placement";

export type { Point as MapPoint } from "./mapGenerators";

export interface PalmSpawn extends MapPoint {
  rotation: number;
  scale: number;
}

export type { TerrainSurface } from "./terrainWalkability";
export { MAP_SEGMENTS, MAP_SIZE } from "./mapConstants";
export { terrainPathExists } from "./terrainWalkability";

export interface GeneratedMap extends TerrainSurface {
  seed: number;
  startingLocations: readonly MapPoint[];
  palms: PalmSpawn[];
  placement: PlacementGrid;
  mountainMask: Float32Array;
  layout: MapLayout;
  environment: ReturnType<typeof createTerrainEnvironment>;
}

/** Match the rendering diagonal so navigation and sampled unit heights share the same surface. */
export const createTerrainIndices = (segments: number, trianglePattern: TerrainSurface["trianglePattern"] = "alternating") => {
  const row = segments + 1;
  const indices = new Uint32Array(segments * segments * 6);
  let index = 0;
  for (let z = 0; z < segments; z += 1) {
    for (let x = 0; x < segments; x += 1) {
      const topLeft = z * row + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + row;
      const bottomRight = bottomLeft + 1;
      if (trianglePattern === "alternating" && (x + z) % 2 === 0) {
        indices[index] = topLeft;
        indices[index + 1] = bottomLeft;
        indices[index + 2] = bottomRight;
        indices[index + 3] = topLeft;
        indices[index + 4] = bottomRight;
        indices[index + 5] = topRight;
      } else {
        indices[index] = topLeft;
        indices[index + 1] = bottomLeft;
        indices[index + 2] = topRight;
        indices[index + 3] = bottomLeft;
        indices[index + 4] = bottomRight;
        indices[index + 5] = topRight;
      }
      index += 6;
    }
  }
  return indices;
};

/** Gameplay consumes the same Shifting Frontiers layout and surface as the terrain hub. */
export const generateMap = (seed: number, playerCount: PlayerCount = 2): GeneratedMap => {
  const environment = createTerrainEnvironment(generateMapLayout({ generator: "multiplayer", seed, players: playerCount }));
  const { layout } = environment;
  const startingLocations = layout.sites.filter(site => site.role === "base")
    .sort((a, b) => a.player - b.player)
    .map(({ x, z }) => ({ x, z }));
  if (startingLocations.length < 2) {
    throw new Error("Gameplay terrain must contain at least two bases");
  }
  const surface = { size: layout.size, segments: layout.cells, heights: layout.heights, trianglePattern: "fixed" as const };
  const placement = createPlacementGrid(layout.size, Math.round(layout.size / 2));
  for (let z = 0; z < placement.resolution; z += 1) {
    for (let x = 0; x < placement.resolution; x += 1) {
      const worldX = ((x + 0.5) / placement.resolution - 0.5) * layout.size;
      const worldZ = ((z + 0.5) / placement.resolution - 0.5) * layout.size;
      const gridX = Math.floor((worldX / layout.size + .5) * layout.cells);
      const gridZ = Math.floor((worldZ / layout.size + .5) * layout.cells);
      const row = layout.cells + 1;
      const corner = gridZ * row + gridX;
      if ([corner, corner + 1, corner + row, corner + row + 1].some(i => layout.blocked[i])) {
        placement.flags[z * placement.resolution + x] |= CellFlag.Reserved;
      }
      if (sampleHeight(surface, worldX, worldZ) > TERRAIN_HILL_THRESHOLD) {
        placement.flags[z * placement.resolution + x] |= CellFlag.Hill;
      }
    }
  }
  return {
    seed,
    startingLocations,
    ...surface,
    palms: [],
    placement,
    mountainMask: Float32Array.from(layout.blocked),
    layout,
    environment,
  };
};

export const sampleHeight = (map: TerrainSurface, x: number, z: number) => {
  const gridX = Math.max(0, Math.min(map.segments, (x / map.size + 0.5) * map.segments));
  const gridZ = Math.max(0, Math.min(map.segments, (z / map.size + 0.5) * map.segments));
  const x0 = Math.floor(gridX);
  const z0 = Math.floor(gridZ);
  const x1 = Math.min(map.segments, x0 + 1);
  const z1 = Math.min(map.segments, z0 + 1);
  const row = map.segments + 1;
  const topLeft = map.heights[z0 * row + x0]!;
  const topRight = map.heights[z0 * row + x1]!;
  const bottomLeft = map.heights[z1 * row + x0]!;
  const bottomRight = map.heights[z1 * row + x1]!;
  const localX = gridX - x0;
  const localZ = gridZ - z0;
  if (x0 === x1 || z0 === z1) {
    const top = topLeft * (1 - localX) + topRight * localX;
    const bottom = bottomLeft * (1 - localX) + bottomRight * localX;
    return top * (1 - localZ) + bottom * localZ;
  }

  if (map.trianglePattern !== "fixed" && (x0 + z0) % 2 === 0) {
    return localZ >= localX
      ? topLeft * (1 - localZ) + bottomLeft * (localZ - localX) + bottomRight * localX
      : topLeft * (1 - localX) + bottomRight * localZ + topRight * (localX - localZ);
  }
  return localX + localZ <= 1
    ? topLeft * (1 - localX - localZ) + bottomLeft * localZ + topRight * localX
    : bottomRight * (localX + localZ - 1)
      + bottomLeft * (1 - localX)
      + topRight * (1 - localZ);
};

export const canPlaceAt = (map: GeneratedMap, x: number, z: number, radius: number) =>
  !intersects(
    map.placement,
    x,
    z,
    radius,
    CellFlag.Palm | CellFlag.Reserved,
  );
