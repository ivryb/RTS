import {
  mapScaleForSize,
  mapSizeForPlayerCount,
  TWO_PLAYER_MAP_SIZE,
} from "./mapConstants";

export interface TopologyPoint {
  x: number;
  z: number;
}

export interface TopologyNode extends TopologyPoint {
  id: number;
  purpose: "base" | "central";
  player?: number;
  separatesBases?: readonly [number, number];
  elevation: 0 | 1 | 2;
  plateau: number;
  plateauAccesses: number | null;
  degree: number;
}

export interface TopologyCell {
  node: number;
  polygon: TopologyPoint[];
}

export interface TopologyBorder {
  node: number;
  neighbor: number | null;
  start: TopologyPoint;
  end: TopologyPoint;
  length: number;
  open: boolean;
}

export interface TopologyEdge {
  id: number;
  a: number;
  b: number;
  length: number;
  border: Omit<TopologyBorder, "open">;
  kind: "flat" | "ramp";
}

export interface TopologyPlateau {
  id: number;
  elevation: 0 | 1 | 2;
  nodes: number[];
  basePlayers: number[];
  accesses: number | null;
}

export interface TopologyMetrics {
  accepted: boolean;
  playerCount: number;
  centralRegions: number;
  levelOneRegions: number;
  levelTwoRegions: number;
  elevatedPlateaus: number;
  mergedElevatedPlateaus: number;
  elevatedNetworks: number;
  branchingElevatedNodes: number;
  ramps: number;
  closedCliffSides: number;
  singleAccessPlateaus: number;
  derivedChokes: number;
  minimumBaseRoutes: number;
  baseAccesses: Array<number | null>;
  accessDistribution: number[];
  loops: number;
}

export interface MapTopology {
  seed: number;
  playerCount: number;
  size: number;
  nodes: TopologyNode[];
  cells: TopologyCell[];
  borders: TopologyBorder[];
  edges: TopologyEdge[];
  plateaus: TopologyPlateau[];
  chokeEdgeIds: ReadonlySet<number>;
  metrics: TopologyMetrics;
}

interface DraftNode extends TopologyPoint {
  id: number;
  purpose: "base" | "central";
  player?: number;
  separatesBases?: readonly [number, number];
  elevation: 0 | 1 | 2;
}

type DraftBorder = Omit<TopologyBorder, "open">;

interface CandidateEdge {
  a: number;
  b: number;
  length: number;
  border: DraftBorder;
}

interface DraftPlateau {
  id: number;
  elevation: 0 | 1 | 2;
  nodes: number[];
  basePlayers: number[];
}

const TARGET_BASE_ROUTES = 2;
const BASE_ACCESS_TARGET = 2;
const MAX_NEUTRAL_PLATEAU_ACCESSES = 4;
const TWO_PLAYER_CENTRAL_REGION_COUNT = 24;
const BASE_REGION_CLEARANCE = 48;
const centralRegionCountForSize = (size: number, playerCount: number) => {
  const sizeRatio = size / TWO_PLAYER_MAP_SIZE;
  return Math.round(TWO_PLAYER_CENTRAL_REGION_COUNT * sizeRatio * sizeRatio)
    + playerCount - 2;
};
const levelOneRegionCount = (centralRegions: number) => Math.round(centralRegions * 3 / 10);
const levelTwoRegionCount = (centralRegions: number) => Math.round(centralRegions / 8);

const randomFrom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
};

const distance = (a: TopologyPoint, b: TopologyPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;

const distanceToSegment = (
  point: TopologyPoint,
  start: TopologyPoint,
  end: TopologyPoint,
) => {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared,
  ));
  return Math.hypot(point.x - start.x - dx * ratio, point.z - start.z - dz * ratio);
};

const buildNodes = (
  random: () => number,
  playerCount: number,
  size: number,
  centralRegionCount: number,
) => {
  const scale = mapScaleForSize(size);
  const scaled = (value: number) => value * scale;
  const rotation = playerCount === 2 ? 0 : random() * Math.PI * 2;
  const angleStep = Math.PI * 2 / playerCount;
  // A circular ring leaves oversized Voronoi cells in the map corners.
  const perimeterPoint = (angle: number) => {
    const direction = { x: Math.cos(angle), z: Math.sin(angle) };
    const radius = scaled(128) / Math.max(Math.abs(direction.x), Math.abs(direction.z));
    return { x: direction.x * radius, z: direction.z * radius };
  };
  const bases: DraftNode[] = Array.from({ length: playerCount }, (_, index) => ({
    id: index,
    ...perimeterPoint(rotation + index * angleStep),
    purpose: "base",
    player: index + 1,
    elevation: 1,
  }));
  const separators: DraftNode[] = Array.from({ length: playerCount }, (_, index) => ({
    id: playerCount + index,
    ...perimeterPoint(rotation + (index + 0.5) * angleStep),
    purpose: "central",
    separatesBases: [index, (index + 1) % playerCount],
    elevation: 0,
  }));
  const nodes = [...bases, ...separators];
  const minimumSpacing = 18;
  // Multiplayer maps use the full inset so their corners do not become oversized cells.
  const centralExtent = playerCount === 2 ? 106 : 124;
  while (nodes.length < playerCount + centralRegionCount) {
    const sampleCount = playerCount === 2 ? 24 : 32;
    const candidates = Array.from({ length: sampleCount }, () => ({
      x: scaled(-centralExtent + random() * centralExtent * 2),
      z: scaled(-centralExtent + random() * centralExtent * 2),
    })).map((point) => ({
      point,
      clearance: Math.min(...nodes.map((other) => distance(point, other) / (
        other.purpose === "base" ? BASE_REGION_CLEARANCE
          : minimumSpacing
      ))),
    }));
    const best = candidates.reduce((selected, candidate) =>
      candidate.clearance > selected.clearance ? candidate : selected
    );
    nodes.push({
      id: nodes.length,
      ...best.point,
      purpose: "central",
      elevation: 0,
    });
  }
  return nodes;
};

const bisectorValue = (point: TopologyPoint, site: TopologyPoint, other: TopologyPoint) =>
  (point.x - site.x) ** 2 + (point.z - site.z) ** 2
  - (point.x - other.x) ** 2 - (point.z - other.z) ** 2;

const clipToSite = (
  polygon: TopologyPoint[],
  site: TopologyPoint,
  other: TopologyPoint,
) => {
  const clipped: TopologyPoint[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    const startValue = bisectorValue(start, site, other);
    const endValue = bisectorValue(end, site, other);
    const startInside = startValue <= 0.001;
    const endInside = endValue <= 0.001;
    if (startInside) clipped.push(start);
    if (startInside === endInside) continue;
    const ratio = startValue / (startValue - endValue);
    clipped.push({
      x: start.x + (end.x - start.x) * ratio,
      z: start.z + (end.z - start.z) * ratio,
    });
  }
  return clipped;
};

const buildCells = (nodes: DraftNode[], size: number): TopologyCell[] => nodes.map((node) => {
  const halfSize = size / 2;
  let polygon: TopologyPoint[] = [
    { x: -halfSize, z: -halfSize },
    { x: halfSize, z: -halfSize },
    { x: halfSize, z: halfSize },
    { x: -halfSize, z: halfSize },
  ];
  for (const other of nodes) {
    if (other.id !== node.id) polygon = clipToSite(polygon, node, other);
  }
  return { node: node.id, polygon };
});

const nearestBorderNeighbor = (
  start: TopologyPoint,
  end: TopologyPoint,
  node: DraftNode,
  nodes: DraftNode[],
  size: number,
) => {
  const halfSize = size / 2;
  const midpoint = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
  const onBoundary = Math.abs(Math.abs(midpoint.x) - halfSize) < 0.1
    || Math.abs(Math.abs(midpoint.z) - halfSize) < 0.1;
  if (onBoundary) return null;
  const siteDistance = distance(midpoint, node);
  let nearest: number | null = null;
  let difference = Infinity;
  for (const other of nodes) {
    if (other.id === node.id) continue;
    const candidate = Math.abs(siteDistance - distance(midpoint, other));
    if (candidate < difference) {
      difference = candidate;
      nearest = other.id;
    }
  }
  return difference < 0.5 ? nearest : null;
};

