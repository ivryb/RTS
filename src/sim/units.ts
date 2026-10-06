import { UNIT_DEFINITIONS, type UnitKind } from "./unitDefinitions";
import { behemothImpactDelayTicks, behemothVolleySeed } from "../behemothAttack";
import { directProjectileImpactDelayTicks } from "../directProjectile";
import { RecastNavigation } from "./navigation";
import { POSITION_SCALE, SIMULATION_TICK_SECONDS } from "./simulationConstants";
import {
  advanceTraining,
  canQueueTraining,
  cancelTraining,
  createTrainedUnitState,
  defaultRallyPoint,
  enqueueTraining,
  type TrainingQueueItem,
} from "./production";
import {
  BUILDING_DEFINITIONS,
  constructionPlacementIsValid,
  constructionTicks,
  type ConstructionTerrain,
} from "./construction";

export { POSITION_SCALE, SIMULATION_TICK_SECONDS } from "./simulationConstants";
export const UNIT_SEPARATION_GAP = 0.3 * POSITION_SCALE;
export const ATTACK_SEPARATION_GAP = 0.15 * POSITION_SCALE;
export const ATTACK_FACING_TOLERANCE = Math.PI / 30;
const TURN_RESPONSIVENESS: Record<UnitKind, number> = {
  ghostrunner: 14,
  "scout-drone": 18,
  behemoth: 6,
  hornet: 16,
};

export interface SimPoint {
  x: number;
  z: number;
}

export type BuildingKind = "command-center" | "turret";
export type BuildingLifecycle = "constructing" | "active";

export interface BuildingWeaponState {
  range: number;
  damage: number;
  intervalTicks: number;
  cooldownTicks: number;
  facing: number;
  targetId?: string;
}

export interface BuildingState {
  id: string;
  kind: BuildingKind;
  lifecycle: BuildingLifecycle;
  constructionProgress: number;
  ownerId: string;
  position: SimPoint;
  rotation: number;
  radius: number;
  attackRadius?: number;
  health: number;
  maxHealth: number;
  builderId?: string;
  weapon?: BuildingWeaponState;
  productionQueue?: TrainingQueueItem[];
  rallyPoint?: SimPoint;
}

export type UnitOrder = "idle" | "move" | "attack" | "attack-ground" | "build";

export interface UnitState {
  id: string;
  kind: UnitKind;
  ownerId: string;
  health: number;
  maxHealth: number;
  pushable: boolean;
  radius: number;
  speed: number;
  facing?: number;
  attackMinRange?: number;
  attackRange?: number;
  attackGroundRadius?: number;
  attackDamage?: number;
  attackIntervalTicks?: number;
  attackCooldownTicks: number;
  position: SimPoint;
  target: SimPoint;
  path: SimPoint[];
  order: UnitOrder;
  moving: boolean;
  attacking: boolean;
  attackTargetId?: string;
  attackGroundTarget?: SimPoint;
  constructionTargetId?: string;
  formationPosition?: SimPoint;
  guardMode?: "hold-position";
}

export interface MoveCommand {
  type: "move";
  commandId?: string;
  unitIds: string[];
  target: SimPoint;
}

export interface AttackCommand {
  type: "attack";
  commandId?: string;
  unitIds: string[];
  targetId: string;
}

export interface AttackGroundCommand {
  type: "attack-ground";
  commandId?: string;
  unitIds: string[];
  target: SimPoint;
}

export interface StopCommand {
  type: "stop";
  commandId?: string;
  unitIds: string[];
}

export interface BuildCommand {
  type: "build";
  commandId?: string;
  unitIds: string[];
  kind: BuildingKind;
  target: SimPoint;
  rotation: number;
}

export interface ResumeConstructionCommand {
  type: "resume-construction";
  commandId?: string;
  unitIds: string[];
  buildingId: string;
}

export interface TrainCommand {
  type: "train";
  commandId?: string;
  buildingId: string;
  kind: UnitKind;
}

export interface CancelTrainingCommand {
  type: "cancel-training";
  commandId?: string;
  buildingId: string;
  itemId: string;
}

export interface SetRallyPointCommand {
  type: "set-rally-point";
  commandId?: string;
  buildingId: string;
  target: SimPoint;
}

export type PlayerCommand = MoveCommand | AttackCommand | AttackGroundCommand | StopCommand
  | BuildCommand | ResumeConstructionCommand | TrainCommand | CancelTrainingCommand
  | SetRallyPointCommand;

export interface DispatchResult {
  commandId?: string;
  playerId: string;
  serverTick: number;
  accepted: boolean;
  duplicate: boolean;
}

export interface MatchResult {
  winnerId?: string;
  defeatedPlayerIds: readonly string[];
  resolvedTick: number;
}

export interface SimulationOptions {
  commandCenterElimination?: readonly string[];
}

export interface AcceptedCommand {
  playerId: string;
  serverTick: number;
  command: PlayerCommand;
}

export type SimulationEvent =
  | {
    type: "weapon-fired";
    tick: number;
    attackerId: string;
    attack: "direct";
    targetId: string;
    target: SimPoint;
    impactTick: number;
  }
  | {
    type: "weapon-fired";
    tick: number;
    attackerId: string;
    attack: "ground";
    target: SimPoint;
  }
  | {
    type: "damage";
    tick: number;
    attackerId: string;
    targetId: string;
    target: "unit" | "building";
    amount: number;
    health: number;
  }
  | {
    type: "unit-died" | "building-died";
    tick: number;
    id: string;
    attackerId: string;
  };

export interface GameSimulation {
  readonly currentTick: number;
  readonly matchResult: MatchResult | undefined;
  dispatch(playerId: string, command: PlayerCommand): DispatchResult;
  createBuilding(building: BuildingState): boolean;
  step(): void;
  snapshot(): readonly UnitState[];
  buildingSnapshot(): readonly BuildingState[];
  drainEvents(): readonly SimulationEvent[];
  drainAcceptedCommands(): readonly AcceptedCommand[];
  dispose(): void;
}

export const toSimPoint = (x: number, z: number): SimPoint => ({
  x: Math.round(x * POSITION_SCALE),
  z: Math.round(z * POSITION_SCALE),
});

const PATH_CLEARANCE = 0.15 * POSITION_SCALE;
const MELEE_REACH = 0.55 * POSITION_SCALE;
const PATH_SAMPLES = 16;
const MAX_ATTACK_SAMPLES = 64;
const ATTACK_RETRY_TICKS = 5;
const ATTACK_STALL_TICKS = 5;
const ATTACK_WAIT_TICKS = 20;
const COLLISION_PASSES = 4;
const MAX_COMMAND_HISTORY = 4_096;
const POSITION_ROUNDING_TOLERANCE = 2;

type CircularObstacle = Pick<BuildingState, "position" | "radius">;
type DirectAttackTarget = BuildingState | UnitState;
type CombatAttacker = Pick<UnitState, "id"> | Pick<BuildingState, "id">;

interface PendingGroundImpact {
  impactTick: number;
  attackerId: string;
  target: SimPoint;
  radius: number;
  damage: number;
}
interface PendingDirectImpact {
  impactTick: number;
  attackerId: string;
  targetId: string;
  target: "unit" | "building";
  damage: number;
}
type RangedFormation = { angle: number; columns: number; size: number };
const isUnitTarget = (target: DirectAttackTarget): target is UnitState => "pushable" in target;
const compareIds = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const directMaximumRange = (unit: UnitState, target: DirectAttackTarget) => {
  const targetRadius = isUnitTarget(target) ? target.radius : target.attackRadius ?? target.radius;
  return unit.attackRange
    ? targetRadius + unit.attackRange
    : target.radius + unit.radius + MELEE_REACH;
};
const directApproachRadius = (unit: UnitState, target: DirectAttackTarget) => {
  const maximum = directMaximumRange(unit, target);
  const reach = unit.attackRange || MELEE_REACH;
  return maximum - Math.min(PATH_CLEARANCE, reach / 2);
};
const groundApproachRadius = (unit: UnitState, targetDistance: number) => {
  const minimum = unit.attackMinRange ?? 0;
  const maximum = unit.attackRange ?? 0;
  if (targetDistance < minimum) return minimum + PATH_CLEARANCE;
  if (targetDistance > maximum) return maximum - PATH_CLEARANCE;
  return targetDistance;
};
const reservedPosition = (unit: UnitState) => unit.formationPosition
  ?? (unit.moving ? unit.path.at(-1) ?? unit.target : unit.position);
const rangedFormationFor = (
  units: readonly UnitState[],
  target: SimPoint,
): RangedFormation | undefined => {
  if (units.length < 2) return undefined;
  const center = units.reduce((total, unit) => ({
    x: total.x + unit.position.x / units.length,
    z: total.z + unit.position.z / units.length,
  }), { x: 0, z: 0 });
  return {
    angle: Math.atan2(center.z - target.z, center.x - target.x),
    columns: Math.ceil(Math.sqrt(units.length)),
    size: units.length,
  };
};
const retrySlot = (id: string) => {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(index)) >>> 0;
  }
  return hash % ATTACK_RETRY_TICKS;
};

const distance = (a: SimPoint, b: SimPoint) => Math.hypot(b.x - a.x, b.z - a.z);

const selectHostileUnit = (
  units: ReadonlyMap<string, UnitState>,
  attacker: Pick<UnitState, "ownerId" | "position">,
  currentTargetId: string | undefined,
  inRange: (unit: UnitState) => boolean,
) => {
  const eligible = (unit: UnitState | undefined): unit is UnitState => Boolean(
    unit && unit.health > 0 && unit.ownerId !== attacker.ownerId && inRange(unit),
  );
  const current = currentTargetId ? units.get(currentTargetId) : undefined;
  if (eligible(current)) return current;
  return [...units.values()].filter(eligible).sort((first, second) => {
    const distanceDifference = distance(attacker.position, first.position)
      - distance(attacker.position, second.position);
    return distanceDifference || compareIds(first, second);
  })[0];
};

