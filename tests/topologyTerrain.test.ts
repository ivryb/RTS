import { describe, expect, test } from "bun:test";
import {
  mapSegmentsForSize,
  TERRAIN_BASE_HEIGHT,
  TERRAIN_LEVEL_HEIGHT,
} from "../src/mapConstants";
import {
  createContourTerrainHeights,
  createContourTerrainPlan,
} from "../src/topologyTerrain";
import { createTerrainFrame } from "../src/terrainFrame";
import { generateTerrainLayout } from "../src/generatedTerrain";

const elevatedPlateauComponents = (
  heights: Float32Array,
  segments: number,
) => {
  const row = segments + 1;
  const elevated = new Uint8Array(heights.length);
  for (let index = 0; index < heights.length; index += 1) {
    const level = (heights[index]! - TERRAIN_BASE_HEIGHT) / TERRAIN_LEVEL_HEIGHT;
    if (level > 0.94) elevated[index] = 1;
  }
  const sizes: number[] = [];
  for (let start = 0; start < elevated.length; start += 1) {
    if (!elevated[start]) continue;
    const queue = [start];
    elevated[start] = 0;
    for (let read = 0; read < queue.length; read += 1) {
      const current = queue[read]!;
      const x = current % row;
      const z = Math.floor(current / row);
      for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const nextX = x + offsetX;
          const nextZ = z + offsetZ;
          if (nextX < 0 || nextX >= row || nextZ < 0 || nextZ >= row) continue;
          const next = nextZ * row + nextX;
          if (!elevated[next]) continue;
          elevated[next] = 0;
          queue.push(next);
        }
      }
    }
    sizes.push(queue.length);
  }
  return sizes;
};

describe("contour terrain", () => {
  test("authors large plateaus around one connected route network", () => {
    const plan = createContourTerrainPlan(createTerrainFrame(77, 2));

    expect(plan.plateaus).toHaveLength(6);
    expect(plan.plateaus.filter((plateau) => plateau.basePlayer !== null)).toHaveLength(2);
    expect(plan.plateaus.filter((plateau) => plateau.basePlayer === null)).toHaveLength(4);
    expect(plan.routes).toHaveLength(8);
    expect(plan.plateaus.every((plateau) => plateau.outer.length >= 1)).toBe(true);
  });

  test("keeps player bases connected in difficult layouts", () => {
    for (const [seed, players] of [
      [0, 5],
      [7, 6],
      [19, 2],
      [50, 2],
      [50, 5],
      [68, 5],
      [68, 6],
      [99, 6],
    ] as const) {
      expect(() => generateTerrainLayout(seed, players)).not.toThrow();
    }
  }, 30_000);

  test("builds the same one-pass plan and height field for a seed", () => {
    const firstPlan = createContourTerrainPlan(createTerrainFrame(77, 4));
    const secondPlan = createContourTerrainPlan(createTerrainFrame(77, 4));

    expect(secondPlan).toEqual(firstPlan);
    expect([...createContourTerrainHeights(secondPlan)])
      .toEqual([...createContourTerrainHeights(firstPlan)]);
  });

  test("uses graph-authored routes in the shared terrain layout", () => {
    for (const [seed, players] of [[77, 2], [0, 5], [7, 6]] as const) {
      const layout = generateTerrainLayout(seed, players);
      expect(layout.openEdges.length).toBeGreaterThan(0);
      expect(layout.counts.minimumBaseRoutes).toBe(2);
      expect(layout.openEdges.every((edge) =>
        layout.regionKinds[edge.a] !== "mountain"
        && layout.regionKinds[edge.b] !== "mountain"
      )).toBe(true);
    }
  }, 30_000);

  test("keeps most terrain on exact authored elevation levels", () => {
    for (const seed of [77, 1234, 2026]) {
      const frame = createTerrainFrame(seed, 2);
      const heights = createContourTerrainHeights(createContourTerrainPlan(frame));
      const exactLevels = [...heights].filter((height) => {
        const level = (height - TERRAIN_BASE_HEIGHT) / TERRAIN_LEVEL_HEIGHT;
        return Math.abs(level - Math.round(level)) < 0.04;
      });

      expect(exactLevels.length / heights.length).toBeGreaterThan(0.84);
    }
  });

  test("forms large contour masses instead of miniature elevated plateaus", () => {
    for (const [seed, players] of [[77, 2], [1234, 2], [8, 6], [77, 6]] as const) {
      const frame = createTerrainFrame(seed, players);
      const heights = createContourTerrainHeights(createContourTerrainPlan(frame));
      const components = elevatedPlateauComponents(
        heights,
        mapSegmentsForSize(frame.size),
      );
      const rasterArtifacts = components.filter((size) => size < 20);
      const visibleComponents = components.filter((size) => size >= 20);

      expect(rasterArtifacts.reduce((sum, size) => sum + size, 0)).toBeLessThan(20);
      expect(Math.min(...visibleComponents)).toBeGreaterThan(500);
    }
  }, 30_000);
});
