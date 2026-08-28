import { describe, expect, test } from "bun:test";
import { TERRAIN_BASE_HEIGHT } from "../src/mapConstants";
import { createTerrainSkirtGeometry } from "../src/terrain";

describe("terrain rendering", () => {
  test("closes elevated map edges down to the low ground", () => {
    const geometry = createTerrainSkirtGeometry({
      size: 2,
      segments: 1,
      heights: new Float32Array([5, 5, 5, 5]),
    }, 2);
    const positions = geometry.getAttribute("position");

    expect(positions.count).toBe(64);
    expect(geometry.index?.count).toBe(96);
    for (let index = 0; index < positions.count; index += 4) {
      expect(positions.getY(index)).toBe(5);
      expect(positions.getY(index + 1)).toBe(5);
      expect(positions.getY(index + 2)).toBeCloseTo(TERRAIN_BASE_HEIGHT - 0.3);
      expect(positions.getY(index + 3)).toBeCloseTo(TERRAIN_BASE_HEIGHT - 0.3);
    }
  });
});