const buildBorders = (nodes: DraftNode[], cells: TopologyCell[], size: number): DraftBorder[] => cells.flatMap(
  (cell) => cell.polygon.map((start, index) => {
    const end = cell.polygon[(index + 1) % cell.polygon.length]!;
    return {
      node: cell.node,
      neighbor: nearestBorderNeighbor(start, end, nodes[cell.node]!, nodes, size),
      start,
      end,
      length: distance(start, end),
    };
  }).filter((border) => border.length > 0.75),
);

const buildCandidates = (nodes: DraftNode[], borders: DraftBorder[]) => {
  const candidates = new Map<string, CandidateEdge>();
  for (const border of borders) {
    if (border.neighbor === null) continue;
    const key = edgeKey(border.node, border.neighbor);
    const previous = candidates.get(key);
    if (previous && previous.border.length >= border.length) continue;
    candidates.set(key, {
      a: Math.min(border.node, border.neighbor),
      b: Math.max(border.node, border.neighbor),
      length: distance(nodes[border.node]!, nodes[border.neighbor]!),
      border,
    });
  }
  return [...candidates.values()];
};

const adjacency = (nodeCount: number, edges: ReadonlyArray<Pick<CandidateEdge, "a" | "b">>) => {
  const graph: Array<Array<{ node: number; edge: number }>> = Array.from(
    { length: nodeCount },
    () => [],
  );
  edges.forEach((edge, index) => {
    graph[edge.a]!.push({ node: edge.b, edge: index });
    graph[edge.b]!.push({ node: edge.a, edge: index });
  });
  return graph;
};

const connected = (nodeCount: number, edges: ReadonlyArray<Pick<CandidateEdge, "a" | "b">>) => {
  const graph = adjacency(nodeCount, edges);
  const queue = [0];
  const visited = new Set(queue);
  for (let read = 0; read < queue.length; read += 1) {
    for (const next of graph[queue[read]!]!) {
      if (visited.has(next.node)) continue;
      visited.add(next.node);
      queue.push(next.node);
    }
  }
  return visited.size === nodeCount;
};

