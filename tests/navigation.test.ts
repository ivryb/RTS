import { beforeAll, describe, expect, test } from "bun:test";
import { generateMap, type TerrainSurface } from "../src/map";
import { initializeNavigation, RecastNavigation } from "../src/sim/navigation";

beforeAll(() => initializeNavigation());

const rampTerrain = (): TerrainSurface => {
  const size = 40;
  const segments = 40;
  const row = segments + 1;
  const heights = new Float32Array(row * row);

  for (let z = 0; z <= segments; z += 1) {
    for (let x = 0; x <= segments; x += 1) {
      const worldX = x - size / 2;
      const worldZ = z - size / 2;
      const ramp = Math.abs(worldZ) < 4;
      heights[z * row + x] = ramp
        ? Math.max(0, Math.min(6, (worldX + 8) / 16 * 6))
        : worldX < 0 ? 0 : 6;
    }
  }

  return { size, segments, heights };
};

const narrowPassTerrain = (): TerrainSurface => {
  const size = 40;
  const segments = 80;
  const row = segments + 1;
  const heights = new Float32Array(row * row);

  for (let z = 0; z <= segments; z += 1) {
    for (let x = 0; x <= segments; x += 1) {
      const worldX = x / segments * size - size / 2;
      const worldZ = z / segments * size - size / 2;
      heights[z * row + x] = Math.abs(worldX) < 2 && Math.abs(worldZ) > 1 ? 6 : 0;
    }
  }

  return { size, segments, heights };
};

describe("terrain navigation", () => {
  test("connects every player base through the generated terrain", () => {
    const map = generateMap(1_174_711_418);
    const navigation = new RecastNavigation(map);
    const start = {
      x: Math.round(map.startingLocations[0].x * 1_000),
      z: Math.round(map.startingLocations[0].z * 1_000),
    };

    for (const base of map.startingLocations.slice(1)) {
      expect(navigation.plan(start, {
        x: Math.round(base.x * 1_000),
        z: Math.round(base.z * 1_000),
      }, 1_524)).toBeDefined();
    }
    navigation.destroy();
  }, 30000);

  test("reaches the authored sites on elevated Shifting Frontiers maps",()=>{
    for(const seed of [77,56204]){
      const map=generateMap(seed,4),navigation=new RecastNavigation(map);
      const start={x:Math.round(map.startingLocations[0].x*1000),z:Math.round(map.startingLocations[0].z*1000)};
      try{
        for(const site of map.layout.sites)expect(navigation.plan(start,{x:Math.round(site.x*1000),z:Math.round(site.z*1000)},1524),`${seed} ${site.label}`).toBeDefined();
      }finally{navigation.destroy();}
    }
  },30000);

  test("routes ground units through the walkable side of a cliff", () => {
    const terrain=rampTerrain();
    terrain.mountainMask=new Float32Array(terrain.heights.length);
    const navigation = new RecastNavigation(terrain);
    const path = navigation.plan(
      { x: -15_000, z: 10_000 },
      { x: 15_000, z: 10_000 },
      450,
    );

    expect(path).toBeDefined();
    expect(path!.some((point) => Math.abs(point.z) < 4_000)).toBe(true);
    expect(path!.at(-1)).toEqual({ x: 15_000, z: 10_000 });
    navigation.destroy();
  });

  test("keeps large ground units out of passages narrower than their footprint", () => {
    const navigation = new RecastNavigation(narrowPassTerrain());
    const start = { x: -15_000, z: 0 };
    const goal = { x: 15_000, z: 0 };

    expect(navigation.plan(start, goal, 450)).toBeDefined();
    expect(navigation.plan(start, goal, 1_524)).toBeUndefined();
    navigation.destroy();
  });

  test("updates temporary building obstacles without replacing the terrain mesh", () => {
    const terrain: TerrainSurface = {
      size: 40,
      segments: 40,
      heights: new Float32Array(41 * 41),
    };
    const navigation = new RecastNavigation(terrain);
    const start = { x: -15_000, z: 0 };
    const goal = { x: 15_000, z: 0 };

    expect(navigation.plan(start, goal, 450)).toEqual([goal]);
    navigation.setObstacles([{ position: { x: 0, z: 0 }, radius: 2_000 }]);
    const detour = navigation.plan(start, goal, 450);
    const largeDetour = navigation.plan(start, goal, 1_524);
    expect(detour).toBeDefined();
    expect(largeDetour).toBeDefined();
    expect(detour!.some((point) => Math.abs(point.z) > 2_000)).toBe(true);
    expect(Math.max(...largeDetour!.map((point) => Math.abs(point.z))))
      .toBeGreaterThan(Math.max(...detour!.map((point) => Math.abs(point.z))));

    navigation.setObstacles([]);
    expect(navigation.plan(start, goal, 450)).toEqual([goal]);
    navigation.destroy();
  });

  test("clears route-specific unit blockers after an impassable route while preserving buildings", () => {
    const navigation = new RecastNavigation({
      size: 40, segments: 40, heights: new Float32Array(41 * 41),
    });
    const start = { x: -15_000, z: 0 };
    const goal = { x: 15_000, z: 0 };
    navigation.setObstacles([{ position: { x: 0, z: 0 }, radius: 2_000 }]);
    try {
      const buildingRoute = navigation.plan(start, goal, 450);
      expect(buildingRoute).toBeDefined();
      expect(buildingRoute!.some((point) => Math.abs(point.z) > 2_000)).toBe(true);
      const wall = [-16, -8, 0, 8, 16].map((z) => ({
        position: { x: 0, z: z * 1_000 }, radius: 4_000,
      }));
      expect(navigation.planAroundObstacles(start, goal, 450, wall)).toBeUndefined();
      expect(navigation.plan(start, goal, 450)).toEqual(buildingRoute);
    } finally {
      navigation.destroy();
    }
  });

});