const segmentIsClear = (
  start: SimPoint,
  end: SimPoint,
  obstacles: readonly CircularObstacle[],
  unitRadius: number,
) => obstacles.every((obstacle) => {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const projection = lengthSquared === 0
    ? 0
    : ((obstacle.position.x - start.x) * dx + (obstacle.position.z - start.z) * dz)
      / lengthSquared;
  const t = Math.max(0, Math.min(1, projection));
  const nearestX = start.x + dx * t;
  const nearestZ = start.z + dz * t;
  const safeRadius = obstacle.radius + unitRadius + PATH_CLEARANCE;
  return (nearestX - obstacle.position.x) ** 2 + (nearestZ - obstacle.position.z) ** 2
    >= safeRadius ** 2;
});

const positionIsClear = (
  point: SimPoint,
  obstacles: readonly CircularObstacle[],
  unitRadius: number,
) => obstacles.every((obstacle) => {
  const safeRadius = obstacle.radius + unitRadius + PATH_CLEARANCE;
  return (point.x - obstacle.position.x) ** 2 + (point.z - obstacle.position.z) ** 2
    >= safeRadius ** 2;
});

const nearestWalkablePoint = (
  point: SimPoint,
  obstacles: readonly CircularObstacle[],
  unitRadius: number,
) => {
  const result = { ...point };
  for (let pass = 0; pass <= obstacles.length; pass += 1) {
    let changed = false;
    for (const obstacle of obstacles) {
      const safeRadius = obstacle.radius + unitRadius + PATH_CLEARANCE + 2;
      let dx = result.x - obstacle.position.x;
      let dz = result.z - obstacle.position.z;
      let currentDistance = Math.hypot(dx, dz);
      if (currentDistance >= safeRadius) continue;
      if (currentDistance === 0) {
        dx = 1;
        dz = 0;
        currentDistance = 1;
      }
      result.x = Math.round(obstacle.position.x + dx / currentDistance * safeRadius);
      result.z = Math.round(obstacle.position.z + dz / currentDistance * safeRadius);
      changed = true;
    }
    if (!changed) break;
  }
  return result;
};

const pathLength = (start: SimPoint, path: readonly SimPoint[]) => {
  let total = 0;
  let previous = start;
  for (const point of path) {
    total += distance(previous, point);
    previous = point;
  }
  return total;
};

const routeIsClear = (
  start: SimPoint,
  path: readonly SimPoint[],
  obstacles: readonly CircularObstacle[],
  unitRadius: number,
) => {
  let previous = start;
  for (const point of path) {
    if (!segmentIsClear(previous, point, obstacles, unitRadius)) return false;
    previous = point;
  }
  return true;
};

const formationTargets = (center: SimPoint, units: readonly UnitState[]): SimPoint[] => {
  if (units.length === 1) return [{ ...center }];
  const average = units.reduce(
    (total, unit) => ({
      x: total.x + unit.position.x / units.length,
      z: total.z + unit.position.z / units.length,
    }),
    { x: 0, z: 0 },
  );
  const travelX = center.x - average.x;
  const travelZ = center.z - average.z;
  const travelLength = Math.hypot(travelX, travelZ);
  const forwardX = travelLength ? travelX / travelLength : 0;
  const forwardZ = travelLength ? travelZ / travelLength : 1;
  const lateralX = -forwardZ;
  const lateralZ = forwardX;
  const ordered = [...units].sort((first, second) => {
    const forward = (first.position.x - second.position.x) * forwardX
      + (first.position.z - second.position.z) * forwardZ;
    const lateral = (first.position.x - second.position.x) * lateralX
      + (first.position.z - second.position.z) * lateralZ;
    return forward || lateral || compareIds(first, second);
  });
  const columns = Math.ceil(Math.sqrt(ordered.length));
  const rows = Array.from(
    { length: Math.ceil(ordered.length / columns) },
    (_, index) => ordered.slice(index * columns, (index + 1) * columns)
      .sort((first, second) => {
        const lateral = (first.position.x - second.position.x) * lateralX
          + (first.position.z - second.position.z) * lateralZ;
        const forward = (first.position.x - second.position.x) * forwardX
          + (first.position.z - second.position.z) * forwardZ;
        return lateral || forward || compareIds(first, second);
      }),
  );
  const rowRadii = rows.map((row) => Math.max(...row.map((unit) => unit.radius)));
  const depth = rowRadii.reduce((total, radius) => total + radius * 2, 0)
    + (rows.length - 1) * UNIT_SEPARATION_GAP;
  let z = center.z - depth / 2;
  const targets = new Map<string, SimPoint>();
  for (const [rowIndex, row] of rows.entries()) {
    const rowRadius = rowRadii[rowIndex]!;
    const width = row.reduce((total, unit) => total + unit.radius * 2, 0)
      + (row.length - 1) * UNIT_SEPARATION_GAP;
    let x = center.x - width / 2;
    for (const unit of row) {
      x += unit.radius;
      const localX = x - center.x;
      const localZ = z + rowRadius - center.z;
      targets.set(unit.id, {
        x: Math.round(center.x + localX * lateralX + localZ * forwardX),
        z: Math.round(center.z + localX * lateralZ + localZ * forwardZ),
      });
      x += unit.radius + UNIT_SEPARATION_GAP;
    }
    z += rowRadius * 2 + UNIT_SEPARATION_GAP;
  }
  return units.map((unit) => targets.get(unit.id)!);
};

const formationPaths = (
  target: SimPoint,
  units: readonly UnitState[],
  destinations: readonly SimPoint[],
  obstacles: readonly CircularObstacle[],
  navigation: RecastNavigation,
) => {
  if (!units.length) return [];
  if (navigation.hasTerrain) return units.map(() => undefined);
  const center = units.reduce((total, unit) => ({
    x: total.x + unit.position.x / units.length,
    z: total.z + unit.position.z / units.length,
  }), { x: 0, z: 0 });
  const shared = navigation.plan(center, target, Math.max(...units.map((unit) => unit.radius)));
  if (!shared?.length) return units.map(() => undefined);
  const totalLength = pathLength(center, shared);
  return units.map((unit, index) => {
    const destination = destinations[index]!;
    const startOffset = {
      x: unit.position.x - center.x,
      z: unit.position.z - center.z,
    };
    const endOffset = {
      x: destination.x - target.x,
      z: destination.z - target.z,
    };
    let covered = 0;
    let previousCenter = center;
    let previousUnit = unit.position;
    const path: SimPoint[] = [];
    for (const point of shared) {
      covered += distance(previousCenter, point);
      previousCenter = point;
      const progress = totalLength ? Math.min(1, covered / totalLength) : 1;
      const offset = {
        x: startOffset.x + (endOffset.x - startOffset.x) * progress,
        z: startOffset.z + (endOffset.z - startOffset.z) * progress,
      };
      const candidate = (scale: number) => ({
        x: Math.round(point.x + offset.x * scale),
        z: Math.round(point.z + offset.z * scale),
      });
      let next = candidate(1);
      if (!positionIsClear(next, obstacles, unit.radius)
        || !segmentIsClear(previousUnit, next, obstacles, unit.radius)) {
        if (!positionIsClear(point, obstacles, unit.radius)
          || !segmentIsClear(previousUnit, point, obstacles, unit.radius)) return undefined;
        let clearScale = 0;
        let blockedScale = 1;
        for (let iteration = 0; iteration < 8; iteration += 1) {
          const scale = (clearScale + blockedScale) / 2;
          const scaled = candidate(scale);
          if (positionIsClear(scaled, obstacles, unit.radius)
            && segmentIsClear(previousUnit, scaled, obstacles, unit.radius)) clearScale = scale;
          else blockedScale = scale;
        }
        next = candidate(clearScale);
      }
      if (next.x !== previousUnit.x || next.z !== previousUnit.z) path.push(next);
      previousUnit = next;
    }
    return path;
  });
};

class PathPlanner {
  private readonly nodes: SimPoint[] = [];
  private readonly edges: { index: number; cost: number }[][] = [];
  private initialized = false;

  constructor(
    private readonly obstacles: readonly CircularObstacle[],
    private readonly unitRadius: number,
    private readonly navigation: RecastNavigation,
  ) {}

  private initialize() {
    if (this.initialized) return;
    this.initialized = true;
    for (const obstacle of this.obstacles) {
      const safeRadius = obstacle.radius + this.unitRadius + PATH_CLEARANCE;
      const nodeRadius = safeRadius / Math.cos(Math.PI / PATH_SAMPLES) + 2;
      for (let index = 0; index < PATH_SAMPLES; index += 1) {
        const angle = index / PATH_SAMPLES * Math.PI * 2;
        this.nodes.push({
          x: Math.round(obstacle.position.x + Math.cos(angle) * nodeRadius),
          z: Math.round(obstacle.position.z + Math.sin(angle) * nodeRadius),
        });
      }
    }
    this.edges.push(...this.nodes.map(() => []));
    for (let first = 0; first < this.nodes.length; first += 1) {
      for (let second = first + 1; second < this.nodes.length; second += 1) {
        if (!segmentIsClear(
          this.nodes[first]!,
          this.nodes[second]!,
          this.obstacles,
          this.unitRadius,
        )) continue;
        const cost = distance(this.nodes[first]!, this.nodes[second]!);
        this.edges[first]!.push({ index: second, cost });
        this.edges[second]!.push({ index: first, cost });
      }
    }
  }

