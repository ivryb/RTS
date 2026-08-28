// Compiles gameplay topology into organic mesas and blocked mountains.
import {
  mapScaleForSize,
  mapSegmentsForSize,
  TERRAIN_BASE_HEIGHT,
  TERRAIN_LEVEL_HEIGHT,
} from "./mapConstants";
import {
  generateMapTopology,
  type MapTopology,
  type TopologyEdge,
  type TopologyPoint,
} from "./mapTopology";
import {
  MAXIMUM_GROUND_CLEARANCE,
  MAXIMUM_WALKABLE_SLOPE,
} from "./navigationConfig";
import { createWalkableContourHeights } from "./terrainContourSmoothing";
import { createTerrainReachability } from "./terrainWalkability";

export type TerrainRegionKind = "lowland" | "mesa" | "mountain";

export interface GraphTerrainLayout {
  seed: number;
  topologySeed: number;
  playerCount: number;
  size: number;
  segments: number;
  topology: MapTopology;
  heights: Float32Array;
  mountainMask: Float32Array;
  mountainFoundationMask: Float32Array;
  ownerNodeIds: Int16Array;
  regionKinds: readonly TerrainRegionKind[];
  startingLocations: TopologyPoint[];
  openEdges: TopologyEdge[];
  counts: {
    walkableMesas: number;
    mountainRanges: number;
    ramps: number;
    minimumBaseRoutes: number;
    chokepoints: number;
  };
}

interface MaskComponent {
  cells: number[];
  maximumDepth: number;
  insetDepth: number;
}

const MESA_MINIMUM_HALF_WIDTH = 9;
const MOUNTAIN_HEIGHT_LEVELS = 5;
const MOUNTAIN_FOUNDATION_BLUR_PASSES = 12;
const BASE_FLAT_RADIUS = 28;
const BASE_FADE_RADIUS = 36;
const REGION_KINDS = ["lowland", "mesa", "mountain"] as const;

const smoothstep = (start: number, end: number, value: number) => {
  const ratio = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return ratio * ratio * (3 - 2 * ratio);
};

const hashNoise = (x: number, z: number, seed: number) => {
  let value = Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495)
    ^ Math.imul(seed, 0x6c8e9cf5);
  value = Math.imul(value ^ value >>> 15, value | 1);
  return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
};

const valueNoise = (x: number, z: number, seed: number) => {
  const left = Math.floor(x);
  const top = Math.floor(z);
  const horizontal = smoothstep(0, 1, x - left);
  const vertical = smoothstep(0, 1, z - top);
  const upper = hashNoise(left, top, seed) * (1 - horizontal)
    + hashNoise(left + 1, top, seed) * horizontal;
  const lower = hashNoise(left, top + 1, seed) * (1 - horizontal)
    + hashNoise(left + 1, top + 1, seed) * horizontal;
  return upper * (1 - vertical) + lower * vertical;
};

const blurField = (values: Float32Array, resolution: number, passes: number) => {
  let current = values;
  for (let pass = 0; pass < passes; pass += 1) {
    const horizontal = new Float32Array(current.length);
    const next = new Float32Array(current.length);
    for (let z = 0; z < resolution; z += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const left = current[z * resolution + Math.max(0, x - 1)]!;
        const center = current[z * resolution + x]!;
        const right = current[z * resolution + Math.min(resolution - 1, x + 1)]!;
        horizontal[z * resolution + x] = (left + center * 2 + right) / 4;
      }
    }
    for (let z = 0; z < resolution; z += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const top = horizontal[Math.max(0, z - 1) * resolution + x]!;
        const center = horizontal[z * resolution + x]!;
        const bottom = horizontal[Math.min(resolution - 1, z + 1) * resolution + x]!;
        next[z * resolution + x] = (top + center * 2 + bottom) / 4;
      }
    }
    current = next;
  }
  return current;
};

/** Gives sandy mesas broad slopes that ground units can climb from any side. */
const createWalkableMesaHeights = (
  levels: Uint8Array,
  resolution: number,
) => createWalkableContourHeights(levels, resolution);

const neighborsOf = (index: number, resolution: number) => {
  const x = index % resolution;
  const z = Math.floor(index / resolution);
  return [
    x > 0 ? index - 1 : -1,
    x + 1 < resolution ? index + 1 : -1,
    z > 0 ? index - resolution : -1,
    z + 1 < resolution ? index + resolution : -1,
  ];
};

