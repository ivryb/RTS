import { describe, expect, test } from "bun:test";
import {
  TERRAIN_BASE_HEIGHT,
  TERRAIN_LEVEL_HEIGHT,
} from "../src/mapConstants";
import {
  MAXIMUM_GROUND_CLEARANCE,
  MAXIMUM_WALKABLE_SLOPE,
} from "../src/navigationConfig";
import {
  generateGraphTerrainLayout,
  type TerrainRegionKind,
} from "../src/graphTerrain";
import { createTerrainReachability } from "../src/terrainWalkability";

const valueAt = (
  values: Float32Array,
  layout: ReturnType<typeof generateGraphTerrainLayout>,
  point: { x: number; z: number },
) => {
  const row = layout.segments + 1;
  const x = Math.round((point.x / layout.size + 0.5) * layout.segments);
  const z = Math.round((point.z / layout.size + 0.5) * layout.segments);
  return values[z * row + x]!;
};

const gridIndexAt = (
  layout: ReturnType<typeof generateGraphTerrainLayout>,
  point: { x: number; z: number },
) => {
  const row = layout.segments + 1;
  const x = Math.round((point.x / layout.size + 0.5) * layout.segments);
  const z = Math.round((point.z / layout.size + 0.5) * layout.segments);
  return z * row + x;
};

const mountainComponents = (
  layout: ReturnType<typeof generateGraphTerrainLayout>,
) => {
  const resolution = layout.segments + 1;
  const componentIds = new Int16Array(layout.ownerNodeIds.length).fill(-1);
  const components: number[][] = [];
  const isMountain = (index: number) =>
    layout.regionKinds[layout.ownerNodeIds[index]!] === "mountain";
  const neighborsOf = (index: number) => {
    const x = index % resolution;
    const z = Math.floor(index / resolution);
    return [
      x > 0 ? index - 1 : -1,
      x + 1 < resolution ? index + 1 : -1,
      z > 0 ? index - resolution : -1,
      z + 1 < resolution ? index + resolution : -1,
    ];
  };
  for (let start = 0; start < componentIds.length; start += 1) {
    if (!isMountain(start) || componentIds[start]! >= 0) continue;
    const id = components.length;
    const cells = [start];
    componentIds[start] = id;
    for (let read = 0; read < cells.length; read += 1) {
      for (const neighbor of neighborsOf(cells[read]!)) {
        if (neighbor < 0 || !isMountain(neighbor) || componentIds[neighbor]! >= 0) continue;
        componentIds[neighbor] = id;
        cells.push(neighbor);
      }
    }
    components.push(cells);
  }
  return { componentIds, components };
};