  plan(start: SimPoint, goal: SimPoint) {
    const { obstacles, unitRadius } = this;
    const pathStart = nearestWalkablePoint(start, obstacles, unitRadius);
    const pathGoal = nearestWalkablePoint(goal, obstacles, unitRadius);
    const escape = pathStart.x === start.x && pathStart.z === start.z ? [] : [pathStart];
    if (pathStart.x === pathGoal.x && pathStart.z === pathGoal.z) return escape;
    if (this.navigation.hasTerrain) {
      let path = this.navigation.plan(pathStart, pathGoal, unitRadius);
      // The terrain mesh contains buildings, but unit blockers need a fresh detour.
      if (path && !routeIsClear(pathStart, path, obstacles, unitRadius)) {
        path = this.navigation.planAroundObstacles(pathStart, pathGoal, unitRadius, obstacles);
      }
      return path && routeIsClear(pathStart, path, obstacles, unitRadius)
        ? [...escape, ...path]
        : undefined;
    }
    if (segmentIsClear(pathStart, pathGoal, obstacles, unitRadius)) {
      return [...escape, pathGoal];
    }
    const navigationPath = this.navigation.plan(pathStart, pathGoal, unitRadius);
    if (!navigationPath) return undefined;
    if (routeIsClear(pathStart, navigationPath, obstacles, unitRadius)) {
      return [...escape, ...navigationPath];
    }
    this.initialize();

    const nodes = [pathStart, pathGoal, ...this.nodes];
    const costs = nodes.map(() => Infinity);
    const previous = nodes.map(() => -1);
    const visited = nodes.map(() => false);
    const startEdges: number[] = [];
    const goalEdges: number[] = [];
    for (let index = 0; index < this.nodes.length; index += 1) {
      const node = this.nodes[index]!;
      if (segmentIsClear(pathStart, node, obstacles, unitRadius)) startEdges.push(index + 2);
      if (segmentIsClear(pathGoal, node, obstacles, unitRadius)) goalEdges.push(index + 2);
    }
    const goalEdgeSet = new Set(goalEdges);
    costs[0] = 0;
    const queue = new MinQueue();
    queue.push(0, distance(pathStart, pathGoal));

    for (let current = queue.pop(); current !== undefined; current = queue.pop()) {
      if (visited[current]) continue;
      if (current === 1) break;
      visited[current] = true;

      const nextNodes = current === 0
        ? startEdges.map((index) => ({ index, cost: distance(pathStart, nodes[index]!) }))
        : [
          ...this.edges[current - 2]!.map((edge) => ({
            index: edge.index + 2,
            cost: edge.cost,
          })),
          ...(goalEdgeSet.has(current)
            ? [{ index: 1, cost: distance(nodes[current]!, pathGoal) }]
            : []),
        ];
      for (const next of nextNodes) {
        if (visited[next.index]) continue;
        const cost = costs[current]! + next.cost;
        if (cost < costs[next.index]!) {
          costs[next.index] = cost;
          previous[next.index] = current;
          queue.push(next.index, cost + distance(nodes[next.index]!, pathGoal));
        }
      }
    }

    if (!Number.isFinite(costs[1])) return undefined;
    const path: SimPoint[] = [];
    for (let index = 1; index > 0; index = previous[index]!) path.unshift({ ...nodes[index]! });
    return [...escape, ...path];
  }
}

const attackSpotIsFree = (
  unit: UnitState,
  point: SimPoint,
  reservations: readonly CircularObstacle[],
) => reservations.every((reserved) => distance(point, reserved.position)
  >= unit.radius + reserved.radius + ATTACK_SEPARATION_GAP - POSITION_ROUNDING_TOLERANCE);

const ringSlotCount = (radius: number, spacing: number) => Math.max(
  1,
  Math.min(MAX_ATTACK_SAMPLES, Math.floor(
    Math.PI / Math.asin(Math.min(1, spacing / (radius * 2))),
  )),
);

const planAttackRing = (
  unit: UnitState,
  target: SimPoint,
  radius: number,
  reservations: readonly CircularObstacle[],
  planner: PathPlanner,
  maximumRange = Infinity,
) => {
  const spacing = unit.radius * 2 + ATTACK_SEPARATION_GAP;
  const samples = ringSlotCount(radius, spacing);
  const angleStep = Math.PI * 2 / samples;
  const approachAngle = Math.atan2(unit.position.z - target.z, unit.position.x - target.x);
  const baseAngle = Math.round(approachAngle / angleStep) * angleStep;
  let shortest: SimPoint[] | undefined;
  let shortestLength = Infinity;
  for (let index = 0; index < samples; index += 1) {
    const offset = index === 0 ? 0 : Math.ceil(index / 2) * (index % 2 ? 1 : -1);
    const angle = baseAngle + offset * angleStep;
    const approach = {
      x: Math.round(target.x + Math.cos(angle) * radius),
      z: Math.round(target.z + Math.sin(angle) * radius),
    };
    if (!attackSpotIsFree(unit, approach, reservations)) continue;
    const path = planner.plan(unit.position, approach);
    if (!path) continue;
    const endpoint = path.at(-1) ?? unit.position;
    if (distance(endpoint, target) > maximumRange) continue;
    const length = pathLength(unit.position, path);
    if (length < shortestLength) {
      shortest = path;
      shortestLength = length;
    }
  }
  return shortest;
};

const planAttackRanks = (
  unit: UnitState,
  target: SimPoint,
  outerRadius: number,
  reservations: readonly CircularObstacle[],
  planner: PathPlanner,
  formation: RangedFormation,
) => {
  const spacing = unit.radius * 2 + ATTACK_SEPARATION_GAP;
  let shortest: SimPoint[] | undefined;
  let shortestLength = Infinity;
  for (let row = 0; row * formation.columns < formation.size; row += 1) {
    const radius = outerRadius - row * spacing;
    if (radius <= spacing / 2) break;
    const slots = Math.min(formation.columns, formation.size - row * formation.columns);
    const angleStep = 2 * Math.asin(Math.min(1, spacing / (radius * 2)));
    for (let column = 0; column < slots; column += 1) {
      const angle = formation.angle + (column - (slots - 1) / 2) * angleStep;
      const position = {
        x: Math.round(target.x + Math.cos(angle) * radius),
        z: Math.round(target.z + Math.sin(angle) * radius),
      };
      if (!attackSpotIsFree(unit, position, reservations)) continue;
      const path = planner.plan(unit.position, position);
      if (!path) continue;
      const length = pathLength(unit.position, path);
      if (length < shortestLength) {
        shortest = path;
        shortestLength = length;
      }
    }
  }
  return shortest;
};

const planWaitingRings = (
  unit: UnitState,
  target: SimPoint,
  attackRadius: number,
  reservations: readonly CircularObstacle[],
  planner: PathPlanner,
) => {
  const spacing = unit.radius * 2 + ATTACK_SEPARATION_GAP;
  for (let ring = 1; ring <= 4; ring += 1) {
    const path = planAttackRing(
      unit,
      target,
      attackRadius + spacing * ring,
      reservations,
      planner,
    );
    if (path !== undefined) return path;
  }
  return undefined;
};

class MinQueue {
  private readonly values: { index: number; score: number }[] = [];

  push(index: number, score: number) {
    const value = { index, score };
    this.values.push(value);
    for (let child = this.values.length - 1; child > 0;) {
      const parent = Math.floor((child - 1) / 2);
      if (MinQueue.compare(this.values[parent]!, value) <= 0) break;
      this.values[child] = this.values[parent]!;
      child = parent;
      this.values[child] = value;
    }
  }

  pop() {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || !this.values.length) return first?.index;
    this.values[0] = last;
    for (let parent = 0;;) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let child = left;
      if (right < this.values.length
        && MinQueue.compare(this.values[right]!, this.values[left]!) < 0) child = right;
      if (child >= this.values.length
        || MinQueue.compare(this.values[parent]!, this.values[child]!) <= 0) break;
      [this.values[parent], this.values[child]] = [this.values[child]!, this.values[parent]!];
      parent = child;
    }
    return first.index;
  }

  private static compare(first: { index: number; score: number }, second: { index: number; score: number }) {
    return first.score - second.score || first.index - second.index;
  }
}

export class LocalUnitSimulation implements GameSimulation {
  private readonly units = new Map<string, UnitState>();
  private readonly buildings = new Map<string, BuildingState>();
  private readonly commands = new Map<string, DispatchResult>();
  private readonly groundNavigation: RecastNavigation;
  private readonly attackStalls = new Map<string, {
    waypoint: SimPoint;
    bestDistance: number;
    stagnantTicks: number;
  }>();
  private readonly attackWaitingUntil = new Map<string, number>();
  private readonly pendingDirectImpacts: PendingDirectImpact[] = [];
  private readonly pendingGroundImpacts: PendingGroundImpact[] = [];
  private events: SimulationEvent[] = [];
  private acceptedCommands: AcceptedCommand[] = [];
  private tick = 0;
  private buildingSequence = 0;
  private productionSequence = 0;
  private unitSequence = 0;
  private readonly eliminationPlayerIds: readonly string[];
  private result?: MatchResult;

  constructor(
    units: readonly UnitState[],
    buildings: readonly BuildingState[] = [],
    private readonly terrain?: ConstructionTerrain,
    options: SimulationOptions = {},
  ) {
    this.eliminationPlayerIds = [...new Set(options.commandCenterElimination ?? [])];
    this.groundNavigation = new RecastNavigation(terrain);
    for (const unit of units) this.units.set(unit.id, structuredClone(unit));
    for (const building of buildings) {
      const authoritative = structuredClone(building);
      this.initializeBuilding(authoritative);
      this.buildings.set(building.id, authoritative);
    }
    this.setNavigationObstacles(this.pathingBuildings());
    this.groundNavigation.prepare(units
      .filter((unit) => UNIT_DEFINITIONS[unit.kind].movement === "ground")
      .map((unit) => unit.radius));
  }

  get currentTick() {
    return this.tick;
  }