const nearestNodeId = (topology: MapTopology, point: TopologyPoint) => topology.nodes.reduce(
  (nearest, node) => {
    const nearestNode = topology.nodes[nearest]!;
    const candidateDistance = (node.x - point.x) ** 2 + (node.z - point.z) ** 2;
    const nearestDistance = (nearestNode.x - point.x) ** 2 + (nearestNode.z - point.z) ** 2;
    return candidateDistance < nearestDistance ? node.id : nearest;
  },
  topology.nodes[0]!.id,
);

const createOwnerGrid = (topology: MapTopology, resolution: number) => {
  const owners = new Int16Array(resolution * resolution);
  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const point = {
        x: (x / (resolution - 1) - 0.5) * topology.size,
        z: (z / (resolution - 1) - 0.5) * topology.size,
      };
      owners[z * resolution + x] = nearestNodeId(topology, point);
    }
  }
  return owners;
};

const removeDetachedRoleFragments = (
  roles: Uint8Array,
  topology: MapTopology,
  regionKinds: readonly TerrainRegionKind[],
  resolution: number,
) => {
  const anchoredCells = REGION_KINDS.map((kind) => new Set(topology.nodes
    .filter((node) => regionKinds[node.id] === kind)
    .map((node) => {
      const x = Math.round((node.x / topology.size + 0.5) * (resolution - 1));
      const z = Math.round((node.z / topology.size + 0.5) * (resolution - 1));
      return z * resolution + x;
    })));
  const visited = new Uint8Array(roles.length);
  for (let start = 0; start < roles.length; start += 1) {
    if (visited[start]) continue;
    const role = roles[start]!;
    const cells = [start];
    const adjacentRoleCounts = new Uint16Array(REGION_KINDS.length);
    let anchored = anchoredCells[role]!.has(start);
    visited[start] = 1;
    for (let read = 0; read < cells.length; read += 1) {
      const cell = cells[read]!;
      for (const neighbor of neighborsOf(cell, resolution)) {
        if (neighbor < 0) continue;
        if (roles[neighbor] !== role) {
          adjacentRoleCounts[roles[neighbor]!] += 1;
          continue;
        }
        if (visited[neighbor]) continue;
        visited[neighbor] = 1;
        anchored ||= anchoredCells[role]!.has(neighbor);
        cells.push(neighbor);
      }
    }
    if (anchored) continue;
    let replacement = role;
    for (let candidate = 0; candidate < adjacentRoleCounts.length; candidate += 1) {
      if (adjacentRoleCounts[candidate]! > adjacentRoleCounts[replacement]!) {
        replacement = candidate;
      }
    }
    if (!topology.nodes.some((node) => regionKinds[node.id] === REGION_KINDS[replacement])) {
      continue;
    }
    for (const cell of cells) roles[cell] = replacement;
  }
  return roles;
};

