import { expect, test } from "bun:test";
import { Decoder } from "@colyseus/schema";
import { ReplicatedMatch, SchemaReplication } from "./schemaReplication";
import { toSimPoint, type BuildingState, type UnitState } from "../../src/sim/units";

const unit = (id: string, ownerId: string, x: number): UnitState => {
  const position = toSimPoint(x, 0);
  return {
    id,
    kind: "ghostrunner",
    ownerId,
    health: 140,
    maxHealth: 140,
    pushable: true,
    radius: 450,
    speed: 9_000,
    attackCooldownTicks: 0,
    position,
    target: { ...position },
    path: [],
    order: "idle",
    moving: false,
    attacking: false,
  };
};

test("standalone schema replication emits independent fog views and small deltas", () => {
  const players = ["player-1", "player-2"];
  const units = [unit("one", players[0]!, 0), unit("two", players[1]!, 10)];
  const commandCenter: BuildingState = {
    id: "command-center-1",
    kind: "command-center",
    lifecycle: "active",
    constructionProgress: 1,
    ownerId: players[0]!,
    position: toSimPoint(0, 4),
    rotation: 0,
    radius: 5_580,
    health: 2_500,
    maxHealth: 2_500,
    productionQueue: [{
      id: "training-1",
      kind: "hornet",
      progressTicks: 25,
      totalTicks: 200,
    }],
    rallyPoint: toSimPoint(12, 4),
  };
  const turret: BuildingState = {
    id: "turret-1",
    kind: "turret",
    lifecycle: "active",
    constructionProgress: 1,
    ownerId: players[0]!,
    position: toSimPoint(8, 4),
    rotation: 0,
    radius: 1_800,
    attackRadius: 1_500,
    health: 900,
    maxHealth: 900,
    weapon: {
      range: 12_000,
      damage: 25,
      intervalTicks: 10,
      cooldownTicks: 4,
      targetId: "two",
    },
  };
  const replication = new SchemaReplication(players);
  replication.sync(0, units, [commandCenter, turret]);
  replication.setVisibility(players[0]!, {
    unitIds: new Set(["one"]),
    buildingIds: new Set([commandCenter.id, turret.id]),
  });
  replication.setVisibility(players[1]!, { unitIds: new Set(["two"]), buildingIds: new Set() });

  const initial = replication.encodeInitial();
  const playerOneState = new ReplicatedMatch();
  const playerOneDecoder = new Decoder(playerOneState);
  playerOneDecoder.decode(initial.get(players[0]!)!);
  expect([...playerOneState.units.keys()]).toEqual(["one"]);
  expect(playerOneState.buildings.get(commandCenter.id)!.productionQueue[0]).toMatchObject({
    id: "training-1",
    kind: 3,
    progressTicks: 25,
    totalTicks: 200,
  });
  expect(playerOneState.buildings.get(commandCenter.id)).toMatchObject({
    rallyX: 12_000,
    rallyZ: 4_000,
    hasRallyPoint: true,
  });
  expect(playerOneState.buildings.get(turret.id)).toMatchObject({
    weaponRange: 12_000,
    attackDamage: 25,
    attackIntervalTicks: 10,
    attackCooldownTicks: 4,
    attackTargetId: "two",
  });

  units[0]!.position.x += 100;
  replication.sync(1, units, [commandCenter, turret]);
  const delta = replication.encodeDelta();
  playerOneDecoder.decode(delta.get(players[0]!)!);

  expect(initial.get(players[0]!)!.length).toBeGreaterThan(0);
  expect(initial.get(players[1]!)!.length).toBeGreaterThan(0);
  expect(delta.get(players[0]!)!.length).toBeLessThan(initial.get(players[0]!)!.length);
  expect(delta.get(players[1]!)!.length).toBeLessThan(delta.get(players[0]!)!.length);
  expect(playerOneState.units.get("one")!.x).toBe(units[0]!.position.x);

  replication.sync(2, units.slice(1), []);
  replication.setVisibility(players[0]!, { unitIds: new Set(), buildingIds: new Set() });
  playerOneDecoder.decode(replication.encodeDelta().get(players[0]!)!);
  expect(playerOneState.units.has("one")).toBe(false);
});