  get matchResult() {
    return this.result;
  }

  createBuilding(building: BuildingState) {
    if (this.result || this.buildings.has(building.id)
      || building.health <= 0
      || building.health > building.maxHealth
      || building.radius <= 0
      || building.constructionProgress < 0
      || building.constructionProgress > 1
      || (building.lifecycle === "active" && building.constructionProgress !== 1)
      || (building.lifecycle === "active" && building.builderId !== undefined)
      || (building.lifecycle === "constructing" && building.constructionProgress === 1)) {
      return false;
    }
    const authoritative = structuredClone(building);
    this.initializeBuilding(authoritative);
    this.buildings.set(building.id, authoritative);
    this.setNavigationObstacles(this.pathingBuildings());
    return true;
  }

  private initializeBuilding(building: BuildingState) {
    const weapon = BUILDING_DEFINITIONS[building.kind]?.weapon;
    if (weapon) {
      building.weapon ??= {
        range: Math.round(weapon.range * POSITION_SCALE),
        damage: weapon.damage,
        intervalTicks: Math.round(weapon.intervalSeconds / SIMULATION_TICK_SECONDS),
        cooldownTicks: 0,
        facing: building.rotation - Math.PI / 2,
      };
      building.weapon.facing ??= building.rotation - Math.PI / 2;
    }
    if (building.kind === "command-center") {
      building.productionQueue ??= [];
      building.rallyPoint ??= defaultRallyPoint(
        building.position,
        building.radius,
        building.rotation,
        this.terrain?.size,
      );
    }
  }

  private startConstruction(playerId: string, command: BuildCommand) {
    const builder = command.unitIds.flatMap((id) => {
      const unit = this.units.get(id);
      return unit?.ownerId === playerId && unit.health > 0 && unit.kind === "scout-drone"
        ? [unit]
        : [];
    })[0];
    if (!builder || !Number.isFinite(command.rotation) || !constructionPlacementIsValid(
      this.terrain,
      command.kind,
      command.target,
      this.pathingBuildings(),
      [...this.units.values()],
    )) return false;

    let sequence = this.buildingSequence + 1;
    while (this.buildings.has(`${playerId}-building-${sequence}`)) sequence += 1;
    const id = `${playerId}-building-${sequence}`;
    const definition = BUILDING_DEFINITIONS[command.kind];
    const site: BuildingState = {
      id,
      kind: command.kind,
      lifecycle: "constructing",
      constructionProgress: 0,
      ownerId: playerId,
      position: { ...command.target },
      rotation: command.rotation,
      radius: Math.round(definition.radius * POSITION_SCALE),
      attackRadius: Math.round(definition.attackRadius * POSITION_SCALE),
      health: 1,
      maxHealth: definition.maxHealth,
    };
    if (!this.createBuilding(site)) return false;
    const authoritativeSite = this.buildings.get(id)!;
    const path = this.planConstructionPath(builder, authoritativeSite);
    if (!path) {
      this.buildings.delete(id);
      this.setNavigationObstacles(this.pathingBuildings());
      return false;
    }
    this.buildingSequence = sequence;
    this.assignConstruction(builder, authoritativeSite, path);
    return true;
  }

  private resumeConstruction(playerId: string, command: ResumeConstructionCommand) {
    const site = this.buildings.get(command.buildingId);
    const builder = command.unitIds.flatMap((id) => {
      const unit = this.units.get(id);
      return unit?.ownerId === playerId && unit.health > 0 && unit.kind === "scout-drone"
        ? [unit]
        : [];
    })[0];
    if (!builder || !site || site.ownerId !== playerId || site.health <= 0
      || site.lifecycle !== "constructing") return false;
    const path = this.planConstructionPath(builder, site);
    if (!path) return false;
    this.assignConstruction(builder, site, path);
    return true;
  }

  private queueTraining(playerId: string, command: TrainCommand) {
    if (!Object.hasOwn(UNIT_DEFINITIONS, command.kind)) return false;
    const commandCenter = this.buildings.get(command.buildingId);
    if (!commandCenter || commandCenter.ownerId !== playerId
      || commandCenter.kind !== "command-center" || commandCenter.lifecycle !== "active"
      || commandCenter.health <= 0) return false;
    const queue = commandCenter.productionQueue ??= [];
    if (!canQueueTraining(playerId, command.kind, queue, this.units.values(), this.buildings.values())) {
      return false;
    }
    const existingIds = new Set([...this.buildings.values()].flatMap((building) =>
      building.productionQueue?.map((item) => item.id) ?? []));
    let sequence = this.productionSequence + 1;
    while (existingIds.has(`${playerId}-training-${sequence}`)) sequence += 1;
    enqueueTraining(queue, `${playerId}-training-${sequence}`, command.kind);
    this.productionSequence = sequence;
    return true;
  }

  private cancelTraining(playerId: string, command: CancelTrainingCommand) {
    const commandCenter = this.buildings.get(command.buildingId);
    if (!commandCenter || commandCenter.ownerId !== playerId
      || commandCenter.kind !== "command-center" || commandCenter.lifecycle !== "active"
      || commandCenter.health <= 0 || !commandCenter.productionQueue) return false;
    return cancelTraining(commandCenter.productionQueue, command.itemId);
  }

  private setRallyPoint(playerId: string, command: SetRallyPointCommand) {
    const commandCenter = this.buildings.get(command.buildingId);
    if (!commandCenter || commandCenter.ownerId !== playerId
      || commandCenter.kind !== "command-center" || commandCenter.lifecycle !== "active"
      || commandCenter.health <= 0 || !Number.isFinite(command.target.x)
      || !Number.isFinite(command.target.z)) return false;
    if (this.terrain) {
      const halfSize = this.terrain.size * POSITION_SCALE / 2;
      if (Math.abs(command.target.x) > halfSize || Math.abs(command.target.z) > halfSize) {
        return false;
      }
    }
    commandCenter.rallyPoint = { ...command.target };
    return true;
  }

  private assignConstruction(builder: UnitState, site: BuildingState, path: SimPoint[]) {
    const previousBuilder = site.builderId && this.units.get(site.builderId);
    if (previousBuilder && previousBuilder.id !== builder.id) this.stop(previousBuilder);
    this.releaseConstruction(builder);
    site.builderId = builder.id;
    builder.path = path;
    builder.order = "build";
    builder.attackTargetId = undefined;
    builder.attackGroundTarget = undefined;
    builder.constructionTargetId = site.id;
    builder.formationPosition = { ...(path.at(-1) ?? builder.position) };
    builder.moving = path.length > 0;
    builder.attacking = false;
    builder.target = path[0] ? { ...path[0] } : { ...site.position };
  }

  private planConstructionPath(builder: UnitState, site: BuildingState) {
    if (distance(builder.position, site.position) <= directMaximumRange(builder, site)) return [];
    return planAttackRing(
      builder,
      site.position,
      directApproachRadius(builder, site),
      [],
      this.createPathPlanner(builder),
      // Recast can project a requested edge point outside construction reach.
      // Reject that endpoint instead of repeatedly walking to the same unusable spot.
      directMaximumRange(builder, site) + POSITION_ROUNDING_TOLERANCE,
    );
  }

  dispose() {
    this.groundNavigation.destroy();
  }