/** Rounds the hidden Voronoi roles, then perturbs their shared contour as one field. */
const createOrganicOwnerGrid = (
  topology: MapTopology,
  regionKinds: readonly TerrainRegionKind[],
  sourceOwners: Int16Array,
  resolution: number,
) => {
  const scale = mapScaleForSize(topology.size);
  const roleFields = REGION_KINDS.map((kind) => blurField(
    Float32Array.from(sourceOwners, (owner) => Number(regionKinds[owner] === kind)),
    resolution,
    7,
  ));
  const roleNodes = REGION_KINDS.map((kind) =>
    topology.nodes.filter((node) => regionKinds[node.id] === kind)
  );
  const rampCenters = topology.edges
    .filter((edge) => edge.kind === "ramp"
      && regionKinds[edge.a] !== "mountain"
      && regionKinds[edge.b] !== "mountain")
    .map((edge) => ({
      x: (edge.border.start.x + edge.border.end.x) / 2,
      z: (edge.border.start.z + edge.border.end.z) / 2,
    }));
  const selectedRoles = new Uint8Array(sourceOwners.length);
  const noiseSeeds = [0x243f6a88, 0x85a308d3, 0x13198a2e] as const;

  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const index = z * resolution + x;
      const point = {
        x: (x / (resolution - 1) - 0.5) * topology.size,
        z: (z / (resolution - 1) - 0.5) * topology.size,
      };
      const nearestNodeDistance = Math.min(...topology.nodes.map((node) =>
        Math.hypot(point.x - node.x, point.z - node.z)
      ));
      const nearestRampDistance = rampCenters.length
        ? Math.min(...rampCenters.map((ramp) => Math.hypot(point.x - ramp.x, point.z - ramp.z)))
        : Infinity;
      const strongestRole = Math.max(...roleFields.map((field) => field[index]!));
      const contourStrength = smoothstep(5 * scale, 15 * scale, nearestNodeDistance)
        * smoothstep(8 * scale, 20 * scale, nearestRampDistance)
        * smoothstep(0.02, 0.35, 1 - strongestRole);
      const sourceRole = REGION_KINDS.indexOf(regionKinds[sourceOwners[index]!]!);
      let selectedRole = 0;
      let selectedScore = -Infinity;
      for (let role = 0; role < REGION_KINDS.length; role += 1) {
        if (!roleNodes[role]!.length) continue;
        // Noise may move a nearby boundary, but it must not introduce a third
        // terrain role with no local support and leave detached hill shards.
        if (role !== sourceRole && roleFields[role]![index]! < 0.001) continue;
        const broadNoise = valueNoise(
          point.x / (36 * scale),
          point.z / (36 * scale),
          topology.seed ^ noiseSeeds[role]!,
        ) - 0.5;
        const detailNoise = valueNoise(
          point.x / (20 * scale),
          point.z / (20 * scale),
          topology.seed ^ noiseSeeds[(role + 1) % REGION_KINDS.length]!,
        ) - 0.5;
        const score = roleFields[role]![index]!
          + (broadNoise * 2 + detailNoise * 1.4) * contourStrength;
        if (score <= selectedScore) continue;
        selectedRole = role;
        selectedScore = score;
      }
      selectedRoles[index] = selectedRole;
    }
  }

  removeDetachedRoleFragments(selectedRoles, topology, regionKinds, resolution);
  const mountainRole = REGION_KINDS.indexOf("mountain");
  const initialMountainFootprint = Uint8Array.from(selectedRoles, (role) =>
    Number(role === mountainRole)
  );
  const initialMountains = createMaskComponents(initialMountainFootprint, resolution);
  for (const component of initialMountains.components) {
    if (component.insetDepth === 1) continue;
    for (const cell of component.cells) {
      if (initialMountains.depth[cell]! >= component.insetDepth) continue;
      selectedRoles[cell] = roleFields[1]![cell]! > roleFields[0]![cell]! ? 1 : 0;
    }
  }
  const mesaRole = REGION_KINDS.indexOf("mesa");
  const initialMesaFootprint = Uint8Array.from(selectedRoles, (role) =>
    Number(role === mesaRole)
  );
  const initialMesas = createMaskComponents(initialMesaFootprint, resolution);
  for (const component of initialMesas.components) {
    for (const cell of component.cells) {
      const x = cell % resolution;
      const z = Math.floor(cell / resolution);
      let localMaximumDepth = initialMesas.depth[cell]!;
      for (let offsetZ = -4; offsetZ <= 4; offsetZ += 1) {
        for (let offsetX = -4; offsetX <= 4; offsetX += 1) {
          const sampleX = x + offsetX;
          const sampleZ = z + offsetZ;
          if (sampleX < 0 || sampleX >= resolution || sampleZ < 0 || sampleZ >= resolution) {
            continue;
          }
          const sample = sampleZ * resolution + sampleX;
          if (initialMesas.componentIds[sample] !== initialMesas.componentIds[cell]) continue;
          localMaximumDepth = Math.max(localMaximumDepth, initialMesas.depth[sample]!);
        }
      }
      if (localMaximumDepth > 3) continue;
      const point = {
        x: (x / (resolution - 1) - 0.5) * topology.size,
        z: (z / (resolution - 1) - 0.5) * topology.size,
      };
      const nearMesaNode = roleNodes[mesaRole]!.some((node) =>
        Math.hypot(point.x - node.x, point.z - node.z) < 9 * scale
      );
      const nearRamp = rampCenters.some((ramp) =>
        Math.hypot(point.x - ramp.x, point.z - ramp.z) < 10 * scale
      );
      if (!nearMesaNode && !nearRamp) selectedRoles[cell] = 0;
    }
  }
  const compactRoles = selectedRoles.slice();
  const mountainExpansionRadius = 4;
  const nonMountainNodes = topology.nodes.filter((node) =>
    regionKinds[node.id] !== "mountain"
  );
  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const index = z * resolution + x;
      if (compactRoles[index] === mountainRole) continue;
      let nearMountain = false;
      for (let offsetZ = -mountainExpansionRadius;
        offsetZ <= mountainExpansionRadius && !nearMountain;
        offsetZ += 1) {
        for (let offsetX = -mountainExpansionRadius;
          offsetX <= mountainExpansionRadius;
          offsetX += 1) {
          if (Math.hypot(offsetX, offsetZ) > mountainExpansionRadius) continue;
          const sampleX = x + offsetX;
          const sampleZ = z + offsetZ;
          if (sampleX < 0 || sampleX >= resolution || sampleZ < 0 || sampleZ >= resolution) {
            continue;
          }
          if (compactRoles[sampleZ * resolution + sampleX] === mountainRole) {
            nearMountain = true;
            break;
          }
        }
      }
      if (!nearMountain) continue;
      const point = {
        x: (x / (resolution - 1) - 0.5) * topology.size,
        z: (z / (resolution - 1) - 0.5) * topology.size,
      };
      const protectsNode = nonMountainNodes.some((node) =>
        Math.hypot(point.x - node.x, point.z - node.z) < 8 * scale
      );
      const protectsRamp = rampCenters.some((ramp) =>
        Math.hypot(point.x - ramp.x, point.z - ramp.z) < 10 * scale
      );
      if (!protectsNode && !protectsRamp) selectedRoles[index] = mountainRole;
    }
  }
  removeDetachedRoleFragments(selectedRoles, topology, regionKinds, resolution);
  const owners = new Int16Array(sourceOwners.length);
  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const index = z * resolution + x;
      const point = {
        x: (x / (resolution - 1) - 0.5) * topology.size,
        z: (z / (resolution - 1) - 0.5) * topology.size,
      };
      owners[index] = roleNodes[selectedRoles[index]!]!.reduce((nearest, node) => {
        const nearestDistance = (nearest.x - point.x) ** 2 + (nearest.z - point.z) ** 2;
        const candidateDistance = (node.x - point.x) ** 2 + (node.z - point.z) ** 2;
        return candidateDistance < nearestDistance ? node : nearest;
      }).id;
    }
  }
  return owners;
};

