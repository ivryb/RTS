import { describe, expect, test } from "bun:test";
import { TERRAIN_BASE_HEIGHT, TERRAIN_LEVEL_HEIGHT } from "../src/mapConstants";
import {
  createSmoothedContourHeights,
  createWalkableContourHeights,
} from "../src/terrainContourSmoothing";

describe("terrain contour smoothing", () => {
  test("rounds corners while preserving broad authored plateaus", () => {
    const resolution = 25;
    const levels = new Uint8Array(resolution * resolution);
    for (let z = 5; z <= 19; z += 1) {
      for (let x = 5; x <= 19; x += 1) levels[z * resolution + x] = 1;
    }
    for (let z = 9; z <= 15; z += 1) {
      for (let x = 9; x <= 15; x += 1) levels[z * resolution + x] = 2;
    }

    const heights = createSmoothedContourHeights(levels, resolution);
    const heightAt = (x: number, z: number) => heights[z * resolution + x]!;

    expect(heightAt(0, 0)).toBeCloseTo(TERRAIN_BASE_HEIGHT);
    expect(heightAt(12, 12)).toBeCloseTo(TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT * 2);
    expect(heightAt(5, 5)).toBeLessThan(heightAt(12, 5));
    expect([...heights].every((height) =>
      height >= TERRAIN_BASE_HEIGHT
      && height <= TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT * 2
    )).toBe(true);
  });

  test("can turn a hard footprint into one broad walkable hill profile", () => {
    const resolution = 41;
    const levels = new Uint8Array(resolution * resolution);
    for (let z = 8; z <= 32; z += 1) {
      for (let x = 8; x <= 32; x += 1) levels[z * resolution + x] = 1;
    }

    const heights = createWalkableContourHeights(levels, resolution);
    const middleRow = [...heights.slice(20 * resolution, 21 * resolution)];
    const transition = middleRow.filter((height) =>
      height > TERRAIN_BASE_HEIGHT + 0.05 * TERRAIN_LEVEL_HEIGHT
      && height < TERRAIN_BASE_HEIGHT + 0.95 * TERRAIN_LEVEL_HEIGHT
    );
    const maximumStep = Math.max(...middleRow.slice(1).map((height, index) =>
      Math.abs(height - middleRow[index]!)
    ));

    expect(transition.length).toBeGreaterThanOrEqual(10);
    expect(middleRow[20]).toBeCloseTo(TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT);
    expect(maximumStep).toBeLessThan(TERRAIN_LEVEL_HEIGHT * 0.16);
    expect(middleRow.slice(0, 21).every((height, index, row) =>
      index === 0 || height >= row[index - 1]!
    )).toBe(true);
  });

  test("rejects a mismatched level grid", () => {
    expect(() => createSmoothedContourHeights(new Uint8Array(8), 3)).toThrow(RangeError);
  });
});
