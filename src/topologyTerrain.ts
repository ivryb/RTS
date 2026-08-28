import {
  mapScaleForSize,
  mapSegmentsForSize,
  TERRAIN_BASE_HEIGHT,
  TERRAIN_LEVEL_HEIGHT,
} from "./mapConstants";
import {
  randomFrom,
  type TerrainFrame,
  type TerrainPoint,
} from "./terrainFrame";

type TopologyPoint = TerrainPoint;

interface StrokeSegment {
  start: TopologyPoint;
  end: TopologyPoint;
}

export interface TerrainStroke {
  segments: StrokeSegment[];
  halfWidth: number;
}

export interface PlateauPlan {
  id: number;
  center: TopologyPoint;
  outer: TerrainStroke[];
  inner: TerrainStroke[];
  basePlayer: number | null;
  radius: number;
}

export interface ContourTerrainPlan {
  seed: number;
  size: number;
  bases: Array<TopologyPoint & { player: number }>;
  plateaus: PlateauPlan[];
  routes: TerrainStroke[];
}

interface RampPlan {
  center: TopologyPoint;
  direction: TopologyPoint;
  halfLength: number;
  halfWidth: number;
  lowElevation: 0 | 1;
}

const CLIFF_HALF_WIDTH = 0.9;
const BASE_BUILDABLE_RADIUS = 25;
const BASE_CORE_RADIUS = 31;
const BASE_ROUTE_EXEMPT_RADIUS = 52;
const ROUTE_HALF_WIDTH = 14;
const RAMP_HALF_LENGTH = 10;
const RAMP_HALF_WIDTH = 16;
const MINIMUM_LEVEL_ONE_SHELF = 7;

const terrainFeatureScale = (size: number) => Math.max(
  0.82,
  Math.min(1.05, mapScaleForSize(size)),
);

const smoothstep = (start: number, end: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
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

const contourNoise = (point: TopologyPoint, seed: number, scale: number) => (
  valueNoise(point.x / (68 * scale), point.z / (68 * scale), seed) * 0.68
  + valueNoise(point.x / (29 * scale), point.z / (29 * scale), seed ^ 0x9e3779b9) * 0.32
) * 2 - 1;

const distance = (a: TopologyPoint, b: TopologyPoint) =>
  Math.hypot(a.x - b.x, a.z - b.z);

const nearestPointOnSegment = (
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
  return { x: start.x + dx * ratio, z: start.z + dz * ratio };
};

const distanceToStroke = (point: TopologyPoint, stroke: TerrainStroke) => {
  let nearest = Infinity;
  for (const segment of stroke.segments) {
    nearest = Math.min(
      nearest,
      distance(point, nearestPointOnSegment(point, segment.start, segment.end)),
    );
  }
  return nearest;
};

const quadraticStroke = (
  start: TopologyPoint,
  end: TopologyPoint,
  halfWidth: number,
  bend: number,
) => {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz) || 1;
  const control = {
    x: (start.x + end.x) / 2 - dz / length * bend,
    z: (start.z + end.z) / 2 + dx / length * bend,
  };
  const points = Array.from({ length: 9 }, (_, index) => {
    const ratio = index / 8;
    const inverse = 1 - ratio;
    return {
      x: inverse * inverse * start.x
        + 2 * inverse * ratio * control.x
        + ratio * ratio * end.x,
      z: inverse * inverse * start.z
        + 2 * inverse * ratio * control.z
        + ratio * ratio * end.z,
    };
  });
  return {
    halfWidth,
    segments: points.slice(1).map((endPoint, index) => ({
      start: points[index]!,
      end: endPoint,
    })),
  };
};

const spineAt = (
  center: TopologyPoint,
  angle: number,
  length: number,
  halfWidth: number,
  bend: number,
) => {
  const direction = { x: Math.cos(angle), z: Math.sin(angle) };
  return quadraticStroke(
    {
      x: center.x - direction.x * length / 2,
      z: center.z - direction.z * length / 2,
    },
    {
      x: center.x + direction.x * length / 2,
      z: center.z + direction.z * length / 2,
    },
    halfWidth,
    bend,
  );
};

const closestPointOnStrokes = (point: TopologyPoint, strokes: TerrainStroke[]) => {
  let closest = point;
  let closestDistance = Infinity;
  for (const stroke of strokes) {
    for (const segment of stroke.segments) {
      const candidate = nearestPointOnSegment(point, segment.start, segment.end);
      const candidateDistance = distance(point, candidate);
      if (candidateDistance >= closestDistance) continue;
      closest = candidate;
      closestDistance = candidateDistance;
    }
  }
  return closest;
};