const basesShareWalkableGraph = (
  layout: ReturnType<typeof generateGraphTerrainLayout>,
) => {
  const neighbors = Array.from({ length: layout.topology.nodes.length }, () => [] as number[]);
  for (const edge of layout.openEdges) {
    neighbors[edge.a]!.push(edge.b);
    neighbors[edge.b]!.push(edge.a);
  }
  const bases = layout.topology.nodes.filter((node) => node.purpose === "base");
  const visited = new Set([bases[0]!.id]);
  const queue = [bases[0]!.id];
  for (let read = 0; read < queue.length; read += 1) {
    for (const neighbor of neighbors[queue[read]!]!) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return bases.every((base) => visited.has(base.id));
};

const boundaryCurvature = (
  layout: ReturnType<typeof generateGraphTerrainLayout>,
) => {
  const resolution = layout.segments + 1;
  const sampleStep = layout.size / layout.segments / 2;
  const kindAt = (x: number, z: number) => {
    const column = Math.max(0, Math.min(
      layout.segments,
      Math.round((x / layout.size + 0.5) * layout.segments),
    ));
    const row = Math.max(0, Math.min(
      layout.segments,
      Math.round((z / layout.size + 0.5) * layout.segments),
    ));
    return layout.regionKinds[layout.ownerNodeIds[row * resolution + column]!]!;
  };
  const residuals: number[] = [];
  let eligibleBorders = 0;
  for (const border of layout.topology.borders) {
    if (border.neighbor === null || border.node > border.neighbor) continue;
    const firstRole = layout.regionKinds[border.node]!;
    const secondRole = layout.regionKinds[border.neighbor]!;
    if (firstRole === secondRole) continue;
    const dx = border.end.x - border.start.x;
    const dz = border.end.z - border.start.z;
    const length = Math.hypot(dx, dz);
    if (length < 10) continue;
    eligibleBorders += 1;
    const normal = { x: -dz / length, z: dx / length };
    const offsets: number[] = [];
    for (let sample = 1; sample <= 11; sample += 1) {
      const ratio = sample / 12;
      const point = {
        x: border.start.x + dx * ratio,
        z: border.start.z + dz * ratio,
      };
      let nearest: number | undefined;
      let previous: TerrainRegionKind | undefined;
      for (let offset = -14; offset <= 14; offset += sampleStep) {
        const kind = kindAt(point.x + normal.x * offset, point.z + normal.z * offset);
        const crossesExpectedRoles = previous !== undefined && (
          previous === firstRole && kind === secondRole
          || previous === secondRole && kind === firstRole
        );
        if (crossesExpectedRoles) {
          const crossing = offset - sampleStep / 2;
          if (nearest === undefined || Math.abs(crossing) < Math.abs(nearest)) nearest = crossing;
        }
        previous = kind;
      }
      if (nearest !== undefined) offsets.push(nearest);
    }
    if (offsets.length < 7) continue;
    const count = offsets.length;
    const sumX = (count - 1) * count / 2;
    const sumY = offsets.reduce((sum, value) => sum + value, 0);
    const sumXX = (count - 1) * count * (2 * count - 1) / 6;
    const sumXY = offsets.reduce((sum, value, index) => sum + value * index, 0);
    const denominator = count * sumXX - sumX * sumX;
    const slope = denominator ? (count * sumXY - sumX * sumY) / denominator : 0;
    const intercept = (sumY - slope * sumX) / count;
    residuals.push(Math.sqrt(offsets.reduce((sum, value, index) =>
      sum + (value - intercept - slope * index) ** 2
    , 0) / count));
  }
  return {
    average: residuals.reduce((sum, value) => sum + value, 0) / residuals.length,
    measuredBorders: residuals.length,
    eligibleBorders,
  };
};

const representativeTerrainCases = [[77, 2], [1234, 4], [2026, 6]] as const;
let representativeLayouts: Array<{
  players: number;
  layout: ReturnType<typeof generateGraphTerrainLayout>;
}> | undefined;
const mountainProfileLayouts = () => representativeLayouts ??=
  representativeTerrainCases.map(([seed, players]) => ({
    players,
    layout: generateGraphTerrainLayout(seed, players),
  }));

describe("graph and organic terrain", () => {
  test("breaks long topology borders into curved organic contours across seeds", () => {
    const results = [0, 9, 77, 1234, 2026].map((seed) =>
      boundaryCurvature(generateGraphTerrainLayout(seed, 2))
    );

    expect(results.every((result) =>
      result.measuredBorders / result.eligibleBorders > 0.75
    )).toBe(true);
    expect(Math.min(...results.map((result) => result.average))).toBeGreaterThan(0.5);
    expect(results.reduce((sum, result) => sum + result.average, 0) / results.length)
      .toBeGreaterThan(0.6);
  });

  test("is deterministic and keeps one shared height field", () => {
    const first = generateGraphTerrainLayout(77, 2);
    const second = generateGraphTerrainLayout(77, 2);

    expect(second.regionKinds).toEqual(first.regionKinds);
    expect(second.openEdges.map((edge) => edge.id)).toEqual(first.openEdges.map((edge) => edge.id));
    expect([...second.heights]).toEqual([...first.heights]);
    expect([...second.mountainMask]).toEqual([...first.mountainMask]);
    expect([...second.mountainFoundationMask]).toEqual([...first.mountainFoundationMask]);
  });

  test("keeps walkable mesas flat and mountain regions separate", () => {
    for (const { layout, players } of mountainProfileLayouts()) {
      const mesas = layout.topology.nodes.filter((node) => layout.regionKinds[node.id] === "mesa");
      const mountains = layout.topology.nodes.filter((node) =>
        layout.regionKinds[node.id] === "mountain"
      );

      expect(mesas.length).toBeGreaterThanOrEqual(players);
      expect(mountains.length).toBeGreaterThan(0);
      for (const mesa of mesas) {
        expect(valueAt(layout.mountainMask, layout, mesa)).toBeLessThan(0.05);
      }
      const mesaSamples = [...layout.ownerNodeIds]
        .map((owner, index) => ({ index, kind: layout.regionKinds[owner]! }))
        .filter((sample) => sample.kind === "mesa");
      const mesaHeight = TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT;
      const flatMesaSamples = mesaSamples.filter(({ index }) =>
        Math.abs(layout.heights[index]! - mesaHeight) < 0.15
      );
      expect(Math.max(...mesaSamples.map(({ index }) => layout.heights[index]!)))
        .toBeLessThanOrEqual(mesaHeight + 0.05);
      expect(flatMesaSamples.length / mesaSamples.length).toBeGreaterThan(0.55);
      expect(layout.mountainMask.some((weight) => weight > 0.9)).toBe(true);
      const mountainSamples = [...layout.ownerNodeIds]
        .map((owner, index) => ({ owner, index }))
        .filter(({ owner }) => layout.regionKinds[owner] === "mountain");
      expect(Math.min(...mountainSamples.map(({ index }) => layout.mountainMask[index]!)))
        .toBeGreaterThan(0.75);
      const nonMountainMask = [...layout.ownerNodeIds]
        .map((owner, index) => ({ owner, index }))
        .filter(({ owner }) => layout.regionKinds[owner] !== "mountain")
        .map(({ index }) => layout.mountainMask[index]!);
      expect(Math.max(...nonMountainMask)).toBe(0);
    }
  }, 30_000);

  test("shapes mountains as tall peaks without an interior mesa shelf", () => {
    for (const { layout } of mountainProfileLayouts()) {
      const mesaHeight = TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT;
      const mountains = layout.topology.nodes.filter((node) =>
        layout.regionKinds[node.id] === "mountain"
      );
      const mountainSamples = [...layout.ownerNodeIds]
        .map((owner, index) => ({ owner, index }))
        .filter(({ owner }) => layout.regionKinds[owner] === "mountain");
      expect(Math.max(...layout.heights)).toBeGreaterThan(
        TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT * 4.5,
      );
      const interiorShelfSamples = mountainSamples.filter(({ index }) => {
        if (Math.abs(layout.heights[index]! - mesaHeight) >= 0.02) return false;
        const x = index % (layout.segments + 1);
        const z = Math.floor(index / (layout.segments + 1));
        const neighbors = [
          x > 0 ? index - 1 : -1,
          x < layout.segments ? index + 1 : -1,
          z > 0 ? index - layout.segments - 1 : -1,
          z < layout.segments ? index + layout.segments + 1 : -1,
        ];
        return !neighbors.some((neighbor) => neighbor >= 0
          && layout.regionKinds[layout.ownerNodeIds[neighbor]!] === "mesa");
      });
      expect(interiorShelfSamples).toEqual([]);
      for (const mountain of mountains) {
        expect(valueAt(layout.mountainMask, layout, mountain)).toBeGreaterThan(0);
        expect(valueAt(layout.heights, layout, mountain)).toBeGreaterThan(
          TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT,
        );
      }
    }
  }, 30_000);

  test("surrounds every mountain range with a walkable material foundation", () => {
    for (const { layout } of mountainProfileLayouts()) {
      const { components } = mountainComponents(layout);
      const resolution = layout.segments + 1;
      for (const component of components) {
        const foundation = component.flatMap((index) => {
          const x = index % resolution;
          const z = Math.floor(index / resolution);
          return [
            x > 0 ? index - 1 : -1,
            x + 1 < resolution ? index + 1 : -1,
            z > 0 ? index - resolution : -1,
            z + 1 < resolution ? index + resolution : -1,
          ];
        }).filter((index) => index >= 0
          && layout.regionKinds[layout.ownerNodeIds[index]!] !== "mountain");

        expect(foundation.length).toBeGreaterThan(0);
        expect(foundation.every((index) => layout.mountainMask[index] === 0)).toBe(true);
        expect(foundation.some((index) => layout.mountainFoundationMask[index]! > 0.02))
          .toBe(true);
      }
    }
  }, 30_000);

  test("joins mountains to adjacent mesas without a low trench", () => {
    const mesaHeight = TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT;
    let sharedEdgeSamples = 0;
    for (const seed of [77, 1234, 2026]) {
      const layout = generateGraphTerrainLayout(seed, 2);
      const resolution = layout.segments + 1;
      let seedSharedEdgeSamples = 0;
      let minimumMountainHeight = Infinity;
      let minimumMesaHeight = Infinity;
      let maximumHeightStep = -Infinity;
      for (let index = 0; index < layout.ownerNodeIds.length; index += 1) {
        const owner = layout.ownerNodeIds[index]!;
        if (layout.regionKinds[owner] !== "mountain") continue;
        const x = index % resolution;
        const z = Math.floor(index / resolution);
        const neighbors = [
          x > 0 ? index - 1 : -1,
          x + 1 < resolution ? index + 1 : -1,
          z > 0 ? index - resolution : -1,
          z + 1 < resolution ? index + resolution : -1,
        ];
        for (const neighbor of neighbors) {
          if (neighbor < 0
            || layout.regionKinds[layout.ownerNodeIds[neighbor]!] !== "mesa") continue;
          sharedEdgeSamples += 1;
          seedSharedEdgeSamples += 1;
          minimumMountainHeight = Math.min(minimumMountainHeight, layout.heights[index]!);
          minimumMesaHeight = Math.min(minimumMesaHeight, layout.heights[neighbor]!);
          maximumHeightStep = Math.max(
            maximumHeightStep,
            layout.heights[index]! - layout.heights[neighbor]!,
          );
        }
      }
      expect(minimumMountainHeight).toBeGreaterThanOrEqual(mesaHeight - 0.05);
      expect(minimumMesaHeight).toBeGreaterThanOrEqual(mesaHeight - 0.15);
      expect(maximumHeightStep).toBeLessThanOrEqual(TERRAIN_LEVEL_HEIGHT * 1.25);
      expect(seedSharedEdgeSamples).toBeGreaterThan(0);
    }
    expect(sharedEdgeSamples).toBeGreaterThan(0);
  }, 30_000);

  test("makes walkable mesas climbable around their full perimeter", () => {
    for (const seed of [77, 1234, 2026]) {
      const layout = generateGraphTerrainLayout(seed, 2);
      const resolution = layout.segments + 1;
      const cellSize = layout.size / layout.segments;
      const reachable = createTerrainReachability(
        layout,
        layout.startingLocations[0]!,
        MAXIMUM_WALKABLE_SLOPE,
        MAXIMUM_GROUND_CLEARANCE,
      );
      const boundarySamples: Array<{ x: number; z: number }> = [];
      for (let z = 0; z < resolution; z += 1) {
        for (let x = 0; x < resolution; x += 1) {
          const index = z * resolution + x;
          const kind = layout.regionKinds[layout.ownerNodeIds[index]!]!;
          for (const [neighbor, offsetX, offsetZ] of [
            [x + 1 < resolution ? index + 1 : -1, 0.5, 0],
            [z + 1 < resolution ? index + resolution : -1, 0, 0.5],
          ] as const) {
            if (neighbor < 0) continue;
            const neighborKind = layout.regionKinds[layout.ownerNodeIds[neighbor]!]!;
            if (!(
              kind === "mesa" && neighborKind === "lowland"
              || kind === "lowland" && neighborKind === "mesa"
            )) continue;
            const point = {
              x: ((x + offsetX) / layout.segments - 0.5) * layout.size,
              z: ((z + offsetZ) / layout.segments - 0.5) * layout.size,
            };
            if (Math.max(Math.abs(point.x), Math.abs(point.z))
              > layout.size / 2 - MAXIMUM_GROUND_CLEARANCE - cellSize) continue;
            boundarySamples.push(point);
          }
        }
      }

      expect(boundarySamples.length).toBeGreaterThan(0);
      expect(boundarySamples.filter(reachable).length / boundarySamples.length)
        .toBeGreaterThan(0.9);
    }
  }, 30_000);

  test("does not create detached mountain shards without graph nodes", () => {
    for (const seed of [77, 1234, 2026]) {
      const layout = generateGraphTerrainLayout(seed, 2);
      const { componentIds, components } = mountainComponents(layout);
      const cellArea = (layout.size / layout.segments) ** 2;
      const anchoredComponents = new Set(
        layout.topology.nodes
          .filter((node) => layout.regionKinds[node.id] === "mountain")
          .map((node) => componentIds[gridIndexAt(layout, node)]!),
      );

      expect(anchoredComponents.has(-1)).toBe(false);
      expect(components.every((_, component) => anchoredComponents.has(component))).toBe(true);
      expect(Math.min(...components.map((component) => component.length * cellArea)))
        .toBeGreaterThan(800);
    }
  }, 30_000);

  test("preserves graph and physical access after mountain regions are blocked", () => {
    for (const players of [2, 3, 4, 5, 6]) {
      for (const seed of [0, 9, 20, 77, 128, 1234, 2026]) {
        const layout = generateGraphTerrainLayout(seed, players);
        expect(basesShareWalkableGraph(layout)).toBe(true);
        expect(layout.counts.minimumBaseRoutes).toBe(2);
        expect(layout.openEdges.every((edge) =>
          layout.regionKinds[edge.a] !== "mountain"
          && layout.regionKinds[edge.b] !== "mountain"
        )).toBe(true);

        const reachable = createTerrainReachability(
          layout,
          layout.startingLocations[0]!,
          MAXIMUM_WALKABLE_SLOPE,
          MAXIMUM_GROUND_CLEARANCE,
        );
        const walkableNodes = layout.topology.nodes.filter((node) =>
          layout.regionKinds[node.id] !== "mountain"
        );
        const mountainNodes = layout.topology.nodes.filter((node) =>
          layout.regionKinds[node.id] === "mountain"
        );
        expect(walkableNodes.every(reachable)).toBe(true);
        expect(mountainNodes.every((node) => !reachable(node))).toBe(true);
        expect(layout.openEdges.filter((edge) => edge.kind === "ramp").every((edge) =>
          reachable({
            x: (edge.border.start.x + edge.border.end.x) / 2,
            z: (edge.border.start.z + edge.border.end.z) / 2,
          })
        )).toBe(true);
      }
    }
  }, 60_000);
});