  dispatch(playerId: string, command: PlayerCommand): DispatchResult {
    const key = command.commandId && `${playerId}:${command.commandId}`;
    const previous = key ? this.commands.get(key) : undefined;
    if (previous) return { ...previous, duplicate: true };

    const finish = (accepted: boolean): DispatchResult => {
      const result = {
        commandId: command.commandId,
        playerId,
        serverTick: this.tick,
        accepted,
        duplicate: false,
      };
      if (key) {
        this.commands.set(key, result);
        if (this.commands.size > MAX_COMMAND_HISTORY) {
          this.commands.delete(this.commands.keys().next().value!);
        }
      }
      if (accepted) {
        this.acceptedCommands.push({
          playerId,
          serverTick: this.tick,
          command: structuredClone(command),
        });
      }
      return result;
    };
    if (this.result) return finish(false);
    const attackTarget = command.type === "attack" ? this.directTarget(command.targetId) : undefined;
    if (command.type === "build") {
      return finish(this.startConstruction(playerId, command));
    }
    if (command.type === "resume-construction") {
      return finish(this.resumeConstruction(playerId, command));
    }
    if (command.type === "train") {
      return finish(this.queueTraining(playerId, command));
    }
    if (command.type === "cancel-training") {
      return finish(this.cancelTraining(playerId, command));
    }
    if (command.type === "set-rally-point") {
      return finish(this.setRallyPoint(playerId, command));
    }
    if (command.type === "attack" && (!attackTarget || attackTarget.health === 0
      || attackTarget.ownerId === playerId)) return finish(false);

    const ownedUnits = command.unitIds.flatMap((id) => {
      const unit = this.units.get(id);
      return unit?.ownerId === playerId && unit.health > 0 ? [unit] : [];
    });
    const units = command.type === "attack-ground"
      ? ownedUnits.filter((unit) => unit.attackGroundRadius)
      : ownedUnits;
    if (command.type === "stop") {
      for (const unit of units) this.stop(unit);
      return finish(units.length > 0);
    }
    const commandedIds = new Set(units.map((unit) => unit.id));
    const buildings = this.pathingBuildings();
    this.setNavigationObstacles(buildings);
    const obstacles = this.pathingObstacles(commandedIds, buildings);
    const planners = new Map<string, PathPlanner>();
    const plannerFor = (unit: UnitState) => {
      const navigation = this.groundNavigation;
      const key = `${UNIT_DEFINITIONS[unit.kind].movement}:${unit.radius}`;
      let planner = planners.get(key);
      if (!planner) {
        planner = new PathPlanner(obstacles, unit.radius, navigation);
        planners.set(key, planner);
      }
      return planner;
    };
    const destinations = command.type === "move" ? formationTargets(command.target, units) : [];
    const sharedNavigation = units.length > 0 && units.every((unit) =>
      UNIT_DEFINITIONS[unit.kind].movement === UNIT_DEFINITIONS[units[0]!.kind].movement
    ) ? this.groundNavigation : undefined;
    const sharedPaths = command.type === "move"
      && sharedNavigation
      ? formationPaths(command.target, units, destinations, obstacles, sharedNavigation)
      : [];
    const rangedFormation = command.type === "attack" && !isUnitTarget(attackTarget!)
      ? rangedFormationFor(units.filter((unit) => unit.attackRange), attackTarget!.position)
      : undefined;
    for (const unit of units) {
      this.releaseConstruction(unit);
      this.attackStalls.delete(unit.id);
      this.attackWaitingUntil.delete(unit.id);
      unit.order = "idle";
      unit.attackTargetId = undefined;
      unit.attackGroundTarget = undefined;
      unit.constructionTargetId = undefined;
      unit.formationPosition = undefined;
    }
    for (const [index, unit] of units.entries()) {
      let waiting = false;
      let destination = command.type === "move"
        ? destinations[index]
        : undefined;
      let path = command.type === "move"
        ? sharedPaths[index] ?? plannerFor(unit).plan(unit.position, destination!)
        : command.type === "attack"
          ? this.planAttackPath(
              unit,
              attackTarget!,
              plannerFor(unit),
              units.length > 1,
              unit.attackRange ? rangedFormation : undefined,
            )
          : this.planAttackGroundPath(unit, command.target, plannerFor(unit), units.length > 1);
      if (!path && command.type === "move") {
        destination = command.target;
        path = plannerFor(unit).plan(unit.position, destination);
      }
      if (!path && command.type === "attack") {
        path = this.planDirectWaitingPath(unit, attackTarget!, plannerFor(unit));
        waiting = path !== undefined;
      } else if (!path && command.type === "attack-ground") {
        path = this.planGroundWaitingPath(unit, command.target, plannerFor(unit));
        waiting = path !== undefined;
      }

      // A new command always supersedes the previous one, even when no route exists.
      if (!path) {
        if (command.type === "attack" || command.type === "attack-ground") {
          unit.path = [];
          unit.order = command.type;
          unit.attackTargetId = command.type === "attack" ? command.targetId : undefined;
          unit.attackGroundTarget = command.type === "attack-ground"
            ? { ...command.target }
            : undefined;
          unit.moving = false;
          unit.attacking = false;
          unit.formationPosition = { ...unit.position };
          unit.target = command.type === "attack"
            ? { ...attackTarget!.position }
            : { ...command.target };
          continue;
        }
        unit.path = [];
        unit.order = "idle";
        unit.attackTargetId = undefined;
        unit.attackGroundTarget = undefined;
        unit.formationPosition = undefined;
        unit.moving = false;
        unit.attacking = false;
        unit.target = { ...unit.position };
        continue;
      }

      unit.path = path;
      unit.order = command.type;
      unit.attackTargetId = command.type === "attack" ? command.targetId : undefined;
      unit.attackGroundTarget = command.type === "attack-ground" ? { ...command.target } : undefined;
      unit.formationPosition = command.type === "attack" || command.type === "attack-ground"
        ? { ...(path.at(-1) ?? unit.position) }
        : undefined;
      unit.moving = path.length > 0;
      unit.attacking = (command.type === "attack" || command.type === "attack-ground")
        && !unit.moving && !waiting;
      unit.target = unit.moving
        ? { ...path[0] }
        : command.type === "move"
          ? { ...destination! }
          : command.type === "attack"
            ? { ...attackTarget!.position }
            : { ...command.target };
    }
    return finish(units.length > 0);
  }

  step() {
    if (this.result) return;
    this.tick += 1;
    this.resolveDirectImpacts();
    this.resolveGroundImpacts();
    this.stepProduction();
    this.stepBuildingWeapons();
    for (const unit of [...this.units.values()].sort(compareIds)) {
      if (unit.health <= 0) continue;
      if (unit.attackCooldownTicks > 0) unit.attackCooldownTicks -= 1;
      this.updateStationaryGuard(unit);
      if (unit.moving) {
        let remaining = Math.round(unit.speed * SIMULATION_TICK_SECONDS);

        while (remaining > 0 && unit.path.length) {
          const waypoint = unit.path[0];
          const dx = waypoint.x - unit.position.x;
          const dz = waypoint.z - unit.position.z;
          const waypointDistance = Math.hypot(dx, dz);
          if (waypointDistance <= remaining) {
            unit.position = { ...waypoint };
            unit.path.shift();
            remaining -= Math.round(waypointDistance);
            if (unit.path[0]) unit.target = { ...unit.path[0] };
            continue;
          }
          unit.position.x += Math.round(dx / waypointDistance * remaining);
          unit.position.z += Math.round(dz / waypointDistance * remaining);
          remaining = 0;
        }

        if (!unit.path.length) {
          unit.moving = false;
          unit.attacking = unit.order === "attack" || unit.order === "attack-ground";
          const directTarget = unit.attackTargetId && this.directTarget(unit.attackTargetId);
          if (directTarget) unit.target = { ...directTarget.position };
          else if (unit.attackGroundTarget) unit.target = { ...unit.attackGroundTarget };
        }
      }
      this.turnTowardTarget(unit);
      this.stepConstruction(unit);
      this.stepDirectAttack(unit);
      this.stepAttackGround(unit);
    }
    this.resolveUnitCollisions();
    this.updateAttackStalls();
    this.resolveCommandCenterElimination();
  }

  snapshot() {
    return [...this.units.values()].map((unit) => structuredClone(unit));
  }