const distanceBetweenStrokes = (first: TerrainStroke, second: TerrainStroke) => {
  let nearest = Infinity;
  for (const segment of first.segments) {
    nearest = Math.min(
      nearest,
      distanceToStroke(segment.start, second),
      distanceToStroke(segment.end, second),
    );
  }
  for (const segment of second.segments) {
    nearest = Math.min(
      nearest,
      distanceToStroke(segment.start, first),
      distanceToStroke(segment.end, first),
    );
  }
  return nearest;
};

const strokeClearance = (first: TerrainStroke, second: TerrainStroke) =>
  distanceBetweenStrokes(first, second) - first.halfWidth - second.halfWidth;

const pointAlongStroke = (stroke: TerrainStroke, ratio: number) => {
  const scaled = Math.max(0, Math.min(0.999_999, ratio)) * stroke.segments.length;
  const segment = stroke.segments[Math.floor(scaled)]!;
  const localRatio = scaled - Math.floor(scaled);
  const dx = segment.end.x - segment.start.x;
  const dz = segment.end.z - segment.start.z;
  const length = Math.hypot(dx, dz) || 1;
  return {
    point: {
      x: segment.start.x + dx * localRatio,
      z: segment.start.z + dz * localRatio,
    },
    direction: { x: dx / length, z: dz / length },
  };
};

const plateauDistance = (
  point: TopologyPoint,
  plateaus: PlateauPlan[],
  inner: boolean,
) => {
  let signedDistance = -Infinity;
  for (const plateau of plateaus) {
    const strokes = inner ? plateau.inner : plateau.outer;
    for (const stroke of strokes) {
      signedDistance = Math.max(
        signedDistance,
        stroke.halfWidth - distanceToStroke(point, stroke),
      );
    }
  }
  return signedDistance;
};

const createRoutes = (
  bases: ContourTerrainPlan["bases"],
  size: number,
  seed: number,
) => {
  const approaches: TerrainStroke[] = [];
  const hubs: TopologyPoint[] = [];
  const innerRadius = size * 0.12;
  for (const base of bases) {
    const baseAngle = Math.atan2(base.z, base.x);
    for (const side of [-1, 1]) {
      const hubAngle = baseAngle + side * 0.72;
      const hub = {
        x: Math.cos(hubAngle) * innerRadius,
        z: Math.sin(hubAngle) * innerRadius,
      };
      const bend = side * (8 + hashNoise(base.player, side + 2, seed) * 10);
      approaches.push(quadraticStroke(base, hub, ROUTE_HALF_WIDTH, bend));
      hubs.push(hub);
    }
  }
  hubs.sort((first, second) =>
    Math.atan2(first.z, first.x) - Math.atan2(second.z, second.x)
  );
  const innerLoop = hubs.map((hub, index) => {
    const next = hubs[(index + 1) % hubs.length]!;
    const side = hashNoise(index, hubs.length, seed ^ 0x85ebca6b) < 0.5 ? -1 : 1;
    return quadraticStroke(hub, next, ROUTE_HALF_WIDTH, side * size * 0.025);
  });
  return [...approaches, ...innerLoop];
};

const createBasePlateau = (
  base: ContourTerrainPlan["bases"][number],
  scale: number,
  seed: number,
): PlateauPlan => {
  const radialAngle = Math.atan2(base.z, base.x);
  const tangent = radialAngle + Math.PI / 2
    + (hashNoise(base.player, 1, seed) - 0.5) * 0.45;
  const mainLength = 68 * Math.max(0.9, scale);
  const mainWidth = 23 * Math.max(0.95, scale);
  const inward = radialAngle + Math.PI;
  const branchCenter = {
    x: base.x + Math.cos(inward) * 12 * scale,
    z: base.z + Math.sin(inward) * 12 * scale,
  };
  const outer = [
    spineAt(base, tangent, mainLength, mainWidth, 9 * scale),
    spineAt(
      branchCenter,
      inward + (hashNoise(base.player, 2, seed) - 0.5) * 0.7,
      42 * scale,
      18 * Math.max(0.95, scale),
      -7 * scale,
    ),
  ];
  return {
    id: base.player - 1,
    center: base,
    outer,
    inner: [],
    basePlayer: base.player,
    radius: mainLength / 2 + mainWidth,
  };
};

const neutralPlateauCount = (playerCount: number) =>
  Math.round(playerCount * 1.5 + 1);