const createLabelDepth = (labels: Int16Array, resolution: number) => {
  const depth = new Int16Array(labels.length);
  const queue = new Int32Array(labels.length);
  let write = 0;
  for (let index = 0; index < labels.length; index += 1) {
    if (neighborsOf(index, resolution).some((neighbor) =>
      neighbor < 0 || labels[neighbor] !== labels[index]
    )) {
      depth[index] = 1;
      queue[write++] = index;
    }
  }
  for (let read = 0; read < write; read += 1) {
    const current = queue[read]!;
    for (const neighbor of neighborsOf(current, resolution)) {
      if (neighbor < 0 || depth[neighbor] || labels[neighbor] !== labels[current]) continue;
      depth[neighbor] = depth[current]! + 1;
      queue[write++] = neighbor;
    }
  }
  return depth;
};

const assignRegionKinds = (
  topology: MapTopology,
  ownerGrid: Int16Array,
  resolution: number,
) => {
  const plateauLabels = Int16Array.from(ownerGrid, (nodeId) =>
    topology.nodes[nodeId]!.plateau
  );
  const plateauDepth = createLabelDepth(plateauLabels, resolution);
  const maximumDepthByPlateau = new Map<number, number>();
  for (let index = 0; index < plateauLabels.length; index += 1) {
    const plateau = plateauLabels[index]!;
    maximumDepthByPlateau.set(
      plateau,
      Math.max(maximumDepthByPlateau.get(plateau) ?? 0, plateauDepth[index]!),
    );
  }
  const cellSize = topology.size / (resolution - 1);
  const kindByPlateau = new Map<number, TerrainRegionKind>();
  for (const plateau of topology.plateaus) {
    if (plateau.elevation === 0) {
      kindByPlateau.set(plateau.id, "lowland");
      continue;
    }
    if (plateau.basePlayers.length) {
      kindByPlateau.set(plateau.id, "mesa");
      continue;
    }
    const halfWidth = (maximumDepthByPlateau.get(plateau.id) ?? 0) * cellSize;
    kindByPlateau.set(
      plateau.id,
      plateau.elevation === 1 && halfWidth >= MESA_MINIMUM_HALF_WIDTH
        ? "mesa"
        : "mountain",
    );
  }
  return topology.nodes.map((node) =>
    kindByPlateau.get(node.plateau) ?? "lowland"
  );
};

