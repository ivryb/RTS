import { UNIT_DEFINITIONS, type UnitKind } from "./unitDefinitions";
import { SIMULATION_TICK_SECONDS } from "./simulationConstants";
import { POSITION_SCALE } from "./simulationConstants";
import type { BuildingState, SimPoint, UnitState } from "./units";

export const MAX_PRODUCTION_QUEUE = 5;
export const MAX_SCOUT_DRONES = 3;

export interface TrainingQueueItem {
  id: string;
  kind: UnitKind;
  progressTicks: number;
  totalTicks: number;
}

export const TRAINING_SECONDS: Record<UnitKind, number> = {
  "scout-drone": 8,
  ghostrunner: 12,
  hornet: 20,
  behemoth: 35,
};

export const trainingTicks = (kind: UnitKind) =>
  Math.round(TRAINING_SECONDS[kind] / SIMULATION_TICK_SECONDS);

type ProductionUnit = Pick<UnitState, "kind" | "ownerId" | "health">;
type ProductionBuilding = Pick<BuildingState, "ownerId" | "productionQueue">;

export const scoutDroneCommitment = (
  ownerId: string,
  units: Iterable<ProductionUnit>,
  buildings: Iterable<ProductionBuilding>,
) => {
  let commitment = 0;
  for (const unit of units) {
    if (unit.ownerId === ownerId && unit.kind === "scout-drone" && unit.health > 0) commitment += 1;
  }
  for (const building of buildings) {
    if (building.ownerId !== ownerId) continue;
    commitment += building.productionQueue?.filter((item) => item.kind === "scout-drone").length ?? 0;
  }
  return commitment;
};

export const canQueueTraining = (
  ownerId: string,
  kind: UnitKind,
  queue: readonly TrainingQueueItem[],
  units: Iterable<ProductionUnit>,
  buildings: Iterable<ProductionBuilding>,
) => queue.length < MAX_PRODUCTION_QUEUE
  && (kind !== "scout-drone"
    || scoutDroneCommitment(ownerId, units, buildings) < MAX_SCOUT_DRONES);

export const enqueueTraining = (
  queue: TrainingQueueItem[],
  id: string,
  kind: UnitKind,
) => queue.push({ id, kind, progressTicks: 0, totalTicks: trainingTicks(kind) });

export const cancelTraining = (queue: TrainingQueueItem[], itemId: string) => {
  const index = queue.findIndex((item) => item.id === itemId);
  if (index < 0) return false;
  queue.splice(index, 1);
  return true;
};

/** Advances only the active slot and returns it once its build time is complete. */
export const advanceTraining = (queue: TrainingQueueItem[]) => {
  const item = queue[0];
  if (!item) return undefined;
  item.progressTicks = Math.min(item.totalTicks, item.progressTicks + 1);
  return item.progressTicks === item.totalTicks ? item : undefined;
};

export const createTrainedUnitState = ({
  id,
  kind,
  ownerId,
  position,
  facing,
}: {
  id: string;
  kind: UnitKind;
  ownerId: string;
  position: SimPoint;
  facing: number;
}): UnitState => {
  const definition = UNIT_DEFINITIONS[kind];
  return {
    id,
    kind,
    ownerId,
    health: definition.maxHealth,
    maxHealth: definition.maxHealth,
    pushable: kind !== "behemoth",
    radius: Math.round(definition.radius * POSITION_SCALE),
    speed: Math.round(definition.speed * POSITION_SCALE),
    facing,
    attackMinRange: definition.attackMinRange
      ? Math.round(definition.attackMinRange * POSITION_SCALE)
      : undefined,
    attackRange: definition.attackRange
      ? Math.round(definition.attackRange * POSITION_SCALE)
      : undefined,
    attackGroundRadius: definition.attackGroundRadius
      ? Math.round(definition.attackGroundRadius * POSITION_SCALE)
      : undefined,
    attackDamage: definition.attackDamage,
    attackIntervalTicks: definition.attackInterval
      ? Math.round(definition.attackInterval / SIMULATION_TICK_SECONDS)
      : undefined,
    attackCooldownTicks: 0,
    position: { ...position },
    target: { ...position },
    path: [],
    order: "idle",
    moving: false,
    attacking: false,
  };
};

export const defaultRallyPoint = (
  position: { x: number; z: number },
  radius: number,
  rotation: number,
  mapSize?: number,
) => {
  const centerDistance = Math.hypot(position.x, position.z);
  const directionX = centerDistance > 0 ? -position.x / centerDistance : Math.sin(rotation);
  const directionZ = centerDistance > 0 ? -position.z / centerDistance : Math.cos(rotation);
  const distance = radius + 4 * POSITION_SCALE;
  const target = {
    x: Math.round(position.x + directionX * distance),
    z: Math.round(position.z + directionZ * distance),
  };
  if (mapSize !== undefined) {
    const halfSize = mapSize * POSITION_SCALE / 2;
    target.x = Math.max(-halfSize, Math.min(halfSize, target.x));
    target.z = Math.max(-halfSize, Math.min(halfSize, target.z));
  }
  return target;
};
