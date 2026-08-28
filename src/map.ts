import { generateTerrainLayout } from "./generatedTerrain";
import type { MapTopology } from "./mapTopology";
import { TERRAIN_HILL_THRESHOLD } from "./mapConstants";
import type { TerrainSurface } from "./terrainWalkability";
import {
  CellFlag,
  createPlacementGrid,
  intersects,
  type PlacementGrid,
} from "./placement";

export interface MapPoint {
  x: number;
  z: number;
}

export interface PalmSpawn extends MapPoint {
  rotation: number;
  scale: number;
}

export type { TerrainSurface } from "./terrainWalkability";
export { MAP_SEGMENTS, MAP_SIZE } from "./mapConstants";
export { terrainPathExists } from "./terrainWalkability";

export interface GeneratedMap extends TerrainSurface {
  seed: number;
  startingLocations: readonly [MapPoint, MapPoint];
  palms: PalmSpawn[];
  placement: PlacementGrid;
  mountainMask: Float32Array;
  mountainFoundationMask: Float32Array;
  topology: MapTopology;
}

/** Alternating diagonals keep steep height-field faces from favoring one view direction. */
export const createTerrainIndices = (segments: number) => {
  const row = segments + 1;
  const indices = new Uint32Array(segments * segments * 6);
  let index = 0;
  for (let z = 0; z < segments; z += 1) {
    for (let x = 0; x < segments; x += 1) {
      const topLeft = z * row + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + row;
      const bottomRight = bottomLeft + 1;
      if ((x + z) % 2 === 0) {
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

/** Generates the shared graph terrain used by both gameplay and its preview. */
export const generateMap = (seed: number): GeneratedMap => {
  const layout = generateTerrainLayout(seed, 2);
  const firstBase = layout.startingLocations[0];
  const secondBase = layout.startingLocations[1];
  if (!firstBase || !secondBase) throw new Error("Two-player terrain must contain two bases");
  const startingLocations = [firstBase, secondBase] as const;
  const surface = { size: layout.size, segments: layout.segments, heights: layout.heights };
  const placement = createPlacementGrid(layout.size, Math.round(layout.size / 2));
  for (let z = 0; z < placement.resolution; z += 1) {
    for (let x = 0; x < placement.resolution; x += 1) {
      const worldX = ((x + 0.5) / placement.resolution - 0.5) * layout.size;
      const worldZ = ((z + 0.5) / placement.resolution - 0.5) * layout.size;
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
    mountainMask: layout.mountainMask,
    mountainFoundationMask: layout.mountainFoundationMask,
    topology: layout.topology,
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

  if ((x0 + z0) % 2 === 0) {
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