const routeCountBetweenBases = (
  topology: MapTopology,
  regionKinds: readonly TerrainRegionKind[],
) => {
  const edges = topology.edges.filter((edge) =>
    regionKinds[edge.a] !== "mountain" && regionKinds[edge.b] !== "mountain"
  );
  const neighbors = Array.from({ length: topology.nodes.length }, () => [] as Array<{
    node: number;
    edge: number;
  }>);
  edges.forEach((edge, index) => {
    neighbors[edge.a]!.push({ node: edge.b, edge: index });
    neighbors[edge.b]!.push({ node: edge.a, edge: index });
  });
  const discovery = new Int16Array(topology.nodes.length).fill(-1);
  const low = new Int16Array(topology.nodes.length);
  const bridges = new Set<number>();
  let time = 0;
  const visit = (node: number, parentEdge: number) => {
    discovery[node] = time;
    low[node] = time;
    time += 1;
    for (const next of neighbors[node]!) {
      if (next.edge === parentEdge) continue;
      if (discovery[next.node]! >= 0) {
        low[node] = Math.min(low[node]!, discovery[next.node]!);
        continue;
      }
      visit(next.node, next.edge);
      low[node] = Math.min(low[node]!, low[next.node]!);
      if (low[next.node]! > discovery[node]!) bridges.add(next.edge);
    }
  };
  for (let node = 0; node < topology.nodes.length; node += 1) {
    if (regionKinds[node] !== "mountain" && discovery[node]! < 0) visit(node, -1);
  }
  const connected = new Int16Array(topology.nodes.length).fill(-1);
  const resilient = new Int16Array(topology.nodes.length).fill(-1);
  let connectedCount = 0;
  let resilientCount = 0;
  for (let start = 0; start < topology.nodes.length; start += 1) {
    if (regionKinds[start] === "mountain") continue;
    if (connected[start]! < 0) {
      const queue = [start];
      connected[start] = connectedCount;
      for (let read = 0; read < queue.length; read += 1) {
        for (const next of neighbors[queue[read]!]!) {
          if (connected[next.node]! >= 0) continue;
          connected[next.node] = connectedCount;
          queue.push(next.node);
        }
      }
      connectedCount += 1;
    }
    if (resilient[start]! >= 0) continue;
    const queue = [start];
    resilient[start] = resilientCount;
    for (let read = 0; read < queue.length; read += 1) {
      for (const next of neighbors[queue[read]!]!) {
        if (bridges.has(next.edge) || resilient[next.node]! >= 0) continue;
        resilient[next.node] = resilientCount;
        queue.push(next.node);
      }
    }
    resilientCount += 1;
  }
  const bases = topology.nodes.filter((node) => node.purpose === "base");
  let minimum = 2;
  for (let first = 0; first < bases.length; first += 1) {
    for (let second = first + 1; second < bases.length; second += 1) {
      const a = bases[first]!.id;
      const b = bases[second]!.id;
      const routes = connected[a] !== connected[b]
        ? 0
        : resilient[a] === resilient[b]
          ? 2
          : 1;
      minimum = Math.min(minimum, routes);
    }
  }
  return minimum;
};