const twoEdgeComponents = (
  nodeCount: number,
  edges: ReadonlyArray<Pick<CandidateEdge, "a" | "b">>,
) => {
  const graph = adjacency(nodeCount, edges);
  const discovery = new Int16Array(nodeCount).fill(-1);
  const low = new Int16Array(nodeCount);
  const bridges = new Set<number>();
  let time = 0;
  const visit = (node: number, parentEdge: number) => {
    discovery[node] = time;
    low[node] = time;
    time += 1;
    for (const next of graph[node]!) {
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
  for (let node = 0; node < nodeCount; node += 1) {
    if (discovery[node]! < 0) visit(node, -1);
  }
  const connectedComponent = new Int16Array(nodeCount).fill(-1);
  const resilientComponent = new Int16Array(nodeCount).fill(-1);
  let connectedCount = 0;
  let resilientCount = 0;
  for (let start = 0; start < nodeCount; start += 1) {
    if (connectedComponent[start]! < 0) {
      const queue = [start];
      connectedComponent[start] = connectedCount;
      for (let read = 0; read < queue.length; read += 1) {
        for (const next of graph[queue[read]!]!) {
          if (connectedComponent[next.node]! >= 0) continue;
          connectedComponent[next.node] = connectedCount;
          queue.push(next.node);
        }
      }
      connectedCount += 1;
    }
    if (resilientComponent[start]! >= 0) continue;
    const queue = [start];
    resilientComponent[start] = resilientCount;
    for (let read = 0; read < queue.length; read += 1) {
      for (const next of graph[queue[read]!]!) {
        if (bridges.has(next.edge) || resilientComponent[next.node]! >= 0) continue;
        resilientComponent[next.node] = resilientCount;
        queue.push(next.node);
      }
    }
    resilientCount += 1;
  }
  return { bridges, connectedComponent, resilientComponent };
};

const hasBaseSeparators = (nodes: DraftNode[], candidates: CandidateEdge[]) => {
  for (const edge of candidates) {
    if (nodes[edge.a]!.purpose === "base" && nodes[edge.b]!.purpose === "base") return false;
  }
  const playerCount = nodes.filter((node) => node.purpose === "base").length;
  const separators = nodes.filter((node) => node.separatesBases);
  return separators.length === playerCount;
};

const buildPlateaus = (nodes: DraftNode[], candidates: CandidateEdge[]) => {
  const byNode: CandidateEdge[][] = Array.from({ length: nodes.length }, () => []);
  for (const edge of candidates) {
    byNode[edge.a]!.push(edge);
    byNode[edge.b]!.push(edge);
  }
  const plateauByNode = new Int16Array(nodes.length).fill(-1);
  const plateaus: DraftPlateau[] = [];
  for (const node of nodes) {
    if (plateauByNode[node.id]! >= 0) continue;
    const id = plateaus.length;
    const members = [node.id];
    plateauByNode[node.id] = id;
    for (let read = 0; read < members.length; read += 1) {
      const current = members[read]!;
      for (const edge of byNode[current]!) {
        const next = edge.a === current ? edge.b : edge.a;
        if (nodes[next]!.elevation !== node.elevation || plateauByNode[next]! >= 0) continue;
        plateauByNode[next] = id;
        members.push(next);
      }
    }
    plateaus.push({
      id,
      elevation: node.elevation,
      nodes: members,
      basePlayers: members.flatMap((nodeId) => {
        const player = nodes[nodeId]!.player;
        return player === undefined ? [] : [player];
      }),
    });
  }
  return { plateaus, plateauByNode };
};

const assignElevation = (
  nodes: DraftNode[],
  candidates: CandidateEdge[],
  cells: TopologyCell[],
  random: () => number,
  size: number,
) => {
  const centralRegionCount = nodes.filter((node) => node.purpose === "central").length;
  const levelOneTarget = levelOneRegionCount(centralRegionCount);
  const levelTwoTarget = levelTwoRegionCount(centralRegionCount);
  const elevatedTarget = levelOneTarget + levelTwoTarget;
  const playerCount = nodes.filter((node) => node.purpose === "base").length;
  const forcedPeakTarget = playerCount === 2
    ? levelTwoTarget
    : Math.max(1, Math.floor(playerCount / 2));
  const neighbors = Array.from({ length: nodes.length }, () => new Set<number>());
  for (const edge of candidates) {
    neighbors[edge.a]!.add(edge.b);
    neighbors[edge.b]!.add(edge.a);
  }
  const baseGatewayOptions = Array.from({ length: playerCount }, (_, player) => candidates
    .filter((edge) => edge.a === player || edge.b === player)
    .sort((a, b) => b.border.length - a.border.length));
  if (baseGatewayOptions.some((options) => options.length < BASE_ACCESS_TARGET)) {
    throw new Error("A player base does not have two gateway regions");
  }
  const baseGateways = baseGatewayOptions.map((options) => options.slice(0, BASE_ACCESS_TARGET));
  const gatewayScore = () => {
    const edges = candidates.filter((edge) =>
      nodes[edge.a]!.purpose === "central" && nodes[edge.b]!.purpose === "central"
    ).concat(baseGateways.flat());
    const components = twoEdgeComponents(nodes.length, edges);
    let minimum = Infinity;
    let total = 0;
    for (let first = 0; first < playerCount; first += 1) {
      for (let second = first + 1; second < playerCount; second += 1) {
        const routes = components.connectedComponent[first]
          !== components.connectedComponent[second] ? 0
          : components.resilientComponent[first] === components.resilientComponent[second]
            ? 2
            : 1;
        minimum = Math.min(minimum, routes);
        total += routes;
      }
    }
    return { minimum, total };
  };
  for (let sweep = 0; sweep < 2; sweep += 1) {
    for (let player = 0; player < playerCount; player += 1) {
      const options = baseGatewayOptions[player]!;
      const pairs = options.flatMap((first, index) => options.slice(index + 1)
        .map((second) => [first, second]));
      baseGateways[player] = pairs.map((pair) => {
        const previous = baseGateways[player]!;
        baseGateways[player] = pair;
        const score = gatewayScore();
        baseGateways[player] = previous;
        return { pair, score };
      }).sort((a, b) => b.score.minimum - a.score.minimum
        || b.score.total - a.score.total
        || b.pair.reduce((total, edge) => total + edge.border.length, 0)
          - a.pair.reduce((total, edge) => total + edge.border.length, 0))[0]!.pair;
    }
  }
  if (gatewayScore().minimum < TARGET_BASE_ROUTES) {
    throw new Error("Base gateways cannot provide two independent routes");
  }
  const baseGatewayKeys = new Set(baseGateways.flat()
    .map((edge) => edgeKey(edge.a, edge.b)));
  const baseGatewayNodeIds = new Set(baseGateways.flat().map((edge) =>
    edge.a < playerCount ? edge.b : edge.a
  ));
  const preservesLowGroundRoutes = (elevated: ReadonlySet<number>) => {
    const lowEdges = candidates.filter((edge) => {
      const first = nodes[edge.a]!;
      const second = nodes[edge.b]!;
      if (first.purpose === "base" || second.purpose === "base") {
        return baseGatewayKeys.has(edgeKey(edge.a, edge.b))
          && !elevated.has(first.purpose === "base" ? second.id : first.id);
      }
      return !elevated.has(first.id) && !elevated.has(second.id);
    });
    const components = twoEdgeComponents(nodes.length, lowEdges);
    return nodes.filter((node) => node.purpose === "base" || !elevated.has(node.id))
      .every((node) => components.connectedComponent[node.id]
        === components.connectedComponent[0])
      && Array.from({ length: playerCount }, (_, player) => player).every((player) =>
      components.connectedComponent[player] === components.connectedComponent[0]
      && components.resilientComponent[player] === components.resilientComponent[0]
    );
  };
  const canElevate = (nodeId: number, elevated: ReadonlySet<number>) =>
    preservesLowGroundRoutes(new Set(elevated).add(nodeId));
  const allRegular = nodes.filter((node) => node.purpose === "central" && !node.separatesBases);
  const baseAdjacentIds = new Set(allRegular.filter((node) => [...neighbors[node.id]!]
    .some((neighbor) => nodes[neighbor]!.purpose === "base")
  ).map((node) => node.id));
  const regular = allRegular.filter((node) => !baseAdjacentIds.has(node.id));
  const regularIds = new Set(regular.map((node) => node.id));
  const regularComponentSize = new Int16Array(nodes.length);
  const visitedRegular = new Set<number>();
  for (const start of regular) {
    if (visitedRegular.has(start.id)) continue;
    const component = [start.id];
    visitedRegular.add(start.id);
    for (let read = 0; read < component.length; read += 1) {
      for (const neighbor of neighbors[component[read]!]!) {
        if (!regularIds.has(neighbor) || visitedRegular.has(neighbor)) continue;
        visitedRegular.add(neighbor);
        component.push(neighbor);
      }
    }
    component.forEach((nodeId) => regularComponentSize[nodeId] = component.length);
  }
  const innerIds = new Set(regular
    .filter((node) => Math.hypot(node.x, node.z) < size * 0.2)
    .map((node) => node.id));
  const cellArea = new Float64Array(nodes.length);
  for (const cell of cells) {
    cellArea[cell.node] = Math.abs(cell.polygon.reduce((area, point, index) => {
      const next = cell.polygon[(index + 1) % cell.polygon.length]!;
      return area + point.x * next.z - next.x * point.z;
    }, 0)) / 2;
  }
  const targetCoverage = elevatedTarget / allRegular.length;
  const innerAreaTarget = [...innerIds]
    .reduce((area, nodeId) => area + cellArea[nodeId]!, 0) * targetCoverage
      * (playerCount === 2 ? 1 : 0.5);
  const rank = new Float64Array(nodes.length);
  for (const node of nodes) rank[node.id] = random();
  const bases = nodes.filter((node) => node.purpose === "base");
  const baseRotation = Math.atan2(bases[0]!.z, bases[0]!.x);
  const sectorWidth = Math.PI / playerCount;
  const sectorFor = (node: TopologyPoint) => Math.floor((
    Math.atan2(node.z, node.x) - baseRotation + Math.PI * 4 + sectorWidth / 2
  ) % (Math.PI * 2) / sectorWidth) % (playerCount * 2);
  const sectorArea = Array.from({ length: playerCount * 2 }, () => 0);
  for (const node of regular) sectorArea[sectorFor(node)]! += cellArea[node.id]!;
  const baseRadius = bases.reduce((total, base) => total + Math.hypot(base.x, base.z), 0)
    / bases.length;
  const anchorTarget = playerCount - 1;
  const plannedAnchors = new Set<number>();
  const anchorPlans = Array.from({ length: anchorTarget }, (_, index) => {
    const wedge = playerCount === 3 ? index * 2 : index;
    const angle = baseRotation + (wedge + 0.5) * Math.PI * 2
      / (playerCount === 3 ? playerCount : anchorTarget);
    const target = {
      x: Math.cos(angle) * baseRadius * (playerCount === 2 ? 0.72 : 0.9),
      z: Math.sin(angle) * baseRadius * (playerCount === 2 ? 0.72 : 0.9),
    };
    const minimumComponentSize = playerCount === 2 ? elevatedTarget : 3;
    const spacious = regular.filter((node) => !plannedAnchors.has(node.id)
      && regularComponentSize[node.id]! >= minimumComponentSize
      && [...neighbors[node.id]!].filter((neighbor) => regularIds.has(neighbor)).length >= 2);
    const candidates = (spacious.length ? spacious : regular.filter((node) =>
      !plannedAnchors.has(node.id)))
      .map((node) => ({ node, targetDistance: distance(node, target) }))
      .sort((a, b) => a.targetDistance - b.targetDistance
        || rank[a.node.id]! - rank[b.node.id]!);
    const extend = (plan: number[], selected: Set<number>): number[] | null => {
      if (plan.length === 3) return plan;
      const options = regular.filter((node) =>
        !selected.has(node.id)
        && [...neighbors[node.id]!].some((neighbor) => plan.includes(neighbor))
      ).sort((a, b) => distance(a, target) - distance(b, target)
        || Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z)
        || rank[a.id]! - rank[b.id]!);
      for (const option of options) {
        const nextSelected = new Set(selected).add(option.id);
        if (!canElevate(option.id, selected)) continue;
        const result = extend([...plan, option.id], nextSelected);
        if (result) return result;
      }
      return null;
    };
    const initialNodes = candidates.map(({ node }) => {
      if (!canElevate(node.id, plannedAnchors)) return null;
      return extend([node.id], new Set(plannedAnchors).add(node.id));
    }).find((plan) => plan !== null);
    if (!initialNodes) throw new Error("Could not place a three-region elevation ridge");
    initialNodes.forEach((nodeId) => plannedAnchors.add(nodeId));
    return { nodeId: initialNodes[0]!, initialNodes, target };
  });
  const anchors = anchorPlans.map(({ nodeId }) => nodeId);
  const elevatedIds = new Set(anchorPlans.flatMap(({ initialNodes }) => initialNodes));
  const forcedPeakIds = new Set<number>();
  const canForcePeak = (nodeId: number) => {
    const peaks = new Set(forcedPeakIds).add(nodeId);
    const elevation = (candidate: number) => peaks.has(candidate) ? 2
      : elevatedIds.has(candidate) ? 1 : 0;
    const centralEdges = candidates.filter((edge) =>
      nodes[edge.a]!.purpose === "central" && nodes[edge.b]!.purpose === "central"
      && Math.abs(elevation(edge.a) - elevation(edge.b)) <= 1
    );
    const graph = adjacency(nodes.length, centralEdges);
    const centralStart = nodes.find((node) => node.purpose === "central")!.id;
    const queue = [centralStart];
    const visited = new Set(queue);
    for (let read = 0; read < queue.length; read += 1) {
      for (const next of graph[queue[read]!]!) {
        if (visited.has(next.node)) continue;
        visited.add(next.node);
        queue.push(next.node);
      }
    }
    return nodes.filter((node) => node.purpose === "central")
      .every((node) => visited.has(node.id));
  };
  const ridgeByNode = new Int16Array(nodes.length).fill(-1);
  const ridgeSizes = anchorPlans.map(({ initialNodes }) => initialNodes.length);
  anchorPlans.forEach(({ initialNodes }, ridge) => initialNodes.forEach((nodeId) =>
    ridgeByNode[nodeId] = ridge
  ));
  const addToRidge = (nodeId: number, ridge: number) => {
    elevatedIds.add(nodeId);
    ridgeByNode[nodeId] = ridge;
    ridgeSizes[ridge]! += 1;
  };
  while (elevatedIds.size < elevatedTarget) {
    const remaining = elevatedTarget - elevatedIds.size;
    if (remaining <= 5) {
      const finish = (selected: Set<number>, plan: number[]): number[] | null => {
        if (plan.length === remaining) return plan;
        const options = regular.filter((node) =>
          !selected.has(node.id)
          && [...neighbors[node.id]!].some((neighbor) => selected.has(neighbor))
          && canElevate(node.id, selected)
        ).sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z)
          || rank[a.id]! - rank[b.id]!);
        for (const option of options) {
          const result = finish(new Set(selected).add(option.id), [...plan, option.id]);
          if (result) return result;
        }
        return null;
      };
      const finishingPlan = finish(new Set(elevatedIds), []);
      if (finishingPlan) {
        for (const nodeId of finishingPlan) {
          const ridge = [...neighbors[nodeId]!].filter((neighbor) => elevatedIds.has(neighbor))
            .map((neighbor) => ridgeByNode[neighbor]!)
            .sort((a, b) => ridgeSizes[a]! - ridgeSizes[b]!)[0]!;
          addToRidge(nodeId, ridge);
        }
        continue;
      }
    }
    const innerSelectedArea = [...elevatedIds]
      .filter((nodeId) => innerIds.has(nodeId))
      .reduce((area, nodeId) => area + cellArea[nodeId]!, 0);
    const elevatedSectorArea = Array.from({ length: playerCount * 2 }, () => 0);
    for (const nodeId of elevatedIds) {
      elevatedSectorArea[sectorFor(nodes[nodeId]!)]! += cellArea[nodeId]!;
    }
    const uncovered = new Set(regular.filter((node) =>
      !elevatedIds.has(node.id)
      && ![...neighbors[node.id]!].some((neighbor) => elevatedIds.has(neighbor))
    ).map((node) => node.id));
    const cliffFrontier = allRegular.filter((node) => {
      if (!baseAdjacentIds.has(node.id) || elevatedIds.has(node.id)
        || baseGatewayNodeIds.has(node.id)
        || forcedPeakIds.size >= forcedPeakTarget || !canForcePeak(node.id)) return false;
      const adjacentBases = [...neighbors[node.id]!]
        .filter((neighbor) => nodes[neighbor]!.purpose === "base");
      if (adjacentBases.some((baseId) => [...neighbors[baseId]!]
        .filter((neighbor) => nodes[neighbor]!.purpose === "central"
          && neighbor !== node.id
          && !elevatedIds.has(neighbor)).length < BASE_ACCESS_TARGET)) return false;
      const selectedNeighbors = [...neighbors[node.id]!]
        .filter((neighbor) => elevatedIds.has(neighbor));
      return selectedNeighbors.length >= 2
        && selectedNeighbors.some((neighbor) => !baseAdjacentIds.has(neighbor));
    });
    const frontier = [...regular, ...cliffFrontier].filter((node) =>
      !elevatedIds.has(node.id)
      && [...neighbors[node.id]!].some((neighbor) => elevatedIds.has(neighbor))
    ).map((node) => {
      const selectedNeighbors = [...neighbors[node.id]!]
        .filter((neighbor) => elevatedIds.has(neighbor));
      const adjacentRidges = [...new Set(selectedNeighbors.map((neighbor) =>
        ridgeByNode[neighbor]!
      ))];
      const ridge = adjacentRidges.sort((a, b) => ridgeSizes[a]! - ridgeSizes[b]!)[0]!;
      const newlyCovered = [node.id, ...neighbors[node.id]!]
        .filter((neighbor) => uncovered.has(neighbor)).length;
      const createsBranch = selectedNeighbors.length >= 3
        || selectedNeighbors.some((neighbor) => [...neighbors[neighbor]!]
          .filter((candidate) => elevatedIds.has(candidate)).length >= 2);
      const withinInnerBudget = !innerIds.has(node.id)
        || innerSelectedArea + cellArea[node.id]! <= innerAreaTarget;
      return {
        node,
        ridge,
        forcedPeak: baseAdjacentIds.has(node.id),
        mergesRidges: adjacentRidges.length >= 2,
        ridgeSize: ridgeSizes[ridge]!,
        newlyCovered,
        createsBranch,
        withinInnerBudget,
        baseFacingSector: playerCount > 2 && sectorFor(node) % 2 === 0,
        sectorCoverage: playerCount > 2
          ? elevatedSectorArea[sectorFor(node)]! / Math.max(1, sectorArea[sectorFor(node)]!)
          : 0,
        rank: rank[node.id]!,
      };
    }).sort((a, b) => Number(b.withinInnerBudget) - Number(a.withinInnerBudget)
      || (playerCount === 2
        ? Number(b.mergesRidges) - Number(a.mergesRidges)
        : 0)
      || Number(a.baseFacingSector) - Number(b.baseFacingSector)
      || a.sectorCoverage - b.sectorCoverage
      || (playerCount > 2
        ? b.node.x * b.node.x + b.node.z * b.node.z
          - (a.node.x * a.node.x + a.node.z * a.node.z)
        : 0)
      || b.newlyCovered - a.newlyCovered
      || (playerCount > 2
        ? Number(b.mergesRidges) - Number(a.mergesRidges)
        : 0)
      || Number(b.createsBranch) - Number(a.createsBranch)
      || a.ridgeSize - b.ridgeSize
      || a.rank - b.rank);
    const viableFrontier = frontier.find(({ node }) => canElevate(node.id, elevatedIds));
    if (!viableFrontier) {
      const remaining = elevatedTarget - elevatedIds.size;
      const extendRemote = (plan: number[], selected: Set<number>): number[] | null => {
        if (plan.length === remaining) return plan;
        const options = regular.filter((node) =>
          !selected.has(node.id)
          && canElevate(node.id, selected)
          && (plan.length === 0 || [...neighbors[node.id]!]
            .some((neighbor) => plan.includes(neighbor)))
        ).sort((a, b) => [...neighbors[b.id]!].filter((neighbor) =>
          regularIds.has(neighbor) && !selected.has(neighbor)
        ).length - [...neighbors[a.id]!].filter((neighbor) =>
          regularIds.has(neighbor) && !selected.has(neighbor)
        ).length
          || Number(innerIds.has(a.id)) - Number(innerIds.has(b.id))
          || rank[a.id]! - rank[b.id]!);
        for (const option of options) {
          const nextSelected = new Set(selected).add(option.id);
          const result = extendRemote([...plan, option.id], nextSelected);
          if (result) return result;
        }
        return null;
      };
      const plan = extendRemote([], new Set(elevatedIds));
      if (plan && plan.length >= 3
        && (playerCount === 2 || ridgeSizes.length + 1 < playerCount)) {
        const ridge = ridgeSizes.length;
        ridgeSizes.push(0);
        plan.forEach((nodeId) => addToRidge(nodeId, ridge));
        continue;
      }
    }
    const splitTwoPlayerRidge = playerCount === 2
      && regularComponentSize[anchors[0]!]! < elevatedTarget
      && elevatedTarget - elevatedIds.size === 3;
    if (viableFrontier && (playerCount > 2 && !viableFrontier.withinInnerBudget
      || splitTwoPlayerRidge)
      && elevatedTarget - elevatedIds.size >= 3) {
      const remote = regular.filter((node) =>
        !elevatedIds.has(node.id)
        && !innerIds.has(node.id)
        && ![...neighbors[node.id]!].some((neighbor) => elevatedIds.has(neighbor))
        && [...neighbors[node.id]!].filter((neighbor) =>
          regularIds.has(neighbor) && !elevatedIds.has(neighbor) && !innerIds.has(neighbor)
        ).length >= 1
      ).sort((a, b) => [...neighbors[b.id]!].filter((neighbor) =>
        regularIds.has(neighbor) && !elevatedIds.has(neighbor)
      ).length - [...neighbors[a.id]!].filter((neighbor) =>
        regularIds.has(neighbor) && !elevatedIds.has(neighbor)
      ).length
        || Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z)
        || rank[a.id]! - rank[b.id]!).find((node) => canElevate(node.id, elevatedIds));
      if (remote && (playerCount === 2 || ridgeSizes.length + 1 < playerCount)) {
        const remoteSizeTarget = 3;
        const ridge = ridgeSizes.length;
        const remoteNodes: number[] = [];
        ridgeSizes.push(0);
        addToRidge(remote.id, ridge);
        remoteNodes.push(remote.id);
        while (ridgeSizes[ridge]! < remoteSizeTarget) {
          const extension = regular.filter((node) =>
            !elevatedIds.has(node.id)
            && [...neighbors[node.id]!].some((neighbor) => ridgeByNode[neighbor] === ridge)
          ).sort((a, b) => [...neighbors[b.id]!].filter((neighbor) =>
            regularIds.has(neighbor) && !elevatedIds.has(neighbor)
          ).length - [...neighbors[a.id]!].filter((neighbor) =>
            regularIds.has(neighbor) && !elevatedIds.has(neighbor)
          ).length
            || Number(innerIds.has(a.id)) - Number(innerIds.has(b.id))
            || Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z)
            || rank[a.id]! - rank[b.id]!).find((node) => canElevate(node.id, elevatedIds));
          if (!extension) break;
          addToRidge(extension.id, ridge);
          remoteNodes.push(extension.id);
        }
        if (ridgeSizes[ridge]! >= remoteSizeTarget) continue;
        remoteNodes.forEach((nodeId) => {
          elevatedIds.delete(nodeId);
          ridgeByNode[nodeId] = -1;
        });
        ridgeSizes.pop();
      }
    }
    const next = viableFrontier;
    if (!next) {
      const routeRelaxed = frontier[0];
      if (routeRelaxed) {
        addToRidge(routeRelaxed.node.id, routeRelaxed.ridge);
        if (routeRelaxed.forcedPeak) forcedPeakIds.add(routeRelaxed.node.id);
        continue;
      }
      const fallback = allRegular.filter((node) => {
        if (!baseAdjacentIds.has(node.id) || elevatedIds.has(node.id)
          || baseGatewayNodeIds.has(node.id)
          || forcedPeakIds.size >= forcedPeakTarget || !canForcePeak(node.id)) return false;
        const adjacentBases = [...neighbors[node.id]!]
          .filter((neighbor) => nodes[neighbor]!.purpose === "base");
        if (adjacentBases.some((baseId) => [...neighbors[baseId]!]
          .filter((neighbor) => nodes[neighbor]!.purpose === "central"
            && neighbor !== node.id
            && !elevatedIds.has(neighbor)).length < BASE_ACCESS_TARGET)) return false;
        return [...neighbors[node.id]!].some((neighbor) => elevatedIds.has(neighbor));
      }).map((node) => {
        const selectedNeighbors = [...neighbors[node.id]!]
          .filter((neighbor) => elevatedIds.has(neighbor));
        const ridge = selectedNeighbors.map((neighbor) => ridgeByNode[neighbor]!)
          .sort((a, b) => ridgeSizes[a]! - ridgeSizes[b]!)[0]!;
        return { node, ridge, selectedNeighbors: selectedNeighbors.length };
      }).sort((a, b) => b.selectedNeighbors - a.selectedNeighbors
        || rank[a.node.id]! - rank[b.node.id]!)[0];
      if (!fallback) {
        throw new Error(`Could not extend the elevation network with ${elevatedTarget - elevatedIds.size} regions remaining`);
      }
      addToRidge(fallback.node.id, fallback.ridge);
      forcedPeakIds.add(fallback.node.id);
      continue;
    }
    addToRidge(next.node.id, next.ridge);
    if (next.forcedPeak) forcedPeakIds.add(next.node.id);
  }
  const elevatedComponents = () => {
    const result: number[][] = [];
    const visited = new Set<number>();
    for (const nodeId of elevatedIds) {
      if (visited.has(nodeId)) continue;
      const component = [nodeId];
      visited.add(nodeId);
      for (let read = 0; read < component.length; read += 1) {
        for (const neighbor of neighbors[component[read]!]!) {
          if (!elevatedIds.has(neighbor) || visited.has(neighbor)) continue;
          visited.add(neighbor);
          component.push(neighbor);
        }
      }
      result.push(component);
    }
    return result;
  };
  let components = elevatedComponents();
  if (components.length >= playerCount) {
    const componentByNode = new Int16Array(nodes.length).fill(-1);
    components.forEach((component, index) => component.forEach((nodeId) =>
      componentByNode[nodeId] = index
    ));
    const allRegularIds = new Set(allRegular
      .filter((node) => !baseGatewayNodeIds.has(node.id))
      .map((node) => node.id));
    const findBridgePlan = (source: number, allowed: ReadonlySet<number>) => {
      const previous = new Int16Array(nodes.length).fill(-2);
      const cost = new Float32Array(nodes.length).fill(Infinity);
      const queue = [...components[source]!];
      queue.forEach((nodeId) => {
        previous[nodeId] = -1;
        cost[nodeId] = 0;
      });
      while (queue.length) {
        queue.sort((a, b) => cost[a]! - cost[b]! || rank[a]! - rank[b]!);
        const current = queue.shift()!;
        for (const neighbor of neighbors[current]!) {
          const targetComponent = componentByNode[neighbor]!;
          if (targetComponent >= 0 && targetComponent !== source) {
            const plan: number[] = [];
            for (let nodeId = current; previous[nodeId]! >= 0; nodeId = previous[nodeId]!) {
              plan.push(nodeId);
            }
            return plan.reverse();
          }
          if (!allowed.has(neighbor) || elevatedIds.has(neighbor)) continue;
          const nextCost = cost[current]! + 1 + (innerIds.has(neighbor) ? 4 : 0);
          if (nextCost >= cost[neighbor]!) continue;
          previous[neighbor] = current;
          cost[neighbor] = nextCost;
          queue.push(neighbor);
        }
      }
      return null;
    };
    const bridgePlans: number[][] = [];
    for (let source = 0; source < components.length; source += 1) {
      const plan = findBridgePlan(source, regularIds)
        ?? findBridgePlan(source, allRegularIds);
      if (plan?.length) bridgePlans.push(plan);
    }
    bridgePlans.sort((a, b) => a.filter((nodeId) => innerIds.has(nodeId)).length
      - b.filter((nodeId) => innerIds.has(nodeId)).length
      || a.length - b.length
      || a.reduce((total, nodeId) => total + rank[nodeId]!, 0)
        - b.reduce((total, nodeId) => total + rank[nodeId]!, 0));
    bridgeSearch:
    for (const requireLowGroundRoutes of [true, false]) {
      for (const plan of bridgePlans) {
        const original = new Set(elevatedIds);
        let valid = true;
        for (const nodeId of plan) elevatedIds.add(nodeId);
        if (elevatedComponents().length >= components.length) {
          elevatedIds.clear();
          original.forEach((nodeId) => elevatedIds.add(nodeId));
          continue;
        }
        for (let removed = 0; removed < plan.length; removed += 1) {
          const removable = [...elevatedIds].filter((nodeId) =>
            !plan.includes(nodeId) && !forcedPeakIds.has(nodeId)
          ).sort((a, b) => rank[b]! - rank[a]!).find((nodeId) => {
            elevatedIds.delete(nodeId);
            const repaired = elevatedComponents();
            elevatedIds.add(nodeId);
            return repaired.length < components.length
              && repaired.every((component) => component.length >= 3);
          });
          if (removable === undefined) {
            valid = false;
            break;
          }
          elevatedIds.delete(removable);
        }
        if (valid && (!requireLowGroundRoutes || preservesLowGroundRoutes(elevatedIds))) {
          components = elevatedComponents();
          break bridgeSearch;
        }
        elevatedIds.clear();
        original.forEach((nodeId) => elevatedIds.add(nodeId));
      }
    }
  }
  const peakCandidates = [...elevatedIds].map((nodeId) => ({
    nodeId,
    selectedNeighbors: [...neighbors[nodeId]!]
      .filter((neighbor) => elevatedIds.has(neighbor)).length,
    rank: rank[nodeId]!,
  })).filter(({ selectedNeighbors }) => selectedNeighbors >= 2)
    .sort((a, b) => b.selectedNeighbors - a.selectedNeighbors || a.rank - b.rank);
  if (peakCandidates.length < levelTwoTarget) {
    throw new Error("Connected elevation network does not contain enough peak regions");
  }
  const levelTwoIds = new Set<number>();
  const protectedLevelOneIds = new Set<number>();
  const preservesBaseRoutes = (peaks: ReadonlySet<number>) => {
    const elevation = (nodeId: number) => nodes[nodeId]!.purpose === "base" ? 1
      : peaks.has(nodeId) ? 2 : elevatedIds.has(nodeId) ? 1 : 0;
    const traversable = candidates.filter((edge) =>
      Math.abs(elevation(edge.a) - elevation(edge.b)) <= 1
    );
    const components = twoEdgeComponents(nodes.length, traversable);
    const centralEdges = traversable.filter((edge) =>
      nodes[edge.a]!.purpose === "central" && nodes[edge.b]!.purpose === "central"
    );
    const centralGraph = adjacency(nodes.length, centralEdges);
    const centralStart = nodes.find((node) => node.purpose === "central")!.id;
    const centralQueue = [centralStart];
    const centralVisited = new Set(centralQueue);
    for (let read = 0; read < centralQueue.length; read += 1) {
      for (const next of centralGraph[centralQueue[read]!]!) {
        if (centralVisited.has(next.node)) continue;
        centralVisited.add(next.node);
        centralQueue.push(next.node);
      }
    }
    return nodes.filter((node) => node.purpose === "central")
      .every((node) => centralVisited.has(node.id))
      && bases.every((_, player) =>
      components.connectedComponent[player] === components.connectedComponent[0]
      && components.resilientComponent[player] === components.resilientComponent[0]
    );
  };
  const canAddPeak = (nodeId: number) => preservesBaseRoutes(new Set(levelTwoIds).add(nodeId));
  const addPeak = (nodeId: number) => {
    levelTwoIds.add(nodeId);
    const levelOneNeighbor = [...neighbors[nodeId]!]
      .filter((neighbor) => elevatedIds.has(neighbor)
        && !baseAdjacentIds.has(neighbor)
        && !levelTwoIds.has(neighbor))
      .sort((a, b) => rank[a]! - rank[b]!)[0];
    if (levelOneNeighbor !== undefined) protectedLevelOneIds.add(levelOneNeighbor);
  };
  for (const nodeId of forcedPeakIds) {
    if (!canAddPeak(nodeId)) throw new Error("Base-adjacent peak would block a second route");
    addPeak(nodeId);
  }
  for (const component of components) {
    if (component.some((nodeId) => levelTwoIds.has(nodeId))) continue;
    const peak = peakCandidates.find(({ nodeId }) => component.includes(nodeId)
      && canAddPeak(nodeId));
    if (!peak) throw new Error("Elevation ridge does not contain an interior peak region");
    addPeak(peak.nodeId);
  }
  for (const { nodeId } of peakCandidates) {
    if (levelTwoIds.size === levelTwoTarget) break;
    if (levelTwoIds.has(nodeId) || protectedLevelOneIds.has(nodeId)) continue;
    if ([...neighbors[nodeId]!].some((neighbor) => levelTwoIds.has(neighbor))) continue;
    if (!canAddPeak(nodeId)) continue;
    addPeak(nodeId);
  }
  for (const { nodeId } of peakCandidates) {
    if (levelTwoIds.size === levelTwoTarget) break;
    if (!levelTwoIds.has(nodeId) && !protectedLevelOneIds.has(nodeId)
      && canAddPeak(nodeId)) addPeak(nodeId);
  }
  if (levelTwoIds.size < levelTwoTarget) {
    throw new Error("Elevation network cannot place every peak without blocking base routes");
  }
  const lowIds = new Set(nodes.filter((node) =>
    node.purpose === "central" && !elevatedIds.has(node.id)
  ).map((node) => node.id));
  const visitedLow = new Set<number>();
  for (const start of lowIds) {
    if (visitedLow.has(start)) continue;
    const component = [start];
    visitedLow.add(start);
    for (let read = 0; read < component.length; read += 1) {
      for (const neighbor of neighbors[component[read]!]!) {
        if (!lowIds.has(neighbor) || visitedLow.has(neighbor)) continue;
        visitedLow.add(neighbor);
        component.push(neighbor);
      }
    }
    const boundary = new Set(component.flatMap((nodeId) => [...neighbors[nodeId]!])
      .filter((nodeId) => !lowIds.has(nodeId)));
    const hasLevelOneAccess = [...boundary].some((nodeId) =>
      nodes[nodeId]!.purpose === "base"
      || elevatedIds.has(nodeId) && !levelTwoIds.has(nodeId)
    );
    if (hasLevelOneAccess) continue;
    const demotedPeak = [...boundary]
      .find((nodeId) => levelTwoIds.has(nodeId) && !forcedPeakIds.has(nodeId));
    if (demotedPeak === undefined) continue;
    levelTwoIds.delete(demotedPeak);
    const replacement = peakCandidates.find(({ nodeId }) =>
      !levelTwoIds.has(nodeId)
      && nodeId !== demotedPeak
      && !baseAdjacentIds.has(nodeId)
      && canAddPeak(nodeId)
      && [...neighbors[nodeId]!].some((neighbor) =>
        elevatedIds.has(neighbor) && !levelTwoIds.has(neighbor) && neighbor !== nodeId
      )
    );
    if (replacement) levelTwoIds.add(replacement.nodeId);
    else levelTwoIds.add(demotedPeak);
  }
  return {
    nodes: nodes.map((node): DraftNode => ({
      ...node,
      elevation: node.purpose === "base" ? 1
        : levelTwoIds.has(node.id) ? 2 : elevatedIds.has(node.id) ? 1 : 0,
    })),
    baseGatewayKeys,
  };
};

