import { describe, expect, test } from "bun:test";
import {
  generateMap,
  sampleHeight,
  terrainPathExists,
  type TerrainSurface,
} from "../src/map";
import { generateTerrainLayout } from "../src/generatedTerrain";
import {
  MAXIMUM_GROUND_CLEARANCE,
  MAXIMUM_WALKABLE_SLOPE,
} from "../src/navigationConfig";
import { CellFlag } from "../src/placement";

const outerHillCoverage = (map: ReturnType<typeof generateMap>) => {
  let outerCells = 0;
  let outerHills = 0;
  for (let z = 0; z < map.placement.resolution; z += 1) {
    for (let x = 0; x < map.placement.resolution; x += 1) {
      const worldX = ((x + 0.5) / map.placement.resolution - 0.5) * map.size;
      const worldZ = ((z + 0.5) / map.placement.resolution - 0.5) * map.size;
      if (Math.abs(worldX) <= map.size * 0.38 && Math.abs(worldZ) <= map.size * 0.38) {
        continue;
      }
      outerCells += 1;
      if (map.placement.flags[z * map.placement.resolution + x]! & CellFlag.Hill) {
        outerHills += 1;
      }
    }
  }
  return outerHills / outerCells;
};

describe("procedural map", () => {
  test("uses the same terrain layout as the topology preview", () => {
    const map = generateMap(77);
    const preview = generateTerrainLayout(77, 2);

    expect([...map.heights]).toEqual([...preview.heights]);
    expect([...map.mountainMask]).toEqual([...preview.mountainMask]);
    expect([...map.mountainFoundationMask]).toEqual([...preview.mountainFoundationMask]);
    expect(map.topology).toEqual(preview.topology);
  });

  test("is deterministic for a seed", () => {
    const first = generateMap(77);
    const second = generateMap(77);

    expect([...first.heights]).toEqual([...second.heights]);
    expect(first.startingLocations).toEqual(second.startingLocations);
    expect(first.palms).toEqual(second.palms);
  });

  test("keeps starting areas flat and connected with terrain near the map edges", () => {
    for (const seed of [17, 49, 77, 194, 1234, 2026, 9001]) {
      const map = generateMap(seed);

      expect(terrainPathExists(
        map,
        map.startingLocations[0],
        map.startingLocations[1],
        MAXIMUM_WALKABLE_SLOPE,
        MAXIMUM_GROUND_CLEARANCE,
      )).toBe(true);
      expect(outerHillCoverage(map)).toBeGreaterThan(0.2);

      for (const start of map.startingLocations) {
        const heights = Array.from({ length: 12 }, (_, index) => {
          const angle = index * Math.PI * 2 / 12;
          return sampleHeight(
            map,
            start.x + Math.cos(angle) * 24,
            start.z + Math.sin(angle) * 24,
          );
        });
        heights.push(sampleHeight(map, start.x, start.z));

        expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.02);
      }
    }
  }, 30_000);

  test("generates a varied dry battlefield with placeholder trees disabled", () => {
    const map = generateMap(1234);
    const hillCoverage = [...map.placement.flags].filter(
      (flags) => flags & CellFlag.Hill,
    ).length / map.placement.flags.length;

    expect(map.size).toBe(240);
    expect(hillCoverage).toBeGreaterThan(0.28);
    expect(Math.max(...map.heights) - Math.min(...map.heights)).toBeGreaterThan(6);
    expect(map.palms).toEqual([]);
  });

  test("creates broad level hilltops", () => {
    const map = generateMap(1234);
    const matchingHeights = new Map<number, number>();
    for (const height of map.heights) {
      const level = Math.round(height * 1_000);
      matchingHeights.set(level, (matchingHeights.get(level) ?? 0) + 1);
    }

    expect(Math.max(...matchingHeights.values())).toBeGreaterThan(100);
  });

  test("samples the alternating triangles used by navigation", () => {
    const terrain: TerrainSurface = {
      size: 1,
      segments: 1,
      heights: new Float32Array([0, 0, 0, 4]),
    };

    expect(sampleHeight(terrain, 0.25, -0.25)).toBe(1);
  });

  test("rejects a diagonal surface whose combined slope exceeds the limit", () => {
    const size = 40;
    const segments = 40;
    const row = segments + 1;
    const heights = new Float32Array(row * row);
    for (let z = 0; z <= segments; z += 1) {
      for (let x = 0; x <= segments; x += 1) {
        heights[z * row + x] = (x + z) * 0.7;
      }
    }

    expect(terrainPathExists(
      { size, segments, heights },
      { x: -15, z: -15 },
      { x: 15, z: 15 },
    )).toBe(false);
  });
});