interface NeutralPlateauCandidate {
  center: TopologyPoint;
  outer: TerrainStroke[];
  inner: TerrainStroke[];
  radius: number;
  hardClearance: number;
  score: number;
}

const mapBoundaryClearance = (
  stroke: TerrainStroke,
  halfSize: number,
) => Math.min(...stroke.segments.flatMap((segment) => [segment.start, segment.end]).map((point) =>
  halfSize - Math.max(Math.abs(point.x), Math.abs(point.z)) - stroke.halfWidth
));

const shapeClearance = (
  strokes: TerrainStroke[],
  others: TerrainStroke[],
) => Math.min(...strokes.flatMap((stroke) =>
  others.map((other) => strokeClearance(stroke, other))
));

const createNeutralCandidate = (
  random: () => number,
  route: TerrainStroke,
  length: number,
  halfWidth: number,
  featureScale: number,
  halfSize: number,
  routes: TerrainStroke[],
  plateaus: PlateauPlan[],
  allowBranch: boolean,
): NeutralPlateauCandidate => {
  const routeSample = pointAlongStroke(route, 0.08 + random() * 0.84);
  const side = random() < 0.5 ? -1 : 1;
  const roadGap = (10 + random() * 8) * featureScale;
  const offset = route.halfWidth + halfWidth + roadGap;
  const center = {
    x: routeSample.point.x - routeSample.direction.z * side * offset,
    z: routeSample.point.z + routeSample.direction.x * side * offset,
  };
  const angle = Math.atan2(routeSample.direction.z, routeSample.direction.x)
    + (random() - 0.5) * 0.42;
  const bend = (random() * 2 - 1) * Math.min(13 * featureScale, length * 0.18);
  const main = spineAt(center, angle, length, halfWidth, bend);
  const outer = [main];
  if (allowBranch && random() < 0.5) {
    const branchLength = length * (0.42 + random() * 0.18);
    const branchAngle = angle + side * (0.68 + random() * 0.42);
    const branchCenter = {
      x: center.x - routeSample.direction.z * side * branchLength * 0.2
        + Math.cos(angle) * (random() - 0.5) * length * 0.22,
      z: center.z + routeSample.direction.x * side * branchLength * 0.2
        + Math.sin(angle) * (random() - 0.5) * length * 0.22,
    };
    outer.push(spineAt(
      branchCenter,
      branchAngle,
      branchLength,
      halfWidth * (0.7 + random() * 0.12),
      (random() * 2 - 1) * 6 * featureScale,
    ));
  }
  const inner = random() < 0.42
    ? [spineAt(center, angle, length * 0.68, halfWidth * 0.52, bend * 0.65)]
    : [];
  const existingStrokes = plateaus.flatMap((plateau) => plateau.outer);
  const boundary = Math.min(...outer.map((stroke) =>
    mapBoundaryClearance(stroke, halfSize)
  ));
  const road = shapeClearance(outer, routes);
  const plateau = shapeClearance(outer, existingStrokes);
  const hardClearance = Math.min(boundary, road);
  return {
    center,
    outer,
    inner,
    radius: length / 2 + halfWidth,
    hardClearance,
    score: hardClearance + Math.max(-12, Math.min(12, plateau - 3)) * 0.35,
  };
};

/** Builds a fixed number of large mesa shapes around protected low-ground routes. */
export const createContourTerrainPlan = (frame: TerrainFrame): ContourTerrainPlan => {
  const seed = (frame.seed ^ Math.imul(frame.playerCount, 0x9e3779b1)) >>> 0;
  const random = randomFrom(seed);
  const featureScale = terrainFeatureScale(frame.size);
  const bases = frame.bases;
  const routes = createRoutes(bases, frame.size, seed);
  const plateaus = bases.map((base) => createBasePlateau(base, featureScale, seed));
  const halfSize = frame.size / 2;
  const count = neutralPlateauCount(frame.playerCount);
  const approachRoutes = routes.slice(0, frame.bases.length * 2);

  for (let index = 0; index < count; index += 1) {
    const length = (50 + random() * 24) * featureScale;
    const halfWidth = (18 + random() * 7) * featureScale;
    const routeOffset = Math.floor(random() * approachRoutes.length);
    const targetRoute = approachRoutes[(routeOffset + index) % approachRoutes.length]!;
    const candidates = Array.from({ length: 12 }, () =>
      createNeutralCandidate(
        random,
        targetRoute,
        length,
        halfWidth,
        featureScale,
        halfSize,
        routes,
        plateaus,
        true,
      )
    );
    let validCandidates = candidates.filter((candidate) =>
      candidate.hardClearance >= 6 * featureScale
    );
    if (!validCandidates.length) {
      const fallbackCandidates = Array.from({ length: approachRoutes.length * 6 }, (_, candidateIndex) =>
        createNeutralCandidate(
          random,
          approachRoutes[(routeOffset + index + candidateIndex) % approachRoutes.length]!,
          length * 0.9,
          halfWidth * 0.92,
          featureScale,
          halfSize,
          routes,
          plateaus,
          false,
        )
      );
      validCandidates = fallbackCandidates.filter((candidate) =>
        candidate.hardClearance >= 6 * featureScale
      );
    }
    const selected = validCandidates.reduce((best, candidate) =>
      candidate.score > best.score ? candidate : best
    , validCandidates[0]!);
    if (!selected) continue;
    plateaus.push({
      id: plateaus.length,
      center: selected.center,
      outer: selected.outer,
      inner: selected.inner,
      basePlayer: null,
      radius: selected.radius,
    });
  }
  return { seed, size: frame.size, bases, plateaus, routes };
};