const selectAccesses = (
  nodes: DraftNode[],
  candidates: CandidateEdge[],
  random: () => number,
  preferredBaseGateways: ReadonlySet<string>,
) => {
  const { plateaus, plateauByNode } = buildPlateaus(nodes, candidates);
  const ranked = (edges: CandidateEdge[]) => edges
    .map((edge) => ({ edge, rank: edge.border.length * (0.75 + random() * 0.5) }))
    .sort((a, b) => b.rank - a.rank);
  const basePlateaus = plateaus.filter((plateau) => plateau.basePlayers.length === 1);
  const baseLowEdges = (plateau: DraftPlateau) => candidates.filter((edge) => {
    const first = plateauByNode[edge.a]!;
    const second = plateauByNode[edge.b]!;
    if (first !== plateau.id && second !== plateau.id) return false;
    const other = first === plateau.id ? edge.b : edge.a;
    return nodes[other]!.elevation === 0;
  });
  const baseOptions = new Map(basePlateaus.map((plateau) => {
    const low = ranked(baseLowEdges(plateau)).map(({ edge }) => edge);
    return [plateau.id, low] as const;
  }));
  if ([...baseOptions.values()].some((options) => options.length < BASE_ACCESS_TARGET)) {
    return null;
  }
  // Begin with the complete traversable central graph. Pruning a known-good
  // graph is simpler and more reliable than guessing ramps and repairing gaps.
  const openKeys = new Set(candidates.filter((edge) => {
    const first = nodes[edge.a]!;
    const second = nodes[edge.b]!;
    if (first.purpose === "base" || second.purpose === "base") return false;
    return Math.abs(first.elevation - second.elevation) <= 1;
  }).map((edge) => edgeKey(edge.a, edge.b)));
  const baseSelections = new Map<number, CandidateEdge[]>();
  for (const plateau of basePlateaus) {
    const options = baseOptions.get(plateau.id)!;
    const preferred = options.filter((edge) =>
      preferredBaseGateways.has(edgeKey(edge.a, edge.b))
    );
    const selected = preferred.length === BASE_ACCESS_TARGET
      ? preferred
      : options.slice(0, BASE_ACCESS_TARGET);
    baseSelections.set(plateau.id, selected);
    selected.forEach(({ a, b }) => openKeys.add(edgeKey(a, b)));
  }
  const routeScore = (keys: Set<string>) => {
    const trialEdges = candidates.filter((edge) => keys.has(edgeKey(edge.a, edge.b)));
    const components = twoEdgeComponents(nodes.length, trialEdges);
    let minimum = Infinity;
    let total = 0;
    for (let first = 0; first < basePlateaus.length; first += 1) {
      for (let second = first + 1; second < basePlateaus.length; second += 1) {
        const routes = components.connectedComponent[first] !== components.connectedComponent[second]
          ? 0
          : components.resilientComponent[first] === components.resilientComponent[second]
            ? 2
            : 1;
        minimum = Math.min(minimum, routes);
        total += routes;
      }
    }
    return { minimum, total };
  };
  const lowGroundKeys = new Set(candidates.filter((edge) => {
    const first = nodes[edge.a]!;
    const second = nodes[edge.b]!;
    return first.purpose === "central" && second.purpose === "central"
      && first.elevation === 0 && second.elevation === 0;
  }).map((edge) => edgeKey(edge.a, edge.b)));
  const baseSelectionScore = (keys: Set<string>) => {
    const lowKeys = new Set(lowGroundKeys);
    candidates.filter((edge) => nodes[edge.a]!.purpose === "base"
      || nodes[edge.b]!.purpose === "base")
      .filter((edge) => keys.has(edgeKey(edge.a, edge.b)))
      .forEach((edge) => lowKeys.add(edgeKey(edge.a, edge.b)));
    return routeScore(lowKeys);
  };
  const optimizeBaseSelections = () => {
    for (let sweep = 0; sweep < 2; sweep += 1) {
      for (const plateau of basePlateaus) {
        for (const edge of baseSelections.get(plateau.id)!) {
          const key = edgeKey(edge.a, edge.b);
          openKeys.delete(key);
        }
        const options = baseOptions.get(plateau.id)!;
        const pairs = options.flatMap((first, firstIndex) => options
          .slice(firstIndex + 1)
          .map((second) => [first, second] as const));
        const selected = pairs.map((pair) => {
          const keys = new Set(openKeys);
          pair.forEach((edge) => keys.add(edgeKey(edge.a, edge.b)));
          return { pair, score: baseSelectionScore(keys) };
        }).sort((a, b) => b.score.minimum - a.score.minimum
          || b.score.total - a.score.total
          || b.pair.reduce((total, edge) => total + edge.border.length, 0)
            - a.pair.reduce((total, edge) => total + edge.border.length, 0))[0]!.pair;
        baseSelections.set(plateau.id, [...selected]);
        selected.forEach((edge) => {
          openKeys.add(edgeKey(edge.a, edge.b));
        });
      }
    }
  };
  optimizeBaseSelections();
  for (let repair = 0; repair < basePlateaus.length
    && baseSelectionScore(openKeys).minimum < TARGET_BASE_ROUTES; repair += 1) {
    const current = baseSelectionScore(openKeys);
    const option = basePlateaus.flatMap((firstPlateau, firstIndex) => basePlateaus
      .slice(firstIndex + 1)
      .flatMap((secondPlateau) => {
        const firstOptions = baseOptions.get(firstPlateau.id)!;
        const secondOptions = baseOptions.get(secondPlateau.id)!;
        const firstPairs = firstOptions.flatMap((first, index) => firstOptions
          .slice(index + 1).map((second) => [first, second] as const));
        const secondPairs = secondOptions.flatMap((first, index) => secondOptions
          .slice(index + 1).map((second) => [first, second] as const));
        return firstPairs.flatMap((firstPair) => secondPairs.map((secondPair) => {
          const keys = new Set(openKeys);
          baseSelections.get(firstPlateau.id)!.forEach((edge) =>
            keys.delete(edgeKey(edge.a, edge.b))
          );
          baseSelections.get(secondPlateau.id)!.forEach((edge) =>
            keys.delete(edgeKey(edge.a, edge.b))
          );
          firstPair.forEach((edge) => keys.add(edgeKey(edge.a, edge.b)));
          secondPair.forEach((edge) => keys.add(edgeKey(edge.a, edge.b)));
          return {
            firstPlateau,
            secondPlateau,
            firstPair,
            secondPair,
            score: baseSelectionScore(keys),
          };
        }));
      }))
      .sort((a, b) => b.score.minimum - a.score.minimum || b.score.total - a.score.total)[0];
    if (!option || option.score.minimum < current.minimum
      || option.score.minimum === current.minimum && option.score.total <= current.total) break;
    for (const plateau of [option.firstPlateau, option.secondPlateau]) {
      baseSelections.get(plateau.id)!.forEach((edge) => openKeys.delete(edgeKey(edge.a, edge.b)));
    }
    baseSelections.set(option.firstPlateau.id, [...option.firstPair]);
    baseSelections.set(option.secondPlateau.id, [...option.secondPair]);
    option.firstPair.forEach((edge) => openKeys.add(edgeKey(edge.a, edge.b)));
    option.secondPair.forEach((edge) => openKeys.add(edgeKey(edge.a, edge.b)));
  }
  const neutralPlateaus = plateaus.filter((plateau) => plateau.elevation > 0
    && plateau.basePlayers.length === 0);
  const accessKeys = (plateau: DraftPlateau, keys = openKeys) => new Set(candidates
    .filter((edge) => {
      const key = edgeKey(edge.a, edge.b);
      if (!keys.has(key) || nodes[edge.a]!.elevation === nodes[edge.b]!.elevation) return false;
      const first = plateaus[plateauByNode[edge.a]!]!;
      const second = plateaus[plateauByNode[edge.b]!]!;
      const higher = first.elevation > second.elevation ? first : second;
      return higher.id === plateau.id;
    })
    .map((edge) => edgeKey(edge.a, edge.b)));
  // Begin with the complete traversable graph, then remove only excess ramp
  // entrances. This preserves route redundancy by construction and avoids
  // rebuilding a sparse graph with a second repair algorithm.
  while (neutralPlateaus.some((plateau) =>
    accessKeys(plateau).size > MAX_NEUTRAL_PLATEAU_ACCESSES)) {
    const removal = neutralPlateaus.filter((plateau) =>
      accessKeys(plateau).size > MAX_NEUTRAL_PLATEAU_ACCESSES
    ).flatMap((plateau) => [...accessKeys(plateau)].map((key) => {
        const trial = new Set(openKeys);
        trial.delete(key);
        const trialEdges = candidates.filter((edge) => trial.has(edgeKey(edge.a, edge.b)));
        return {
          key,
          connected: connected(nodes.length, trialEdges),
          score: routeScore(trial),
          borderLength: candidates.find((edge) => edgeKey(edge.a, edge.b) === key)!.border.length,
        };
      })).filter((candidate) => candidate.connected
      && candidate.score.minimum >= TARGET_BASE_ROUTES)
      .sort((a, b) => b.score.total - a.score.total
        || a.borderLength - b.borderLength)[0];
    if (!removal) throw new Error("Could not prune excess plateau entrances safely");
    openKeys.delete(removal.key);
  }
  if (routeScore(openKeys).minimum < TARGET_BASE_ROUTES
    || neutralPlateaus.some((plateau) => {
      const count = accessKeys(plateau).size;
      return count < 1 || count > MAX_NEUTRAL_PLATEAU_ACCESSES;
    })) throw new Error("Constructed access skeleton is invalid");

  const accessEdges = plateaus.map((plateau) => plateau.basePlayers.length === 1
    ? new Set(baseSelections.get(plateau.id)!.map((edge) => edgeKey(edge.a, edge.b)))
    : accessKeys(plateau));

  const edges: TopologyEdge[] = candidates
    .filter((edge) => openKeys.has(edgeKey(edge.a, edge.b)))
    .map((edge, id) => ({
      ...edge,
      id,
      kind: nodes[edge.a]!.elevation === nodes[edge.b]!.elevation ? "flat" : "ramp",
    }));
  const graph = adjacency(nodes.length, edges);
  const decoratedNodes: TopologyNode[] = nodes.map((node) => ({
    ...node,
    plateau: plateauByNode[node.id]!,
    plateauAccesses: node.elevation ? accessEdges[plateauByNode[node.id]!]!.size : null,
    degree: graph[node.id]!.length,
  }));
  const decoratedPlateaus: TopologyPlateau[] = plateaus.map((plateau) => ({
    ...plateau,
    accesses: plateau.elevation ? accessEdges[plateau.id]!.size : null,
  }));
  return { nodes: decoratedNodes, plateaus: decoratedPlateaus, edges };
};

