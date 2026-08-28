import { SchemaReplication } from "./schemaReplication";
import { initializeNavigation } from "../../src/sim/navigation";
import {
  LocalUnitSimulation,
  POSITION_SCALE,
  toSimPoint,
  type BuildingState,
  type UnitState,
} from "../../src/sim/units";

const PLAYERS = ["player-1", "player-2", "player-3", "player-4"] as const;
const TICKS = 100;

const percentile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
};
const round = (value: number) => Number(value.toFixed(3));
const measure = <T>(callback: () => T) => {
  const started = performance.now();
  const value = callback();
  return { value, ms: performance.now() - started };
};

const unitAt = (
  id: string,
  ownerId: string,
  index: number,
  x: number,
  z: number,
): UnitState => {
  const kind = index < 80 ? "ghostrunner" : index < 85 ? "scout-drone"
    : index < 90 ? "behemoth" : "hornet";
  const stats = kind === "ghostrunner" ? { radius: 450, speed: 9_000, health: 140 }
    : kind === "scout-drone" ? { radius: 306, speed: 10_000, health: 90 }
      : kind === "behemoth" ? { radius: 1_524, speed: 5_000, health: 1_100 }
        : { radius: 1_309, speed: 8_500, health: 430 };
  const position = toSimPoint(x, z);
  const result = {
    id,
    kind,
    ownerId,
    health: stats.health,
    maxHealth: stats.health,
    pushable: kind !== "behemoth",
    radius: stats.radius,
    speed: stats.speed,
    attackCooldownTicks: 0,
    position,
    target: { ...position },
    path: [],
    order: "idle",
    moving: false,
    attacking: false,
  };
};

const centers = [
  { x: -55, z: -55 },
  { x: 55, z: -55 },
  { x: 55, z: 55 },
  { x: -55, z: 55 },
] as const;
const destinations = [centers[2], centers[3], centers[0], centers[1]] as const;
const units = PLAYERS.flatMap((playerId, playerIndex) => Array.from(
  { length: 100 },
  (_, index) => unitAt(
    `${playerId}-unit-${index}`,
    playerId,
    index,
    centers[playerIndex]!.x + (index % 10 - 4.5) * 3.4,
    centers[playerIndex]!.z + (Math.floor(index / 10) - 4.5) * 3.4,
  ),
));
const buildings: BuildingState[] = Array.from({ length: 40 }, (_, index) => ({
  id: `building-${index}`,
  ownerId: PLAYERS[index % PLAYERS.length],
  position: toSimPoint(-27 + index % 10 * 6, -9 + Math.floor(index / 10) * 6),
  radius: 1_500,
  health: 2_500,
  maxHealth: 2_500,
}));

const orders = PLAYERS.map((playerId, index) => ({
  playerId,
  unitIds: units.filter((unit) => unit.ownerId === playerId).map((unit) => unit.id),
  target: toSimPoint(destinations[index]!.x, destinations[index]!.z),
}));

const visibleFor = (playerId: string, snapshot: readonly UnitState[]) => {
  const friendly = snapshot.filter((unit) => unit.ownerId === playerId);
  const unitIds = new Set(friendly.map((unit) => unit.id));
  const vision = 28 * POSITION_SCALE;
  for (const unit of snapshot) {
    if (unit.ownerId === playerId) continue;
    if (friendly.some((ally) => Math.hypot(
      ally.position.x - unit.position.x,
      ally.position.z - unit.position.z,
    ) <= vision)) unitIds.add(unit.id);
  }
  return { unitIds, buildingIds: new Set(buildings.map((building) => building.id)) };
};

const summarizeSteps = (steps: readonly number[]) => ({
  meanMs: round(steps.reduce((sum, value) => sum + value, 0) / steps.length),
  p95Ms: round(percentile(steps, 0.95)),
  maxMs: round(Math.max(...steps)),
});

const runHybridPathingAndSchema = () => {
  const setup = measure(() => new LocalUnitSimulation(units, buildings));
  const command = measure(() => {
    for (const order of orders) setup.value.dispatch(order.playerId, {
      type: "move",
      unitIds: order.unitIds,
      target: order.target,
    });
  });
  const replication = new SchemaReplication(PLAYERS);
  let snapshot = setup.value.snapshot();
  replication.sync(0, snapshot, buildings);
  for (const playerId of PLAYERS) replication.setVisibility(playerId, visibleFor(playerId, snapshot));
  const initial = replication.encodeInitial();
  const steps: number[] = [];
  const snapshotTimes: number[] = [];
  const syncTimes: number[] = [];
  const visibilityTimes: number[] = [];
  const encodeTimes: number[] = [];
  const combinedTimes: number[] = [];
  const deltaBytes: number[] = [];
  const jsonBytes: number[] = [];
  for (let tick = 1; tick <= TICKS; tick += 1) {
    const combinedStarted = performance.now();
    const step = measure(() => setup.value.step());
    const nextSnapshot = measure(() => setup.value.snapshot());
    snapshot = nextSnapshot.value;
    const synced = measure(() => replication.sync(tick, snapshot, buildings));
    const visibility = measure(() => {
      for (const playerId of PLAYERS) {
        replication.setVisibility(playerId, visibleFor(playerId, snapshot));
      }
    });
    const encoded = measure(() => replication.encodeDelta());
    steps.push(step.ms);
    snapshotTimes.push(nextSnapshot.ms);
    syncTimes.push(synced.ms);
    visibilityTimes.push(visibility.ms);
    encodeTimes.push(encoded.ms);
    combinedTimes.push(performance.now() - combinedStarted);
    deltaBytes.push([...encoded.value.values()].reduce((sum, frame) => sum + frame.byteLength, 0));
    jsonBytes.push(PLAYERS.reduce((sum, playerId) => {
      const visible = visibleFor(playerId, snapshot).unitIds;
      return sum + new TextEncoder().encode(JSON.stringify({
        tick,
        units: snapshot.filter((unit) => visible.has(unit.id)),
        buildings,
      })).byteLength;
    }, 0));
  }
  return {
    navigation: { setupMs: round(setup.ms), commandMs: round(command.ms), ...summarizeSteps(steps) },
    schema: {
      initialBytesFourViews: [...initial.values()].reduce((sum, frame) => sum + frame.byteLength, 0),
      meanDeltaBytesFourViews: Math.round(deltaBytes.reduce((sum, value) => sum + value, 0) / TICKS),
      meanJsonBytesFourViews: Math.round(jsonBytes.reduce((sum, value) => sum + value, 0) / TICKS),
      snapshotClone: summarizeSteps(snapshotTimes),
      mirrorSync: summarizeSteps(syncTimes),
      visibility: summarizeSteps(visibilityTimes),
      encode: summarizeSteps(encodeTimes),
    },
    combined: summarizeSteps(combinedTimes),
    movingAfter10Seconds: snapshot.filter((unit) => unit.moving).length,
  };
  setup.value.dispose();
  return result;
};

await initializeNavigation();
console.log("Dune77 four-player stress test: 400 mixed units, 40 buildings, 10 Hz");
const result = runHybridPathingAndSchema();
console.log("hybrid Recast pathing", result.navigation);
console.log("hybrid Recast pathing + schema", result.combined);
console.log("schema", result.schema);
console.log("units still crossing the map after 10 seconds", result.movingAfter10Seconds);