const levelOneDistance = (point: TopologyPoint, plan: ContourTerrainPlan) => {
  const scale = terrainFeatureScale(plan.size);
  const warpedPoint = {
    x: point.x + contourNoise(point, plan.seed ^ 0x9e3779b1, scale) * 5.5 * scale,
    z: point.z + contourNoise(point, plan.seed ^ 0x85ebca6b, scale) * 5.5 * scale,
  };
  let signedDistance = plateauDistance(warpedPoint, plan.plateaus, false);
  const nearestBaseDistance = Math.min(...plan.bases.map((base) => distance(point, base)));
  signedDistance = Math.max(signedDistance, BASE_CORE_RADIUS - nearestBaseDistance);
  if (nearestBaseDistance > BASE_ROUTE_EXEMPT_RADIUS) {
    const roadDistance = Math.min(...plan.routes.map((route) =>
      distanceToStroke(point, route) - route.halfWidth
    ));
    signedDistance = Math.min(signedDistance, roadDistance);
  }
  return signedDistance;
};

const levelTwoDistance = (point: TopologyPoint, plan: ContourTerrainPlan) => {
  const scale = terrainFeatureScale(plan.size);
  const warpedPoint = {
    x: point.x + contourNoise(point, plan.seed ^ 0xc2b2ae35, scale) * 3.5 * scale,
    z: point.z + contourNoise(point, plan.seed ^ 0x27d4eb2d, scale) * 3.5 * scale,
  };
  return plateauDistance(warpedPoint, plan.plateaus, true);
};

const rampBetween = (
  low: TopologyPoint,
  high: TopologyPoint,
  lowElevation: 0 | 1,
  fieldAt: (point: TopologyPoint) => number,
): RampPlan | null => {
  const length = distance(low, high);
  if (length < 1) return null;
  const pointAt = (ratio: number) => ({
    x: low.x + (high.x - low.x) * ratio,
    z: low.z + (high.z - low.z) * ratio,
  });
  let lowRatio = 0;
  let highRatio = 1;
  let found = false;
  for (let sample = 0; sample < 24; sample += 1) {
    const start = sample / 24;
    const end = (sample + 1) / 24;
    if (fieldAt(pointAt(start)) < 0 && fieldAt(pointAt(end)) >= 0) {
      lowRatio = start;
      highRatio = end;
      found = true;
    }
  }
  if (!found) return null;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const midpoint = (lowRatio + highRatio) / 2;
    if (fieldAt(pointAt(midpoint)) >= 0) highRatio = midpoint;
    else lowRatio = midpoint;
  }
  const center = pointAt((lowRatio + highRatio) / 2);
  return {
    center,
    direction: { x: (high.x - low.x) / length, z: (high.z - low.z) / length },
    halfLength: RAMP_HALF_LENGTH,
    halfWidth: RAMP_HALF_WIDTH,
    lowElevation,
  };
};

