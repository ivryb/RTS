import { SchemaReplication } from "./schemaReplication";
import { cloudflareNavigationModule } from "./cloudflareNavigation";
import { initializeNavigation } from "../../src/sim/navigation";
import recastWasm from "../../node_modules/@recast-navigation/wasm/dist/recast-navigation.wasm.wasm";
import {
  LocalUnitSimulation,
  toSimPoint,
  type BuildingState,
  type UnitState,
} from "../../src/sim/units";

const players = ["player-1", "player-2", "player-3", "player-4"];
const unitAt = (index: number): UnitState => {
  const player = players[Math.floor(index / 100)]!;
  const local = index % 100;
  const kind = local < 80 ? "ghostrunner" : local < 85 ? "scout-drone"
    : local < 90 ? "behemoth" : "hornet";
  const stats = kind === "ghostrunner" ? { radius: 450, speed: 9_000, health: 140 }
    : kind === "scout-drone" ? { radius: 306, speed: 10_000, health: 90 }
      : kind === "behemoth" ? { radius: 1_524, speed: 5_000, health: 1_100 }
        : { radius: 1_309, speed: 8_500, health: 430 };
  const position = toSimPoint(-35 + local % 20 * 1.2, -35 + Math.floor(local / 20) * 1.2
    + Math.floor(index / 100) * 20);
  return {
    id: `unit-${index}`,
    kind,
    ownerId: player,
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
const units = Array.from({ length: 400 }, (_, index) => unitAt(index));
const buildings: BuildingState[] = Array.from({ length: 40 }, (_, index) => ({
  id: `building-${index}`,
  ownerId: players[index % players.length]!,
  position: toSimPoint(-27 + index % 10 * 6, -9 + Math.floor(index / 10) * 6),
  radius: 1_500,
  health: 2_500,
  maxHealth: 2_500,
}));

export default {
  async fetch() {
    await initializeNavigation(cloudflareNavigationModule(recastWasm));
    const simulationStarted = performance.now();
    const simulation = new LocalUnitSimulation(units, buildings);
    const simulationSetupMs = performance.now() - simulationStarted;
    const commandStarted = performance.now();
    for (const player of players) simulation.dispatch(player, {
      type: "move",
      unitIds: units.filter((unit) => unit.ownerId === player).map((unit) => unit.id),
      target: toSimPoint(35, 0),
    });
    const commandMs = performance.now() - commandStarted;
    const tickStarted = performance.now();
    simulation.step();
    const tickMs = performance.now() - tickStarted;

    const schemaStarted = performance.now();
    const replication = new SchemaReplication(players);
    replication.sync(0, units, buildings);
    for (const player of players) replication.setVisibility(player, {
      unitIds: new Set(units.filter((unit) => unit.ownerId === player).map((unit) => unit.id)),
      buildingIds: new Set(buildings.map((building) => building.id)),
    });
    const frames = replication.encodeInitial();
    const schemaInitialMs = performance.now() - schemaStarted;
    const moved = simulation.snapshot();
    const schemaDeltaStarted = performance.now();
    replication.sync(1, moved, []);
    const deltas = replication.encodeDelta();
    const schemaDeltaMs = performance.now() - schemaDeltaStarted;

    simulation.dispose();

    return Response.json({
      simulationSetupMs,
      commandMs,
      tickMs,
      schemaInitialMs,
      schemaDeltaMs,
      schemaBytes: [...frames.values()].reduce((sum, frame) => sum + frame.byteLength, 0),
      schemaDeltaBytes: [...deltas.values()].reduce((sum, frame) => sum + frame.byteLength, 0),
    });
  },
};