  buildingSnapshot() {
    return [...this.buildings.values()].map((building) => structuredClone(building));
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  drainAcceptedCommands() {
    const commands = this.acceptedCommands;
    this.acceptedCommands = [];
    return commands;
  }

  stateHash() {
    const state = JSON.stringify({
      tick: this.tick,
      units: [...this.units.values()].sort(compareIds),
      buildings: [...this.buildings.values()].sort(compareIds),
      pendingDirectImpacts: this.pendingDirectImpacts,
      pendingGroundImpacts: this.pendingGroundImpacts,
      buildingSequence: this.buildingSequence,
      productionSequence: this.productionSequence,
      unitSequence: this.unitSequence,
      eliminationPlayerIds: this.eliminationPlayerIds,
      matchResult: this.result,
    });
    let hash = 0x811c9dc5;
    for (let index = 0; index < state.length; index += 1) {
      hash ^= state.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  private stepProduction() {
    for (const commandCenter of [...this.buildings.values()].sort(compareIds)) {
      const queue = commandCenter.productionQueue;
      if (commandCenter.kind !== "command-center" || commandCenter.lifecycle !== "active"
        || commandCenter.health <= 0 || !queue) continue;
      const item = advanceTraining(queue);
      if (!item) continue;
      const unit = this.createTrainedUnit(commandCenter, item.kind);
      if (!unit) continue;
      queue.shift();
    }
  }

  private resolveCommandCenterElimination() {
    const players = this.eliminationPlayerIds;
    if (!players.length || this.result) return;
    const commandCenterOwners = new Set([...this.buildings.values()].flatMap((building) =>
      building.kind === "command-center" && building.health > 0 ? [building.ownerId] : []));
    const survivingPlayerIds = players.filter((playerId) => commandCenterOwners.has(playerId));
    if (survivingPlayerIds.length > 1) return;
    const defeatedPlayerIds = players.filter((playerId) => !commandCenterOwners.has(playerId));
    this.result = {
      ...(survivingPlayerIds[0] ? { winnerId: survivingPlayerIds[0] } : {}),
      defeatedPlayerIds,
      resolvedTick: this.tick,
    };
    for (const unit of this.units.values()) {
      if (unit.health > 0) this.stop(unit);
    }
    for (const building of this.buildings.values()) {
      if (building.weapon) building.weapon.targetId = undefined;
    }
    this.pendingDirectImpacts.length = 0;
    this.pendingGroundImpacts.length = 0;
  }

  private stepBuildingWeapons() {
    for (const building of [...this.buildings.values()].sort(compareIds)) {
      const weapon = building.weapon;
      const weaponDefinition = BUILDING_DEFINITIONS[building.kind]?.weapon;
      if (weapon?.cooldownTicks && weapon.cooldownTicks > 0) {
        weapon.cooldownTicks -= 1;
      }
      if (building.lifecycle !== "active" || building.health <= 0
        || !weapon || !weaponDefinition) {
        if (weapon) weapon.targetId = undefined;
        continue;
      }
      const target = selectHostileUnit(
        this.units,
        building,
        weapon.targetId,
        (unit) => distance(building.position, unit.position) <= weapon.range + unit.radius,
      );
      weapon.targetId = target?.id;
      if (!target) continue;
      const desiredFacing = Math.atan2(
        target.position.x - building.position.x,
        target.position.z - building.position.z,
      );
      const difference = Math.atan2(
        Math.sin(desiredFacing - weapon.facing),
        Math.cos(desiredFacing - weapon.facing),
      );
      const turnRatio = 1 - Math.exp(
        -SIMULATION_TICK_SECONDS * weaponDefinition.turnResponsiveness,
      );
      const remainingTurn = difference * (1 - turnRatio);
      weapon.facing = Math.atan2(
        Math.sin(weapon.facing + difference * turnRatio),
        Math.cos(weapon.facing + difference * turnRatio),
      );
      if (weapon.cooldownTicks || Math.abs(remainingTurn) > ATTACK_FACING_TOLERANCE) continue;
      const impactTick = this.tick + directProjectileImpactDelayTicks(
        distance(building.position, target.position) / POSITION_SCALE,
        SIMULATION_TICK_SECONDS,
      );
      this.events.push({
        type: "weapon-fired",
        tick: this.tick,
        attackerId: building.id,
        attack: "direct",
        targetId: target.id,
        target: { ...target.position },
        impactTick,
      });
      this.pendingDirectImpacts.push({
        impactTick,
        attackerId: building.id,
        targetId: target.id,
        target: "unit",
        damage: weapon.damage,
      });
      weapon.cooldownTicks = weapon.intervalTicks;
    }
  }

  private updateStationaryGuard(guard: UnitState) {
    if (guard.guardMode !== "hold-position" || !guard.attackDamage) return;
    const target = selectHostileUnit(
      this.units,
      guard,
      guard.attackTargetId,
      (unit) => distance(guard.position, unit.position) <= directMaximumRange(guard, unit),
    );
    guard.path = [];
    guard.moving = false;
    guard.formationPosition = undefined;
    guard.attackTargetId = target?.id;
    guard.attacking = Boolean(target);
    guard.order = target ? "attack" : "idle";
    guard.target = target ? { ...target.position } : { ...guard.position };
  }

  private createTrainedUnit(commandCenter: BuildingState, kind: UnitKind) {
    const rallyPoint = commandCenter.rallyPoint;
    const facing = rallyPoint
      ? Math.atan2(rallyPoint.x - commandCenter.position.x, rallyPoint.z - commandCenter.position.z)
      : commandCenter.rotation;
    let sequence = this.unitSequence + 1;
    while (this.units.has(`${commandCenter.ownerId}-${kind}-${sequence}`)) sequence += 1;
    const id = `${commandCenter.ownerId}-${kind}-${sequence}`;
    const unit = createTrainedUnitState({
      id,
      kind,
      ownerId: commandCenter.ownerId,
      position: commandCenter.position,
      facing,
    });
    const exit = this.findProductionExit(commandCenter, unit, rallyPoint, facing);
    if (!exit) return undefined;
    unit.position = exit.position;
    unit.target = exit.path[0] ? { ...exit.path[0] } : { ...exit.position };
    if (exit.path.length) {
      unit.path = exit.path;
      unit.order = "move";
      unit.moving = true;
    }
    this.units.set(id, unit);
    this.unitSequence = sequence;
    return unit;
  }

  private findProductionExit(
    commandCenter: BuildingState,
    unit: UnitState,
    rallyPoint: SimPoint | undefined,
    facing: number,
  ) {
    const spacing = unit.radius * 2 + UNIT_SEPARATION_GAP;
    const blockers: CircularObstacle[] = [
      ...[...this.units.values()].filter((other) => other.health > 0),
      ...[...this.buildings.values()].filter((building) =>
        building.id !== commandCenter.id && building.health > 0),
    ];
    for (let ring = 0; ring < 4; ring += 1) {
      const spawnDistance = commandCenter.radius + unit.radius + UNIT_SEPARATION_GAP
        + ring * spacing;
      for (let index = 0; index < 32; index += 1) {
        const offset = index === 0 ? 0 : Math.ceil(index / 2) * (index % 2 ? 1 : -1);
        const angle = facing + offset * Math.PI * 2 / 32;
        const position = {
          x: Math.round(commandCenter.position.x + Math.sin(angle) * spawnDistance),
          z: Math.round(commandCenter.position.z + Math.cos(angle) * spawnDistance),
        };
        const exitStartDistance = commandCenter.radius + unit.radius + PATH_CLEARANCE;
        const exitStart = {
          x: Math.round(commandCenter.position.x + Math.sin(angle) * exitStartDistance),
          z: Math.round(commandCenter.position.z + Math.cos(angle) * exitStartDistance),
        };
        if (this.terrain) {
          const halfSize = this.terrain.size * POSITION_SCALE / 2;
          if (Math.abs(position.x) + unit.radius > halfSize
            || Math.abs(position.z) + unit.radius > halfSize) continue;
        }
        if (!segmentIsClear(exitStart, position, blockers, unit.radius)) continue;
        unit.position = position;
        this.setNavigationObstacles(this.pathingBuildings());
        if (!this.groundNavigation.plan(exitStart, position, unit.radius)) continue;
        if (!this.groundNavigation.plan(position, position, unit.radius)) continue;
        const path = rallyPoint ? this.createPathPlanner(unit).plan(position, rallyPoint) : [];
        if (!path) continue;
        return { position, path };
      }
    }
    return undefined;
  }

  private pathingBuildings() {
    return [...this.buildings.values()]
      .filter((building) => building.health !== 0)
      .sort(compareIds);
  }

  private pathingObstacles(
    excludedIds: ReadonlySet<string>,
    buildings = this.pathingBuildings(),
  ) {
    return [
      ...buildings,
      ...[...this.units.values()]
        .filter((unit) => unit.health > 0 && !unit.pushable && !excludedIds.has(unit.id))
        .sort(compareIds),
    ];
  }

  private directTarget(id: string) {
    return this.units.get(id) ?? this.buildings.get(id);
  }

  private rangedAttackFormation(unit: UnitState, target: DirectAttackTarget) {
    if (!unit.attackRange || isUnitTarget(target)) return undefined;
    return rangedFormationFor(
      [...this.units.values()].filter((other) => other.health > 0
        && other.ownerId === unit.ownerId && other.attackRange
        && other.order === "attack" && other.attackTargetId === target.id),
      target.position,
    );
  }

  private planAttackPath(
    unit: UnitState,
    target: DirectAttackTarget,
    planner: PathPlanner,
    formUp = false,
    rangedFormation?: RangedFormation,
  ) {
    const maximumRange = directMaximumRange(unit, target);
    const approachRadius = directApproachRadius(unit, target);
    const targetDistance = distance(unit.position, target.position);
    const assignedPosition = unit.formationPosition;
    if (!isUnitTarget(target) && assignedPosition
      && distance(assignedPosition, target.position) <= maximumRange + PATH_CLEARANCE) {
      if (targetDistance <= maximumRange) return [];
      const assignedPath = planner.plan(unit.position, assignedPosition);
      if (assignedPath) return assignedPath;
    }
    const reservations = isUnitTarget(target)
      ? []
      : [...this.units.values()].flatMap((other) => {
          if (other.id === unit.id || other.health <= 0 || other.order !== "attack"
            || other.attackTargetId !== target.id) return [];
          const position = reservedPosition(other);
          if (distance(position, target.position)
            > directMaximumRange(other, target) + PATH_CLEARANCE) return [];
          return [{
            position,
            radius: other.radius,
          }];
        });
    if ((!formUp || unit.attackRange) && targetDistance <= maximumRange
      && attackSpotIsFree(unit, unit.position, reservations)) return [];
    if (unit.attackRange && rangedFormation && !isUnitTarget(target)) {
      const path = planAttackRanks(
        unit,
        target.position,
        approachRadius,
        reservations,
        planner,
        rangedFormation,
      );
      if (path !== undefined) return path;
    }
    if (!unit.attackRange && reservations.length >= ringSlotCount(
      approachRadius,
      unit.radius * 2 + ATTACK_SEPARATION_GAP,
    )) return undefined;
    return planAttackRing(unit, target.position, approachRadius, reservations, planner);
  }

  private planAttackGroundPath(
    unit: UnitState,
    target: SimPoint,
    planner: PathPlanner,
    formUp = false,
  ) {
    const minRange = unit.attackMinRange ?? 0;
    const maxRange = unit.attackRange ?? 0;
    const targetDistance = distance(unit.position, target);
    const approachRange = groundApproachRadius(unit, targetDistance);
    const assignedPosition = unit.formationPosition;
    if (assignedPosition) {
      const assignedDistance = distance(assignedPosition, target);
      if (assignedDistance >= minRange - PATH_CLEARANCE
        && assignedDistance <= maxRange + PATH_CLEARANCE) {
        if (targetDistance >= minRange && targetDistance <= maxRange) return [];
        const assignedPath = planner.plan(unit.position, assignedPosition);
        if (assignedPath) return assignedPath;
      }
    }
    const reservations = [...this.units.values()].flatMap((other) => {
      const otherTarget = other.attackGroundTarget;
      if (other.id === unit.id || other.health <= 0 || other.order !== "attack-ground"
        || !otherTarget || otherTarget.x !== target.x || otherTarget.z !== target.z) return [];
      const position = reservedPosition(other);
      const reservedDistance = distance(position, target);
      if (reservedDistance < (other.attackMinRange ?? 0) - PATH_CLEARANCE
        || reservedDistance > (other.attackRange ?? 0) + PATH_CLEARANCE) return [];
      return [{
        position,
        radius: other.radius,
      }];
    });
    if ((!formUp || unit.attackRange) && targetDistance >= minRange && targetDistance <= maxRange
      && attackSpotIsFree(unit, unit.position, reservations)) {
      return [];
    }
    return planAttackRing(unit, target, approachRange, reservations, planner);
  }

  private planDirectWaitingPath(
    unit: UnitState,
    target: DirectAttackTarget,
    planner: PathPlanner,
  ) {
    if (isUnitTarget(target)) return undefined;
    const reservations = [...this.units.values()].flatMap((other) => {
      if (other.id === unit.id || other.health <= 0 || other.order !== "attack"
        || other.attackTargetId !== target.id) return [];
      return [{ position: reservedPosition(other), radius: other.radius }];
    });
    return planWaitingRings(
      unit,
      target.position,
      directApproachRadius(unit, target),
      reservations,
      planner,
    );
  }

  private planGroundWaitingPath(unit: UnitState, target: SimPoint, planner: PathPlanner) {
    const reservations = [...this.units.values()].flatMap((other) => {
      const otherTarget = other.attackGroundTarget;
      if (other.id === unit.id || other.health <= 0 || other.order !== "attack-ground"
        || !otherTarget || otherTarget.x !== target.x || otherTarget.z !== target.z) return [];
      return [{ position: reservedPosition(other), radius: other.radius }];
    });
    return planWaitingRings(
      unit,
      target,
      groundApproachRadius(unit, distance(unit.position, target)),
      reservations,
      planner,
    );
  }

  private stepDirectAttack(attacker: UnitState) {
    if (attacker.order !== "attack") return;
    const target = attacker.attackTargetId && this.directTarget(attacker.attackTargetId);
    if (!target || target.health === 0 || target.ownerId === attacker.ownerId) {
      this.stop(attacker);
      return;
    }
    const waitingUntil = this.attackWaitingUntil.get(attacker.id);
    if (waitingUntil && this.tick < waitingUntil) {
      if (!attacker.moving) {
        attacker.attacking = false;
        attacker.target = { ...target.position };
        return;
      }
    } else if (waitingUntil) {
      this.attackWaitingUntil.delete(attacker.id);
    }
    const range = directMaximumRange(attacker, target);
    const assignedSlotIsInRange = attacker.formationPosition
      && distance(attacker.formationPosition, target.position) <= range;
    const arrivalRange = range + (!attacker.attackRange && assignedSlotIsInRange
      ? UNIT_SEPARATION_GAP + POSITION_ROUNDING_TOLERANCE
      : 0);
    if (attacker.moving) {
      if (isUnitTarget(target) && distance(attacker.position, target.position) <= arrivalRange) {
        attacker.path = [];
        attacker.moving = false;
        attacker.attacking = true;
        attacker.target = { ...target.position };
      } else {
        if (this.tick % ATTACK_RETRY_TICKS === retrySlot(attacker.id)
          && attacker.formationPosition) {
          const blockers = [...this.units.values()].filter((unit) => unit.id !== attacker.id
            && unit.health > 0 && unit.pushable && !unit.moving
            && !routeIsClear(attacker.position, attacker.path, [unit], attacker.radius));
          if (blockers.length) {
            const path = this.createPathPlanner(attacker, blockers)
              .plan(attacker.position, attacker.formationPosition);
            if (path?.length) {
              attacker.path = path;
              attacker.target = { ...path[0]! };
            }
          }
        }
        return;
      }
    }
    if (!attacker.attacking) {
      if (this.tick % ATTACK_RETRY_TICKS !== retrySlot(attacker.id)) return;
      const planner = this.createPathPlanner(attacker);
      const path = this.planAttackPath(
        attacker,
        target,
        planner,
        false,
        this.rangedAttackFormation(attacker, target),
      );
      if (!path) return;
      if (path.length) {
        attacker.path = path;
        attacker.formationPosition = { ...path.at(-1)! };
        attacker.target = { ...path[0]! };
        attacker.moving = true;
        return;
      }
      attacker.attacking = true;
      attacker.target = { ...target.position };
    }
    if (distance(attacker.position, target.position) > arrivalRange) {
      const planner = this.createPathPlanner(attacker);
      const path = this.planAttackPath(
        attacker,
        target,
        planner,
        false,
        this.rangedAttackFormation(attacker, target),
      );
      if (!path) {
        attacker.path = [];
        attacker.moving = false;
        attacker.attacking = false;
        attacker.target = { ...target.position };
        return;
      }
      if (!path.length) return;
      attacker.path = path;
      attacker.formationPosition = { ...path.at(-1)! };
      attacker.target = { ...path[0]! };
      attacker.moving = true;
      attacker.attacking = false;
      return;
    }
    if (attacker.attackCooldownTicks > 0 || !this.isFacingTarget(attacker)) return;
    if (!attacker.attackDamage) return;
    const projectile = Boolean(attacker.attackRange);
    const impactTick = projectile
      ? this.tick + directProjectileImpactDelayTicks(
          distance(attacker.position, target.position) / POSITION_SCALE,
          SIMULATION_TICK_SECONDS,
        )
      : this.tick;
    this.events.push({
      type: "weapon-fired",
      tick: this.tick,
      attackerId: attacker.id,
      attack: "direct",
      targetId: target.id,
      target: { ...target.position },
      impactTick,
    });
    if (projectile) {
      this.pendingDirectImpacts.push({
        impactTick,
        attackerId: attacker.id,
        targetId: target.id,
        target: isUnitTarget(target) ? "unit" : "building",
        damage: attacker.attackDamage,
      });
    } else if (isUnitTarget(target)) this.damageUnit(attacker, target, attacker.attackDamage);
    else this.damageBuilding(attacker, target, attacker.attackDamage);
    attacker.attackCooldownTicks = attacker.attackIntervalTicks ?? 10;
  }

  private resolveDirectImpacts() {
    for (let index = 0; index < this.pendingDirectImpacts.length;) {
      const impact = this.pendingDirectImpacts[index]!;
      if (impact.impactTick > this.tick) {
        index += 1;
        continue;
      }
      this.pendingDirectImpacts.splice(index, 1);
      const attacker = { id: impact.attackerId };
      if (impact.target === "unit") {
        const target = this.units.get(impact.targetId);
        if (target?.health) this.damageUnit(attacker, target, impact.damage);
      } else {
        const target = this.buildings.get(impact.targetId);
        if (target?.health) this.damageBuilding(attacker, target, impact.damage);
      }
    }
  }

  private stepAttackGround(attacker: UnitState) {
    if (attacker.order !== "attack-ground" || attacker.moving) return;
    const target = attacker.attackGroundTarget;
    if (!target || !attacker.attackGroundRadius || !attacker.attackDamage) return;
    if (!attacker.attacking) {
      if (this.tick % ATTACK_RETRY_TICKS !== retrySlot(attacker.id)) return;
      const planner = this.createPathPlanner(attacker);
      const path = this.planAttackGroundPath(attacker, target, planner);
      if (!path) return;
      if (path.length) {
        attacker.path = path;
        attacker.formationPosition = { ...path.at(-1)! };
        attacker.target = { ...path[0]! };
        attacker.moving = true;
        return;
      }
      attacker.attacking = true;
      attacker.target = { ...target };
    }
    if (attacker.attackCooldownTicks > 0 || !this.isFacingTarget(attacker)) return;
    const targetDistance = distance(attacker.position, target);
    if (targetDistance < (attacker.attackMinRange ?? 0)
      || targetDistance > (attacker.attackRange ?? Infinity)) {
      attacker.attacking = false;
      return;
    }
    this.events.push({
      type: "weapon-fired",
      tick: this.tick,
      attackerId: attacker.id,
      attack: "ground",
      target: { ...target },
    });
    const seed = behemothVolleySeed(attacker.id, this.tick);
    const flightDistance = targetDistance / POSITION_SCALE;
    this.pendingGroundImpacts.push({
      impactTick: this.tick + behemothImpactDelayTicks(
        flightDistance,
        seed,
        SIMULATION_TICK_SECONDS,
      ),
      attackerId: attacker.id,
      target: { ...target },
      radius: attacker.attackGroundRadius,
      damage: attacker.attackDamage,
    });
    attacker.attackCooldownTicks = attacker.attackIntervalTicks ?? 30;
  }

  private resolveGroundImpacts() {
    for (let index = 0; index < this.pendingGroundImpacts.length;) {
      const impact = this.pendingGroundImpacts[index]!;
      if (impact.impactTick > this.tick) {
        index += 1;
        continue;
      }
      this.pendingGroundImpacts.splice(index, 1);
      const attacker = this.units.get(impact.attackerId);
      if (!attacker) continue;
      for (const unit of [...this.units.values()].sort(compareIds)) {
        if (unit.health <= 0 || distance(unit.position, impact.target) > impact.radius) continue;
        this.damageUnit(attacker, unit, impact.damage);
      }
      for (const building of [...this.buildings.values()].sort(compareIds)) {
        if (building.health === 0) continue;
        const footprintRadius = building.attackRadius ?? building.radius;
        if (distance(building.position, impact.target) > impact.radius + footprintRadius) continue;
        this.damageBuilding(attacker, building, impact.damage);
      }
    }
  }

  private turnTowardTarget(unit: UnitState) {
    if (!unit.moving && !unit.attacking) return;
    const desired = Math.atan2(
      unit.target.x - unit.position.x,
      unit.target.z - unit.position.z,
    );
    if (unit.facing === undefined) {
      unit.facing = desired;
      return;
    }
    const difference = Math.atan2(
      Math.sin(desired - unit.facing),
      Math.cos(desired - unit.facing),
    );
    unit.facing += difference * (
      1 - Math.exp(-SIMULATION_TICK_SECONDS * TURN_RESPONSIVENESS[unit.kind])
    );
  }

  private isFacingTarget(unit: UnitState) {
    if (unit.facing === undefined) return true;
    const desired = Math.atan2(
      unit.target.x - unit.position.x,
      unit.target.z - unit.position.z,
    );
    const difference = Math.atan2(
      Math.sin(desired - unit.facing),
      Math.cos(desired - unit.facing),
    );
    return Math.abs(difference) <= ATTACK_FACING_TOLERANCE;
  }

  private damageUnit(attacker: CombatAttacker, target: UnitState, amount: number) {
    const health = Math.max(0, target.health - amount);
    const damage = target.health - health;
    target.health = health;
    this.events.push({
      type: "damage",
      tick: this.tick,
      attackerId: attacker.id,
      targetId: target.id,
      target: "unit",
      amount: damage,
      health,
    });
    if (health > 0) return;
    this.stop(target);
    this.events.push({ type: "unit-died", tick: this.tick, id: target.id, attackerId: attacker.id });
  }

  private damageBuilding(attacker: CombatAttacker, target: BuildingState, amount: number) {
    const health = Math.max(0, target.health - amount);
    const damage = target.health - health;
    target.health = health;
    this.events.push({
      type: "damage",
      tick: this.tick,
      attackerId: attacker.id,
      targetId: target.id,
      target: "building",
      amount: damage,
      health,
    });
    if (health > 0) return;
    const builder = target.builderId && this.units.get(target.builderId);
    if (builder) this.stop(builder);
    this.events.push({
      type: "building-died",
      tick: this.tick,
      id: target.id,
      attackerId: attacker.id,
    });
    this.buildings.delete(target.id);
    this.setNavigationObstacles(this.pathingBuildings());
  }

  private stop(unit: UnitState) {
    this.releaseConstruction(unit);
    this.attackStalls.delete(unit.id);
    this.attackWaitingUntil.delete(unit.id);
    unit.path = [];
    unit.order = "idle";
    unit.attackTargetId = undefined;
    unit.attackGroundTarget = undefined;
    unit.constructionTargetId = undefined;
    unit.formationPosition = undefined;
    unit.moving = false;
    unit.attacking = false;
    unit.target = { ...unit.position };
  }

  private releaseConstruction(unit: UnitState) {
    const site = unit.constructionTargetId
      ? this.buildings.get(unit.constructionTargetId)
      : undefined;
    if (site?.builderId === unit.id) site.builderId = undefined;
    unit.constructionTargetId = undefined;
  }

  private stepConstruction(builder: UnitState) {
    if (builder.order !== "build") return;
    const site = builder.constructionTargetId
      ? this.buildings.get(builder.constructionTargetId)
      : undefined;
    if (!site || site.lifecycle !== "constructing" || site.builderId !== builder.id
      || site.ownerId !== builder.ownerId) {
      this.stop(builder);
      return;
    }
    if (builder.moving) return;
    const workRange = site.radius + builder.radius + MELEE_REACH + POSITION_ROUNDING_TOLERANCE;
    if (distance(builder.position, site.position) > workRange) {
      const path = this.planConstructionPath(builder, site);
      if (!path?.length) {
        this.stop(builder);
        return;
      }
      builder.path = path;
      builder.target = { ...path[0]! };
      builder.moving = true;
      builder.formationPosition = { ...path.at(-1)! };
      return;
    }

    const totalTicks = constructionTicks(site.kind);
    const completedTicks = Math.round(site.constructionProgress * totalTicks);
    const nextTicks = Math.min(totalTicks, completedTicks + 1);
    const healthBuiltDuringConstruction = site.maxHealth - 1;
    const previousBuiltHealth = Math.floor(
      completedTicks / totalTicks * healthBuiltDuringConstruction,
    );
    const nextBuiltHealth = Math.floor(nextTicks / totalTicks * healthBuiltDuringConstruction);
    site.constructionProgress = nextTicks / totalTicks;
    site.health = Math.min(site.maxHealth, site.health + nextBuiltHealth - previousBuiltHealth);
    if (nextTicks < totalTicks) return;
    site.lifecycle = "active";
    site.constructionProgress = 1;
    site.builderId = undefined;
    this.stop(builder);
  }

  private createPathPlanner(unit: UnitState, extraObstacles: readonly CircularObstacle[] = []) {
    const buildings = this.pathingBuildings();
    this.setNavigationObstacles(buildings);
    return new PathPlanner(
      [...this.pathingObstacles(new Set([unit.id]), buildings), ...extraObstacles],
      unit.radius,
      this.groundNavigation,
    );
  }

  private setNavigationObstacles(buildings: readonly BuildingState[]) {
    this.groundNavigation.setObstacles(buildings);
  }

  private updateAttackStalls() {
    for (const unit of this.units.values()) {
      const waypoint = unit.path[0];
      if (!unit.moving || unit.order !== "attack" || !waypoint) {
        this.attackStalls.delete(unit.id);
        continue;
      }
      const remaining = distance(unit.position, waypoint);
      const previous = this.attackStalls.get(unit.id);
      const minimumProgress = Math.max(
        POSITION_ROUNDING_TOLERANCE,
        Math.round(unit.speed * SIMULATION_TICK_SECONDS / 10),
      );
      if (!previous || previous.waypoint.x !== waypoint.x || previous.waypoint.z !== waypoint.z
        || remaining <= previous.bestDistance - minimumProgress) {
        this.attackStalls.set(unit.id, {
          waypoint: { ...waypoint },
          bestDistance: remaining,
          stagnantTicks: 0,
        });
        continue;
      }
      const stagnantTicks = previous.stagnantTicks + 1;
      if (stagnantTicks < ATTACK_STALL_TICKS) {
        previous.stagnantTicks = stagnantTicks;
        continue;
      }
      this.attackStalls.delete(unit.id);
      const target = unit.attackTargetId && this.directTarget(unit.attackTargetId);
      if (!target || isUnitTarget(target)) continue;
      if (this.attackWaitingUntil.has(unit.id)) {
        unit.path = [];
        unit.formationPosition = { ...unit.position };
        unit.target = { ...target.position };
        unit.moving = false;
        unit.attacking = false;
        this.attackWaitingUntil.set(unit.id, this.tick + ATTACK_WAIT_TICKS);
        continue;
      }
      const path = this.planDirectWaitingPath(unit, target, this.createPathPlanner(unit));
      unit.path = path ?? [];
      unit.formationPosition = { ...(path?.at(-1) ?? unit.position) };
      unit.target = path?.[0] ? { ...path[0] } : { ...target.position };
      unit.moving = Boolean(path?.length);
      unit.attacking = false;
      const travelTicks = path?.length
        ? Math.ceil(pathLength(unit.position, path) / (unit.speed * SIMULATION_TICK_SECONDS))
        : 0;
      this.attackWaitingUntil.set(unit.id, this.tick + travelTicks + ATTACK_WAIT_TICKS);
    }
  }

  private resolveUnitCollisions() {
    const units = [...this.units.values()].filter((unit) => unit.health > 0).sort(compareIds);
    const buildings = [...this.buildings.values()].sort(compareIds);
    const cellSize = Math.max(...units.map((unit) => unit.radius)) * 2
      + UNIT_SEPARATION_GAP;
    if (!Number.isFinite(cellSize) || cellSize <= 0) return;

    for (let pass = 0; pass < COLLISION_PASSES; pass += 1) {
      const grid = new Map<string, UnitState[]>();
      for (const unit of units) {
        const cellX = Math.floor(unit.position.x / cellSize);
        const cellZ = Math.floor(unit.position.z / cellSize);
        for (let x = cellX - 1; x <= cellX + 1; x += 1) {
          for (let z = cellZ - 1; z <= cellZ + 1; z += 1) {
            for (const other of grid.get(`${x}:${z}`) ?? []) {
              this.separate(unit, other, buildings);
            }
          }
        }
        const key = `${cellX}:${cellZ}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(unit);
        else grid.set(key, [unit]);
      }
    }
  }

  private collisionPriority(unit: UnitState) {
    if (unit.attacking) return 2;
    const slot = unit.formationPosition;
    if (!slot) return 0;
    if (unit.order === "attack") {
      const target = unit.attackTargetId && this.directTarget(unit.attackTargetId);
      return target && distance(slot, target.position) <= directMaximumRange(unit, target) ? 1 : 0;
    }
    if (unit.order === "attack-ground" && unit.attackGroundTarget) {
      const range = distance(slot, unit.attackGroundTarget);
      return range >= (unit.attackMinRange ?? 0) && range <= (unit.attackRange ?? 0) ? 1 : 0;
    }
    return 0;
  }

  private separate(
    first: UnitState,
    second: UnitState,
    buildings: readonly BuildingState[],
  ) {
    let dx = second.position.x - first.position.x;
    let dz = second.position.z - first.position.z;
    const sameDirectTarget = first.order === "attack" && second.order === "attack"
      && first.attackTargetId === second.attackTargetId;
    const firstGroundTarget = first.attackGroundTarget;
    const secondGroundTarget = second.attackGroundTarget;
    const sameGroundTarget = first.order === "attack-ground" && second.order === "attack-ground"
      && firstGroundTarget && secondGroundTarget
      && firstGroundTarget.x === secondGroundTarget.x
      && firstGroundTarget.z === secondGroundTarget.z;
    const minimum = first.radius + second.radius
      + (sameDirectTarget || sameGroundTarget ? ATTACK_SEPARATION_GAP : UNIT_SEPARATION_GAP);
    let separation = Math.hypot(dx, dz);
    if (separation >= minimum) return;
    if (separation === 0) {
      dx = first.id < second.id ? 1 : -1;
      dz = 0;
      separation = 1;
    }

    const overlap = Math.ceil(minimum - separation);
    const equallyHeavy = !first.pushable && !second.pushable;
    let firstCanMove = first.pushable || equallyHeavy;
    let secondCanMove = second.pushable || equallyHeavy;
    const firstPriority = this.collisionPriority(first);
    const secondPriority = this.collisionPriority(second);
    if (firstCanMove && secondCanMove && firstPriority !== secondPriority) {
      if (firstPriority > secondPriority) firstCanMove = false;
      else secondCanMove = false;
    }
    const firstPush = firstCanMove ? (secondCanMove ? Math.ceil(overlap / 2) : overlap) : 0;
    const secondPush = secondCanMove ? overlap - firstPush : 0;
    const directionX = dx / separation;
    const directionZ = dz / separation;
    const firstPosition = {
      x: first.position.x - Math.round(directionX * firstPush),
      z: first.position.z - Math.round(directionZ * firstPush),
    };
    const secondPosition = {
      x: second.position.x + Math.round(directionX * secondPush),
      z: second.position.z + Math.round(directionZ * secondPush),
    };
    if (firstPush && positionIsClear(firstPosition, buildings, first.radius)) {
      first.position = firstPosition;
    }
    if (secondPush && positionIsClear(secondPosition, buildings, second.radius)) {
      second.position = secondPosition;
    }
  }
}