const createRamps = (plan: ContourTerrainPlan) => {
  const ramps: RampPlan[] = [];
  for (const base of plan.bases) {
    const baseRoutes = plan.routes.filter((_, index) =>
      Math.floor(index / 2) === base.player - 1
    );
    for (const route of baseRoutes) {
      const low = route.segments.at(-1)!.end;
      const ramp = rampBetween(low, base, 0, (point) => levelOneDistance(point, plan));
      if (ramp) ramps.push(ramp);
    }
  }
  for (const plateau of plan.plateaus) {
    if (plateau.basePlayer !== null) continue;
    const low = closestPointOnStrokes(plateau.center, plan.routes);
    const outerRamp = rampBetween(low, plateau.center, 0, (point) =>
      levelOneDistance(point, plan)
    );
    if (outerRamp) ramps.push(outerRamp);
    if (!plateau.inner.length) continue;
    const dx = plateau.outer[0]!.segments.at(-1)!.end.x
      - plateau.outer[0]!.segments[0]!.start.x;
    const dz = plateau.outer[0]!.segments.at(-1)!.end.z
      - plateau.outer[0]!.segments[0]!.start.z;
    const directionLength = Math.hypot(dx, dz) || 1;
    const innerLow = {
      x: plateau.center.x - dx / directionLength * plateau.radius,
      z: plateau.center.z - dz / directionLength * plateau.radius,
    };
    const innerRamp = rampBetween(innerLow, plateau.center, 1, (point) =>
      levelTwoDistance(point, plan)
    );
    if (innerRamp) ramps.push(innerRamp);
  }
  return ramps;
};

const applyRamps = (
  point: TopologyPoint,
  terrainHeight: number,
  ramps: RampPlan[],
) => {
  let owner: { centerlineDistance: number; influence: number; height: number } | null = null;
  for (const ramp of ramps) {
    const offsetX = point.x - ramp.center.x;
    const offsetZ = point.z - ramp.center.z;
    const along = offsetX * ramp.direction.x + offsetZ * ramp.direction.z;
    const across = Math.abs(-offsetX * ramp.direction.z + offsetZ * ramp.direction.x);
    const influence = (
      1 - smoothstep(ramp.halfWidth * 0.72, ramp.halfWidth, across)
    ) * (
      1 - smoothstep(ramp.halfLength, ramp.halfLength + 5, Math.abs(along))
    );
    if (influence <= 0) continue;
    const targetHeight = TERRAIN_BASE_HEIGHT + (
      ramp.lowElevation + smoothstep(-ramp.halfLength, ramp.halfLength, along)
    ) * TERRAIN_LEVEL_HEIGHT;
    const centerlineDistance = across / ramp.halfWidth;
    if (!owner || centerlineDistance < owner.centerlineDistance) {
      owner = { centerlineDistance, influence, height: targetHeight };
    }
  }
  return owner
    ? terrainHeight + (owner.height - terrainHeight) * owner.influence
    : terrainHeight;
};

/** Compiles a small set of large mesa contours into the shared terrain height field. */
export const createContourTerrainHeights = (plan: ContourTerrainPlan) => {
  const segments = mapSegmentsForSize(plan.size);
  const scale = terrainFeatureScale(plan.size);
  const ramps = createRamps(plan);
  const row = segments + 1;
  const heights = new Float32Array(row * row);
  for (let z = 0; z <= segments; z += 1) {
    for (let x = 0; x <= segments; x += 1) {
      const point = {
        x: (x / segments - 0.5) * plan.size,
        z: (z / segments - 0.5) * plan.size,
      };
      const levelOneSigned = levelOneDistance(point, plan);
      const rawLevelTwoSigned = levelTwoDistance(point, plan);
      const levelTwoSigned = levelOneSigned - rawLevelTwoSigned
        < MINIMUM_LEVEL_ONE_SHELF * scale
        ? Math.max(rawLevelTwoSigned, levelOneSigned)
        : rawLevelTwoSigned;
      const levelOne = smoothstep(-CLIFF_HALF_WIDTH, CLIFF_HALF_WIDTH, levelOneSigned);
      const levelTwo = Math.min(
        levelOne,
        smoothstep(-CLIFF_HALF_WIDTH, CLIFF_HALF_WIDTH, levelTwoSigned),
      );
      let height = TERRAIN_BASE_HEIGHT
        + (levelOne + levelTwo) * TERRAIN_LEVEL_HEIGHT;
      height = applyRamps(point, height, ramps);
      const nearestBaseDistance = Math.min(...plan.bases.map((base) => distance(point, base)));
      const baseProtection = 1 - smoothstep(
        BASE_BUILDABLE_RADIUS,
        BASE_BUILDABLE_RADIUS + 4,
        nearestBaseDistance,
      );
      const baseHeight = TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT;
      height += (baseHeight - height) * baseProtection;
      heights[z * row + x] = height;
    }
  }
  return heights;
};