const walkableGraphIsConnected = (
  topology: MapTopology,
  regionKinds: readonly TerrainRegionKind[],
) => {
  const start = topology.nodes.find((node) => regionKinds[node.id] !== "mountain");
  if (!start) return false;
  const neighbors = Array.from({ length: topology.nodes.length }, () => [] as number[]);
  for (const edge of topology.edges) {
    if (regionKinds[edge.a] === "mountain" || regionKinds[edge.b] === "mountain") continue;
    neighbors[edge.a]!.push(edge.b);
    neighbors[edge.b]!.push(edge.a);
  }
  const visited = new Set([start.id]);
  const queue = [start.id];
  for (let read = 0; read < queue.length; read += 1) {
    for (const neighbor of neighbors[queue[read]!]!) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return topology.nodes.every((node) =>
    regionKinds[node.id] === "mountain" || visited.has(node.id)
  );
};

const createMaskComponents = (
  footprint: Uint8Array,
  resolution: number,
) => {
  const componentIds = new Int16Array(footprint.length).fill(-1);
  const components: MaskComponent[] = [];
  for (let start = 0; start < footprint.length; start += 1) {
    if (!footprint[start] || componentIds[start] >= 0) continue;
    const cells = [start];
    const id = components.length;
    componentIds[start] = id;
    for (let read = 0; read < cells.length; read += 1) {
      for (const neighbor of neighborsOf(cells[read]!, resolution)) {
        if (neighbor < 0 || !footprint[neighbor] || componentIds[neighbor] >= 0) continue;
        componentIds[neighbor] = id;
        cells.push(neighbor);
      }
    }
    components.push({ cells, maximumDepth: 1, insetDepth: 1 });
  }
  const depth = createLabelDepth(componentIds, resolution);
  for (const component of components) {
    component.maximumDepth = component.cells.reduce(
      (maximum, cell) => Math.max(maximum, depth[cell]!),
      1,
    );
    component.insetDepth = Math.max(1, Math.round(component.maximumDepth * 0.35));
  }
  return { components, componentIds, depth };
};

/**
 * Builds the shared terrain layout used by gameplay and previews.
 * Topology owns region roles and connectivity. Organic shaping only changes the
 * contour and vertical profile inside each authored region.
 */
const compileGraphTerrainLayout = (
  seed: number,
  playerCount: number,
  topology: MapTopology,
): GraphTerrainLayout => {
  const segments = mapSegmentsForSize(topology.size);
  const resolution = segments + 1;
  const unwarpedOwners = createOwnerGrid(topology, resolution);
  const regionKinds = assignRegionKinds(topology, unwarpedOwners, resolution);
  const owners = createOrganicOwnerGrid(
    topology,
    regionKinds,
    unwarpedOwners,
    resolution,
  );
  const mesaLevels = Uint8Array.from(owners, (nodeId) =>
    Number(regionKinds[nodeId] === "mesa")
  );
  const mountainFootprint = Uint8Array.from(owners, (nodeId) =>
    Number(regionKinds[nodeId] === "mountain")
  );
  const { components, depth } = createMaskComponents(
    mountainFootprint,
    resolution,
  );
  const mountainNoise = blurField(
    Float32Array.from(owners, (_, index) =>
      hashNoise(index % resolution, Math.floor(index / resolution), seed ^ 0x27d4eb2d)
    ),
    resolution,
    6,
  );
  const mountainRise = new Float32Array(owners.length);
  const hardMountainMask = new Float32Array(owners.length);
  for (const component of components) {
    let minimumNoise = Infinity;
    let maximumNoise = -Infinity;
    for (const cell of component.cells) {
      if (depth[cell]! < component.insetDepth) continue;
      minimumNoise = Math.min(minimumNoise, mountainNoise[cell]!);
      maximumNoise = Math.max(maximumNoise, mountainNoise[cell]!);
    }
    for (const cell of component.cells) {
      const depthRatio = depth[cell]! / component.maximumDepth;
      const ridgeProfile = 0.33
        + Math.pow(smoothstep(0, 1, depthRatio), 1.55) * 0.67;
      const normalizedNoise = (mountainNoise[cell]! - minimumNoise)
        / Math.max(0.0001, maximumNoise - minimumNoise);
      const variation = 0.9 + normalizedNoise * 0.2;
      const authoredPeak = topology.nodes[owners[cell]!]!.elevation === 2 ? 0.12 : 0;
      mountainRise[cell] = MOUNTAIN_HEIGHT_LEVELS * TERRAIN_LEVEL_HEIGHT
        * Math.min(1.12, ridgeProfile + authoredPeak)
        * variation;
      hardMountainMask[cell] = smoothstep(0, component.insetDepth, depth[cell]!);
    }
  }

  const heights = createWalkableMesaHeights(mesaLevels, resolution);
  const smoothedMountainRise = blurField(mountainRise, resolution, 2);
  const mountainMask = blurField(hardMountainMask, resolution, 2);
  const mountainFoundation = blurField(
    Float32Array.from(mountainFootprint),
    resolution,
    MOUNTAIN_FOUNDATION_BLUR_PASSES,
  );
  const startingLocations = topology.nodes
    .filter((node) => node.purpose === "base")
    .map(({ x, z }) => ({ x, z }));
  for (let index = 0; index < heights.length; index += 1) {
    const kind = regionKinds[owners[index]!]!;
    if (kind !== "mountain") {
      mountainMask[index] = 0;
      continue;
    }
    // Keep the rocky material down to the mountain foot. Geometry interpolation
    // provides the final edge blend without leaving a pale sandy skirt.
    mountainMask[index] = Math.max(0.8, mountainMask[index]!);
    const touchesMesa = neighborsOf(index, resolution).some((neighbor) =>
      neighbor >= 0 && regionKinds[owners[neighbor]!] === "mesa"
    );
    heights[index] = TERRAIN_BASE_HEIGHT + Math.max(
      smoothedMountainRise[index]!,
      touchesMesa ? TERRAIN_LEVEL_HEIGHT : 0,
    );
  }

  // Keep the walkable side of a mountain seam on the authored mesa level.
  for (let index = 0; index < heights.length; index += 1) {
    if (!mesaLevels[index]) continue;
    if (neighborsOf(index, resolution).some((neighbor) => neighbor >= 0
      && mountainFootprint[neighbor])) {
      heights[index] = TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT;
    }
  }
  // The game places its initial buildings around each start, so preserve the
  // broad flat staging area used by the original terrain generator.
  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const index = z * resolution + x;
      if (regionKinds[owners[index]!] === "mountain") continue;
      const point = {
        x: (x / (resolution - 1) - 0.5) * topology.size,
        z: (z / (resolution - 1) - 0.5) * topology.size,
      };
      const nearestBase = Math.min(...startingLocations.map((base) =>
        Math.hypot(point.x - base.x, point.z - base.z)
      ));
      const flatness = 1 - smoothstep(BASE_FLAT_RADIUS, BASE_FADE_RADIUS, nearestBase);
      const baseHeight = TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT;
      heights[index] += (baseHeight - heights[index]!) * flatness;
    }
  }
  const openEdges = topology.edges.filter((edge) =>
    regionKinds[edge.a] !== "mountain" && regionKinds[edge.b] !== "mountain"
  );
  const minimumBaseRoutes = routeCountBetweenBases(topology, regionKinds);
  const walkablePlateaus = new Set(topology.nodes
    .filter((node) => regionKinds[node.id] === "mesa")
    .map((node) => node.plateau));

  return {
    seed,
    topologySeed: topology.seed,
    playerCount,
    size: topology.size,
    segments,
    topology,
    heights,
    mountainMask,
    mountainFoundationMask: mountainFoundation,
    ownerNodeIds: owners,
    regionKinds,
    startingLocations,
    openEdges,
    counts: {
      walkableMesas: walkablePlateaus.size,
      mountainRanges: components.length,
      ramps: openEdges.filter((edge) => edge.kind === "ramp").length,
      minimumBaseRoutes,
      chokepoints: openEdges.filter((edge) => topology.chokeEdgeIds.has(edge.id)).length,
    },
  };
};