const decorateTopology = (
  nodes: TopologyNode[],
  plateaus: TopologyPlateau[],
  cells: TopologyCell[],
  borders: DraftBorder[],
  edges: TopologyEdge[],
  playerCount: number,
  size: number,
) => {
  const scale = mapScaleForSize(size);
  const openKeys = new Set(edges.map((edge) => edgeKey(edge.a, edge.b)));
  const terrainBorders: TopologyBorder[] = borders.map((border) => ({
    ...border,
    open: border.neighbor !== null && openKeys.has(edgeKey(border.node, border.neighbor)),
  }));
  const borderKey = (border: DraftBorder) => [border.start, border.end]
    .map((point) => `${point.x.toFixed(1)},${point.z.toFixed(1)}`)
    .sort()
    .join(":");
  const closedCliffs = new Map<string, DraftBorder>();
  for (const border of terrainBorders) {
    if (nodes[border.node]!.elevation && !border.open) {
      closedCliffs.set(borderKey(border), border);
    }
  }
  const chokeEdgeIds = new Set<number>();
  edges.forEach((edge, edgeId) => {
    if (nodes[edge.a]!.elevation || nodes[edge.b]!.elevation) return;
    const nearestCliff = (point: TopologyPoint) => [...closedCliffs.entries()]
      .map(([key, cliff]) => ({ key, clearance: distanceToSegment(point, cliff.start, cliff.end) }))
      .sort((a, b) => a.clearance - b.clearance)[0];
    const startCliff = nearestCliff(edge.border.start);
    const endCliff = nearestCliff(edge.border.end);
    if (edge.border.length <= 62 * scale
      && startCliff && startCliff.clearance <= 9 * scale
      && endCliff && endCliff.clearance <= 9 * scale
      && startCliff.key !== endCliff.key) {
      chokeEdgeIds.add(edgeId);
    }
  });
  // A ramp is also a terrain chokepoint: it is an authored, limited entrance
  // through otherwise closed cliffs, even when no low-ground neck is nearby.
  edges.forEach((edge, edgeId) => {
    if (edge.kind === "ramp") chokeEdgeIds.add(edgeId);
  });
  let minimumBaseRoutes = Infinity;
  const routeComponents = twoEdgeComponents(nodes.length, edges);
  for (let first = 0; first < playerCount; first += 1) {
    for (let second = first + 1; second < playerCount; second += 1) {
      const routes = routeComponents.connectedComponent[first]
        !== routeComponents.connectedComponent[second] ? 0
        : routeComponents.resilientComponent[first] === routeComponents.resilientComponent[second]
          ? 2
          : 1;
      minimumBaseRoutes = Math.min(minimumBaseRoutes, routes);
    }
  }
  const baseAccesses = nodes.slice(0, playerCount).map((node) => node.plateauAccesses);
  const central = nodes.filter((node) => node.purpose === "central");
  const elevatedCentralIds = new Set(central
    .filter((node) => node.elevation > 0)
    .map((node) => node.id));
  const elevatedNeighbors = Array.from({ length: nodes.length }, () => new Set<number>());
  for (const border of terrainBorders) {
    if (border.neighbor === null || !elevatedCentralIds.has(border.node)
      || !elevatedCentralIds.has(border.neighbor)) continue;
    elevatedNeighbors[border.node]!.add(border.neighbor);
  }
  const branchingElevatedNodes = [...elevatedCentralIds]
    .filter((nodeId) => elevatedNeighbors[nodeId]!.size >= 3).length;
  const visitedElevated = new Set<number>();
  let elevatedNetworks = 0;
  for (const nodeId of elevatedCentralIds) {
    if (visitedElevated.has(nodeId)) continue;
    elevatedNetworks += 1;
    const queue = [nodeId];
    visitedElevated.add(nodeId);
    for (let read = 0; read < queue.length; read += 1) {
      for (const neighbor of elevatedNeighbors[queue[read]!]!) {
        if (visitedElevated.has(neighbor)) continue;
        visitedElevated.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  const neutralPlateaus = plateaus.filter((plateau) => plateau.elevation > 0
    && plateau.basePlayers.length === 0);
  const metrics: TopologyMetrics = {
    accepted: connected(nodes.length, edges)
      && minimumBaseRoutes >= TARGET_BASE_ROUTES
      && baseAccesses.every((accesses) => accesses === BASE_ACCESS_TARGET)
      && plateaus.every((plateau) => plateau.basePlayers.length <= 1)
      && neutralPlateaus.length >= 1
      && elevatedNetworks < playerCount
      && branchingElevatedNodes >= 1
      && plateaus.some((plateau) => plateau.elevation > 0 && plateau.nodes.length > 1)
      && edges.length - nodes.length + 1 >= playerCount * 2 + 1
      && neutralPlateaus.every((plateau) => plateau.accesses !== null
        && plateau.accesses >= 1 && plateau.accesses <= MAX_NEUTRAL_PLATEAU_ACCESSES)
      && chokeEdgeIds.size >= 1,
    playerCount,
    centralRegions: nodes.length - playerCount,
    levelOneRegions: central.filter((node) => node.elevation === 1).length,
    levelTwoRegions: central.filter((node) => node.elevation === 2).length,
    elevatedPlateaus: neutralPlateaus.length,
    mergedElevatedPlateaus: plateaus.filter((plateau) => plateau.elevation > 0
      && plateau.nodes.length > 1).length,
    elevatedNetworks,
    branchingElevatedNodes,
    ramps: edges.filter((edge) => edge.kind === "ramp").length,
    closedCliffSides: closedCliffs.size,
    singleAccessPlateaus: neutralPlateaus.filter((plateau) => plateau.accesses === 1).length,
    derivedChokes: chokeEdgeIds.size,
    minimumBaseRoutes,
    baseAccesses,
    accessDistribution: [1, 2, 3, 4].map((count) =>
      neutralPlateaus.filter((plateau) => plateau.accesses === count).length
    ),
    loops: edges.length - nodes.length + 1,
  };
  return { nodes, cells, borders: terrainBorders, edges, plateaus, chokeEdgeIds, metrics };
};

/** Builds the authored region graph before it is compiled into a terrain height field. */
export const generateMapTopology = (
  seed: number,
  playerCount = 2,
): MapTopology => {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
    throw new RangeError("Map topology supports between two and six players");
  }
  const size = mapSizeForPlayerCount(playerCount);
  const centralRegionCount = centralRegionCountForSize(size, playerCount);
  const random = randomFrom((seed ^ Math.imul(playerCount, 0x85ebca6b)) >>> 0);
  const draftNodes = buildNodes(random, playerCount, size, centralRegionCount);
  const cells = buildCells(draftNodes, size);
  const borders = buildBorders(draftNodes, cells, size);
  const candidates = buildCandidates(draftNodes, borders);
  if (!hasBaseSeparators(draftNodes, candidates)) {
    throw new Error("Constructed terrain did not separate adjacent player bases");
  }
  const elevationPlan = assignElevation(draftNodes, candidates, cells, random, size);
  const accessPlan = selectAccesses(
    elevationPlan.nodes,
    candidates,
    random,
    elevationPlan.baseGatewayKeys,
  );
  if (!accessPlan) throw new Error("Constructed terrain could not assign plateau accesses");
  const topology = decorateTopology(
    accessPlan.nodes,
    accessPlan.plateaus,
    cells,
    borders,
    accessPlan.edges,
    playerCount,
    size,
  );
  if (!topology.metrics.accepted) {
    throw new Error(`Constructed terrain did not satisfy gameplay topology invariants: ${JSON.stringify({
      ...topology.metrics,
      connected: connected(topology.nodes.length, topology.edges),
      separateBases: topology.plateaus.every((plateau) => plateau.basePlayers.length <= 1),
    })
    }`);
  }
  return { seed, playerCount, size, ...topology };
};