const physicallyMatchesWalkableGraph = (layout: GraphTerrainLayout) => {
  if (layout.counts.mountainRanges < 1 || layout.counts.minimumBaseRoutes < 2
    || !walkableGraphIsConnected(layout.topology, layout.regionKinds)) return false;
  const firstBase = layout.startingLocations[0];
  if (!firstBase) return false;
  const reachable = createTerrainReachability(
    layout,
    firstBase,
    MAXIMUM_WALKABLE_SLOPE,
    MAXIMUM_GROUND_CLEARANCE,
  );
  const nodeRolesMatch = layout.topology.nodes.every((node) =>
    layout.regionKinds[node.id] === "mountain" ? !reachable(node) : reachable(node)
  );
  const openEdgesCross = layout.openEdges
    .filter((edge) => edge.kind === "ramp")
    .every((edge) => reachable({
      x: (edge.border.start.x + edge.border.end.x) / 2,
      z: (edge.border.start.z + edge.border.end.z) / 2,
    }));
  return nodeRolesMatch && openEdgesCross;
};

export const generateGraphTerrainLayout = (
  seed: number,
  playerCount = 2,
): GraphTerrainLayout => {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
    throw new RangeError("Terrain generation supports between two and six players");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const topologySeed = attempt === 0
      ? seed
      : (seed ^ Math.imul(attempt, 0x9e3779b1)) >>> 0;
    try {
      const layout = compileGraphTerrainLayout(
        seed,
        playerCount,
        generateMapTopology(topologySeed, playerCount),
      );
      if (physicallyMatchesWalkableGraph(layout)) return layout;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not generate terrain for seed ${seed}`, { cause: lastError });
};
