import { beforeAll, describe, expect, test } from "bun:test";
import { UNIT_CATALOG } from "../src/unitCatalog";
import {
  behemothFirstImpactSeconds,
  behemothImpactDelayTicks,
  behemothVolleySeed,
} from "../src/behemothAttack";
import { initializeNavigation } from "../src/sim/navigation";
import {
  ATTACK_SEPARATION_GAP,
  LocalUnitSimulation,
  POSITION_SCALE,
  UNIT_SEPARATION_GAP,
  toSimPoint,
  type BuildingState,
  type MoveCommand,
  type UnitState,
} from "../src/sim/units";

const unitAt = (
  id: string,
  x: number,
  z: number,
  pushable = true,
  radius = 450,
): UnitState => {
  const position = toSimPoint(x, z);
  return {
    id,
    kind: id.startsWith("behemoth") ? "behemoth" : id.startsWith("hornet")
      ? "hornet" : id.startsWith("scout") ? "scout-drone" : "ghostrunner",
    ownerId: "player-1",
    health: 140,
    maxHealth: 140,
    pushable,
    radius,
    speed: 10_350,
    attackCooldownTicks: 0,
    position,
    target: { ...position },
    path: [],
    order: "idle",
    moving: false,
    attacking: false,
  };
};

const distanceBetween = (
  first: Pick<UnitState, "position">,
  second: Pick<UnitState, "position">,
) => Math.hypot(
  second.position.x - first.position.x,
  second.position.z - first.position.z,
);

const createSimulation = (
  x = 0,
  z = 0,
  buildings: readonly BuildingState[] = [],
) => {
  const position = toSimPoint(x, z);
  return new LocalUnitSimulation([{
    id: "ghostrunner-1",
    kind: "ghostrunner",
    ownerId: "player-1",
    health: 140,
    maxHealth: 140,
    pushable: true,
    radius: 450,
    speed: UNIT_CATALOG.ghostrunner.speed * POSITION_SCALE,
    attackCooldownTicks: 0,
    position,
    target: { ...position },
    path: [],
    order: "idle",
    moving: false,
    attacking: false,
  }], buildings);
};

const commandCenterAt = (id: string, x: number, z: number): BuildingState => ({
  id,
  kind: "command-center",
  lifecycle: "active",
  constructionProgress: 1,
  ownerId: "player-1",
  position: toSimPoint(x, z),
  rotation: 0,
  radius: 5_580,
  attackRadius: 5_000,
  health: 2_500,
  maxHealth: 2_500,
  productionQueue: [],
  rallyPoint: toSimPoint(x + 10, z),
});

const matchCommandCenter = (
  id: string,
  ownerId: string,
  x: number,
  health = 2_500,
): BuildingState => ({
  ...commandCenterAt(id, x, 0),
  ownerId,
  health,
  maxHealth: 2_500,
});

const narrowPassTerrain = () => {
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

beforeAll(() => initializeNavigation());

describe("unit simulation", () => {
  test("trains a Ghostrunner from an active Command Center on fixed ticks", () => {
    const commandCenter = commandCenterAt("command-center-1", 0, 0);
    const simulation = new LocalUnitSimulation([], [commandCenter]);

    expect(simulation.dispatch("player-1", {
      type: "train",
      buildingId: commandCenter.id,
      kind: "ghostrunner",
    }).accepted).toBe(true);
    expect(simulation.buildingSnapshot()[0]!.productionQueue).toEqual([
      expect.objectContaining({ kind: "ghostrunner", progressTicks: 0, totalTicks: 120 }),
    ]);

    for (let tick = 0; tick < 119; tick += 1) simulation.step();
    expect(simulation.snapshot()).toEqual([]);
    expect(simulation.buildingSnapshot()[0]!.productionQueue?.[0]?.progressTicks).toBe(119);

    simulation.step();
    expect(simulation.buildingSnapshot()[0]!.productionQueue).toEqual([]);
    expect(simulation.snapshot()).toEqual([expect.objectContaining({
      kind: "ghostrunner",
      ownerId: "player-1",
      health: 140,
      maxHealth: 140,
      order: "move",
      moving: true,
    })]);
  });

  test("caps each production queue at five and cancels a stable queue item", () => {
    const commandCenter = commandCenterAt("command-center-1", 0, 0);
    const simulation = new LocalUnitSimulation([], [commandCenter]);
    const kinds = [
      "ghostrunner",
      "hornet",
      "behemoth",
      "ghostrunner",
      "hornet",
    ] as const;
    for (const kind of kinds) {
      expect(simulation.dispatch("player-1", {
        type: "train",
        buildingId: commandCenter.id,
        kind,
      }).accepted).toBe(true);
    }
    expect(simulation.dispatch("player-1", {
      type: "train",
      buildingId: commandCenter.id,
      kind: "behemoth",
    }).accepted).toBe(false);

    const queued = simulation.buildingSnapshot()[0]!.productionQueue!;
    expect(queued).toHaveLength(5);
    expect(queued.map((item) => item.totalTicks)).toEqual([120, 200, 350, 120, 200]);
    simulation.step();
    expect(simulation.buildingSnapshot()[0]!.productionQueue?.map((item) => item.progressTicks))
      .toEqual([1, 0, 0, 0, 0]);
    expect(simulation.dispatch("player-1", {
      type: "cancel-training",
      buildingId: commandCenter.id,
      itemId: queued[1]!.id,
    }).accepted).toBe(true);
    expect(simulation.buildingSnapshot()[0]!.productionQueue?.map((item) => item.kind))
      .toEqual(["ghostrunner", "behemoth", "ghostrunner", "hornet"]);
  });

  test("allocates a unique training identity after restoring an existing queue", () => {
    const commandCenter = commandCenterAt("command-center-1", 0, 0);
    commandCenter.productionQueue = [{
      id: "player-1-training-1",
      kind: "ghostrunner",
      progressTicks: 0,
      totalTicks: 120,
    }];
    const simulation = new LocalUnitSimulation([], [commandCenter]);

    expect(simulation.dispatch("player-1", {
      type: "train",
      buildingId: commandCenter.id,
      kind: "hornet",
    }).accepted).toBe(true);
    expect(simulation.buildingSnapshot()[0]!.productionQueue?.map((item) => item.id))
      .toEqual(["player-1-training-1", "player-1-training-2"]);
  });

  test("limits each player to three living or queued Scout Drones", () => {
    const first = commandCenterAt("command-center-1", 0, 0);
    const second = commandCenterAt("command-center-2", 20, 0);
    const livingScout = unitAt("scout-1", 0, 10);
    const deadScout = { ...unitAt("scout-dead", 20, 10), health: 0 };
    const simulation = new LocalUnitSimulation([livingScout, deadScout], [first, second]);

    expect(simulation.dispatch("player-1", {
      type: "train",
      buildingId: first.id,
      kind: "scout-drone",
    }).accepted).toBe(true);
    expect(simulation.dispatch("player-1", {
      type: "train",
      buildingId: second.id,
      kind: "scout-drone",
    }).accepted).toBe(true);
    expect(simulation.dispatch("player-1", {
      type: "train",
      buildingId: second.id,
      kind: "scout-drone",
    }).accepted).toBe(false);

    const queuedScout = simulation.buildingSnapshot()[0]!.productionQueue![0]!;
    simulation.dispatch("player-1", {
      type: "cancel-training",
      buildingId: first.id,
      itemId: queuedScout.id,
    });
    expect(simulation.dispatch("player-1", {
      type: "train",
      buildingId: second.id,
      kind: "scout-drone",
    }).accepted).toBe(true);
  });

  test("advances additional Command Center queues independently", () => {
    const first = commandCenterAt("command-center-1", -10, 0);
    const second = commandCenterAt("command-center-2", 10, 0);
    const simulation = new LocalUnitSimulation([], [first, second]);
    simulation.dispatch("player-1", {
      type: "train",
      buildingId: first.id,
      kind: "ghostrunner",
    });
    simulation.dispatch("player-1", {
      type: "train",
      buildingId: second.id,
      kind: "hornet",
    });

    simulation.step();

    expect(simulation.buildingSnapshot().map((building) =>
      building.productionQueue?.[0]?.progressTicks)).toEqual([1, 1]);
  });

  test("rejects production commands for unavailable or foreign buildings", () => {
    const constructing = {
      ...commandCenterAt("command-center-building", 0, 0),
      lifecycle: "constructing" as const,
      constructionProgress: 0.5,
    };
    const enemy = {
      ...commandCenterAt("enemy-command-center", 15, 0),
      ownerId: "player-2",
    };
    const simulation = new LocalUnitSimulation([], [constructing, enemy]);

    for (const buildingId of [constructing.id, enemy.id, "missing"] as const) {
      expect(simulation.dispatch("player-1", {
        type: "train",
        buildingId,
        kind: "ghostrunner",
      }).accepted).toBe(false);
    }
    expect(simulation.dispatch("player-1", {
      type: "set-rally-point",
      buildingId: enemy.id,
      target: toSimPoint(0, 10),
    }).accepted).toBe(false);
  });

  test("replays production queues and unit identities deterministically", () => {
    const commandCenter = commandCenterAt("command-center-1", 0, 0);
    const first = new LocalUnitSimulation([], [commandCenter]);
    const second = new LocalUnitSimulation([], [commandCenter]);
    for (const simulation of [first, second]) {
      simulation.dispatch("player-1", {
        type: "train",
        commandId: "train-1",
        buildingId: commandCenter.id,
        kind: "scout-drone",
      });
      for (let tick = 0; tick < 80; tick += 1) simulation.step();
    }

    expect(first.stateHash()).toBe(second.stateHash());
    expect(first.snapshot()).toEqual(second.snapshot());
    expect(first.drainAcceptedCommands()).toEqual(second.drainAcceptedCommands());
  });

  test("spawns clear of nearby units and moves toward an authoritative terrain rally point", () => {
    const commandCenter = commandCenterAt("command-center-1", 0, 0);
    const preferredExit = unitAt("blocker", 6.33, 0);
    const terrain = { size: 40, segments: 1, heights: new Float32Array(4) };
    const simulation = new LocalUnitSimulation([preferredExit], [commandCenter], terrain);

    expect(simulation.dispatch("player-1", {
      type: "set-rally-point",
      buildingId: commandCenter.id,
      target: toSimPoint(14, 0),
    }).accepted).toBe(true);
    expect(simulation.dispatch("player-1", {
      type: "set-rally-point",
      buildingId: commandCenter.id,
      target: toSimPoint(21, 0),
    }).accepted).toBe(false);
    simulation.dispatch("player-1", {
      type: "train",
      buildingId: commandCenter.id,
      kind: "ghostrunner",
    });
    for (let tick = 0; tick < 120; tick += 1) simulation.step();

    const trained = simulation.snapshot().find((unit) => unit.id !== preferredExit.id)!;
    expect(trained).toMatchObject({ kind: "ghostrunner", order: "move", moving: true });
    expect(distanceBetween(trained, preferredExit)).toBeGreaterThanOrEqual(
      trained.radius + preferredExit.radius + UNIT_SEPARATION_GAP - 2,
    );
    expect(distanceBetween(trained, commandCenter)).toBeGreaterThanOrEqual(
      trained.radius + commandCenter.radius + UNIT_SEPARATION_GAP - 2,
    );
    expect(simulation.buildingSnapshot()[0]!.rallyPoint).toEqual(toSimPoint(14, 0));
  });

  test("holds a completed queue item when no safe production exit exists", () => {
    const commandCenter = commandCenterAt("command-center-1", 0, 0);
    const terrain = { size: 8, segments: 1, heights: new Float32Array(4) };
    const simulation = new LocalUnitSimulation([], [commandCenter], terrain);
    simulation.dispatch("player-1", {
      type: "train",
      buildingId: commandCenter.id,
      kind: "ghostrunner",
    });

    for (let tick = 0; tick < 140; tick += 1) simulation.step();

    expect(simulation.snapshot()).toEqual([]);
    expect(simulation.buildingSnapshot()[0]!.productionQueue).toEqual([
      expect.objectContaining({ kind: "ghostrunner", progressTicks: 120, totalTicks: 120 }),
    ]);
  });

  test("does not spawn beyond a complete ring of exit blockers", () => {
    const commandCenter = commandCenterAt("command-center-1", 0, 0);
    const blockers = Array.from({ length: 32 }, (_, index) => {
      const angle = index * Math.PI * 2 / 32;
      return unitAt(
        `blocker-${index}`,
        Math.sin(angle) * 8,
        Math.cos(angle) * 8,
        false,
        1_200,
      );
    });
    const simulation = new LocalUnitSimulation(blockers, [commandCenter]);
    simulation.dispatch("player-1", {
      type: "train",
      buildingId: commandCenter.id,
      kind: "ghostrunner",
    });

    for (let tick = 0; tick < 140; tick += 1) simulation.step();

    expect(simulation.snapshot()).toHaveLength(blockers.length);
    expect(simulation.buildingSnapshot()[0]!.productionQueue?.[0]).toMatchObject({
      progressTicks: 120,
      totalTicks: 120,
    });
  });

  test("holds a trained unit until its rally point has a route", () => {
    const commandCenter = commandCenterAt("command-center-1", -12, 0);
    commandCenter.rallyPoint = toSimPoint(12, 0);
    const simulation = new LocalUnitSimulation([], [commandCenter], narrowPassTerrain());
    simulation.dispatch("player-1", {
      type: "train",
      buildingId: commandCenter.id,
      kind: "behemoth",
    });

    for (let tick = 0; tick < 370; tick += 1) simulation.step();

    expect(simulation.snapshot()).toEqual([]);
    expect(simulation.buildingSnapshot()[0]!.productionQueue?.[0]).toMatchObject({
      progressTicks: 350,
      totalTicks: 350,
    });
  });

  test("builds a Turret through a vulnerable Scout Drone construction site", () => {
    const scout = unitAt("scout-1", 0, 0);
    const simulation = new LocalUnitSimulation([scout]);

    expect(simulation.dispatch("player-1", {
      type: "build",
      unitIds: [scout.id],
      kind: "turret",
      target: toSimPoint(2.7, 0),
      rotation: 0,
    }).accepted).toBe(true);

    expect(simulation.buildingSnapshot()).toEqual([expect.objectContaining({
      kind: "turret",
      lifecycle: "constructing",
      constructionProgress: 0,
      ownerId: "player-1",
      builderId: scout.id,
      health: 1,
    })]);
    expect(simulation.snapshot()[0]).toMatchObject({
      order: "build",
      constructionTargetId: simulation.buildingSnapshot()[0]!.id,
    });

    for (let tick = 0; tick < 100; tick += 1) simulation.step();

    expect(simulation.buildingSnapshot()).toEqual([expect.objectContaining({
      lifecycle: "active",
      constructionProgress: 1,
      builderId: undefined,
      health: 900,
      maxHealth: 900,
    })]);
    expect(simulation.snapshot()[0]).toMatchObject({
      order: "idle",
      constructionTargetId: undefined,
    });
  });

  test("pauses a construction site and lets another Scout Drone resume it", () => {
    const firstScout = unitAt("scout-1", 0, 0);
    const secondScout = unitAt("scout-2", -5, 0);
    const simulation = new LocalUnitSimulation([firstScout, secondScout]);
    simulation.dispatch("player-1", {
      type: "build",
      unitIds: [firstScout.id],
      kind: "turret",
      target: toSimPoint(2.7, 0),
      rotation: 0,
    });
    for (let tick = 0; tick < 10; tick += 1) simulation.step();
    const site = simulation.buildingSnapshot()[0]!;

    expect(simulation.dispatch("player-1", {
      type: "stop",
      unitIds: [firstScout.id],
    }).accepted).toBe(true);
    const pausedProgress = simulation.buildingSnapshot()[0]!.constructionProgress;
    for (let tick = 0; tick < 10; tick += 1) simulation.step();
    expect(simulation.buildingSnapshot()[0]).toMatchObject({
      builderId: undefined,
      constructionProgress: pausedProgress,
    });

    expect(simulation.dispatch("player-1", {
      type: "resume-construction",
      unitIds: [secondScout.id],
      buildingId: site.id,
    }).accepted).toBe(true);
    expect(simulation.buildingSnapshot()[0]!.builderId).toBe(secondScout.id);
    expect(simulation.dispatch("player-1", {
      type: "move",
      unitIds: [secondScout.id],
      target: toSimPoint(-5, 5),
    }).accepted).toBe(true);
    expect(simulation.buildingSnapshot()[0]!.builderId).toBeUndefined();
    expect(simulation.dispatch("player-1", {
      type: "resume-construction",
      unitIds: [firstScout.id],
      buildingId: site.id,
    }).accepted).toBe(true);
    for (let tick = 0; tick < 110; tick += 1) simulation.step();
    expect(simulation.buildingSnapshot()[0]).toMatchObject({
      lifecycle: "active",
      constructionProgress: 1,
      builderId: undefined,
    });
  });

  test("rejects construction without a Scout Drone or a clear footprint", () => {
    const scout = unitAt("scout-1", 0, 0);
    const ghostrunner = unitAt("ghostrunner-1", -5, 0);
    const simulation = new LocalUnitSimulation([scout, ghostrunner]);

    expect(simulation.dispatch("player-1", {
      type: "build",
      unitIds: [ghostrunner.id],
      kind: "turret",
      target: toSimPoint(3, 0),
      rotation: 0,
    }).accepted).toBe(false);
    expect(simulation.dispatch("player-1", {
      type: "build",
      unitIds: [scout.id],
      kind: "turret",
      target: toSimPoint(0, 0),
      rotation: 0,
    }).accepted).toBe(false);
    expect(simulation.buildingSnapshot()).toEqual([]);

    const bounded = new LocalUnitSimulation([scout], [], {
      size: 10,
      segments: 1,
      heights: new Float32Array(4),
    });
    expect(bounded.dispatch("player-1", {
      type: "build",
      unitIds: [scout.id],
      kind: "turret",
      target: toSimPoint(4, 0),
      rotation: 0,
    }).accepted).toBe(false);
  });

  test("keeps Command Center construction on its longer fixed-tick schedule", () => {
    const scout = unitAt("scout-1", 0, 0);
    const simulation = new LocalUnitSimulation([scout]);
    expect(simulation.dispatch("player-1", {
      type: "build",
      unitIds: [scout.id],
      kind: "command-center",
      target: toSimPoint(6.1, 0),
      rotation: 0,
    }).accepted).toBe(true);

    for (let tick = 0; tick < 100; tick += 1) simulation.step();

    expect(simulation.buildingSnapshot()[0]).toMatchObject({
      kind: "command-center",
      lifecycle: "constructing",
      constructionProgress: 1 / 6,
    });

    for (let tick = 100; tick < 600; tick += 1) simulation.step();
    const commandCenter = simulation.buildingSnapshot()[0]!;
    expect(commandCenter).toMatchObject({
      lifecycle: "active",
      productionQueue: [],
    });
    expect(commandCenter.rallyPoint).toBeDefined();
    expect(simulation.dispatch("player-1", {
      type: "train",
      buildingId: commandCenter.id,
      kind: "hornet",
    }).accepted).toBe(true);
  });

  test("destroys a vulnerable site and releases its assigned Scout Drone", () => {
    const scout = unitAt("scout-1", 0, 0);
    const enemy = unitAt("enemy-1", 5.5, 0);
    enemy.ownerId = "player-2";
    enemy.attackDamage = 20;
    enemy.attackIntervalTicks = 1;
    const simulation = new LocalUnitSimulation([scout, enemy]);
    simulation.dispatch("player-1", {
      type: "build",
      unitIds: [scout.id],
      kind: "turret",
      target: toSimPoint(2.7, 0),
      rotation: 0,
    });
    const site = simulation.buildingSnapshot()[0]!;

    expect(simulation.dispatch("player-2", {
      type: "attack",
      unitIds: [enemy.id],
      targetId: site.id,
    }).accepted).toBe(true);
    simulation.step();

    expect(simulation.buildingSnapshot()).toEqual([]);
    expect(simulation.snapshot().find(({ id }) => id === scout.id)).toMatchObject({
      order: "idle",
      constructionTargetId: undefined,
    });
  });

  test("pauses construction when the assigned Scout Drone is destroyed", () => {
    const scout = unitAt("scout-1", 0, 0);
    const enemy = unitAt("enemy-1", -1.45, 0);
    enemy.ownerId = "player-2";
    enemy.attackDamage = 200;
    enemy.attackIntervalTicks = 1;
    const simulation = new LocalUnitSimulation([scout, enemy]);
    simulation.dispatch("player-1", {
      type: "build",
      unitIds: [scout.id],
      kind: "turret",
      target: toSimPoint(2.7, 0),
      rotation: 0,
    });
    const site = simulation.buildingSnapshot()[0]!;
    simulation.dispatch("player-2", {
      type: "attack",
      unitIds: [enemy.id],
      targetId: scout.id,
    });

    simulation.step();

    expect(simulation.snapshot().find(({ id }) => id === scout.id)?.health).toBe(0);
    expect(simulation.buildingSnapshot()[0]).toMatchObject({
      id: site.id,
      lifecycle: "constructing",
      constructionProgress: 0,
      builderId: undefined,
    });
  });

  test("creates buildings through the authoritative lifecycle", () => {
    const simulation = createSimulation();
    const building: BuildingState = {
      id: "command-center-new",
      kind: "command-center",
      lifecycle: "constructing",
      constructionProgress: 0,
      ownerId: "player-1",
      position: toSimPoint(5, 3),
      rotation: Math.PI / 2,
      radius: 5 * POSITION_SCALE,
      attackRadius: 4.5 * POSITION_SCALE,
      health: 1,
      maxHealth: 2_500,
    };

    expect(simulation.createBuilding(building)).toBe(true);
    expect(simulation.createBuilding(building)).toBe(false);
    expect(simulation.buildingSnapshot()).toEqual([expect.objectContaining({
      ...building,
      productionQueue: [],
      rallyPoint: expect.any(Object),
    })]);
  });

  test("moves an owned unit to the commanded point on fixed ticks", () => {
    const simulation = createSimulation();
    expect(simulation.dispatch("player-1", {
      type: "move",
      unitIds: ["ghostrunner-1"],
      target: toSimPoint(4, -3),
    }).accepted).toBe(true);

    for (let tick = 0; tick < 20; tick += 1) simulation.step();

    expect(simulation.snapshot()[0]).toMatchObject({
      position: toSimPoint(4, -3),
      moving: false,
    });
  });

  test("advances the Ghostrunner at its catalog speed", () => {
    const simulation = createSimulation();
    simulation.dispatch("player-1", {
      type: "move",
      unitIds: ["ghostrunner-1"],
      target: toSimPoint(20, 0),
    });

    for (let tick = 0; tick < 5; tick += 1) simulation.step();

    expect(simulation.snapshot()[0]?.position)
      .toEqual(toSimPoint(UNIT_CATALOG.ghostrunner.speed * 0.5, 0));
  });

  test("advances the Hornet at its catalog speed", () => {
    const hornet = unitAt("hornet-1", 0, 0, true, 1_309);
    hornet.speed = UNIT_CATALOG.hornet.speed * POSITION_SCALE;
    const simulation = new LocalUnitSimulation([hornet]);
    simulation.dispatch("player-1", {
      type: "move",
      unitIds: [hornet.id],
      target: toSimPoint(20, 0),
    });

    simulation.step();

    expect(simulation.snapshot()[0]?.position)
      .toEqual(toSimPoint(UNIT_CATALOG.hornet.speed * 0.1, 0));
  });

  test("advances the Scout Drone at its catalog speed", () => {
    const scout = unitAt("scout-drone-1", 0, 0, true, 306);
    scout.speed = UNIT_CATALOG["scout-drone"].speed * POSITION_SCALE;
    const simulation = new LocalUnitSimulation([scout]);
    simulation.dispatch("player-1", {
      type: "move",
      unitIds: [scout.id],
      target: toSimPoint(20, 0),
    });

    simulation.step();

    expect(simulation.snapshot()[0]?.position)
      .toEqual(toSimPoint(UNIT_CATALOG["scout-drone"].speed * 0.1, 0));
  });

  test("rejects commands for another player's unit", () => {
    const simulation = createSimulation();
    expect(simulation.dispatch("player-2", {
      type: "move",
      unitIds: ["ghostrunner-1"],
      target: toSimPoint(10, 10),
    }).accepted).toBe(false);
    expect(simulation.snapshot()[0]?.position).toEqual(toSimPoint(0, 0));
  });

  test("deduplicates command IDs without trusting player identity in the payload", () => {
    const simulation = createSimulation();
    const command = {
      type: "move",
      commandId: "command-1",
      unitIds: ["ghostrunner-1"],
      target: toSimPoint(4, 0),
    } satisfies MoveCommand;
    const first = simulation.dispatch("player-1", command);
    const duplicate = simulation.dispatch("player-1", {
      type: "move",
      commandId: "command-1",
      unitIds: ["ghostrunner-1"],
      target: toSimPoint(20, 0),
    });

    expect(first).toMatchObject({ accepted: true, duplicate: false, serverTick: 0 });
    expect(duplicate).toMatchObject({ accepted: true, duplicate: true, serverTick: 0 });
    expect(simulation.drainAcceptedCommands()).toEqual([{
      playerId: "player-1",
      serverTick: 0,
      command,
    }]);
    for (let tick = 0; tick < 10; tick += 1) simulation.step();
    expect(simulation.snapshot()[0]?.position).toEqual(toSimPoint(4, 0));
  });

  test("does not accept commands for dead units", () => {
    const dead = unitAt("ghostrunner-1", 0, 0);
    dead.health = 0;
    const simulation = new LocalUnitSimulation([dead]);

    expect(simulation.dispatch("player-1", {
      type: "move",
      unitIds: [dead.id],
      target: toSimPoint(10, 0),
    }).accepted).toBe(false);
  });

  test("moves 100 units in one command without stacking their destinations", () => {
    const units = Array.from({ length: 100 }, (_, index) => {
      const position = toSimPoint(index % 10, Math.floor(index / 10));
      return {
        id: `ghostrunner-${index + 1}`,
        kind: "ghostrunner" as const,
        ownerId: "player-1",
        health: 140,
        maxHealth: 140,
        pushable: true,
        radius: UNIT_CATALOG.ghostrunner.radius * POSITION_SCALE,
        speed: 10_350,
        attackCooldownTicks: 0,
        position,
        target: { ...position },
        path: [],
        order: "idle" as const,
        moving: false,
        attacking: false,
      };
    });
    const simulation = new LocalUnitSimulation(units);

    expect(simulation.dispatch("player-1", {
      type: "move",
      unitIds: units.map((unit) => unit.id),
      target: toSimPoint(30, 30),
    }).accepted).toBe(true);

    for (let tick = 0; tick < 50; tick += 1) simulation.step();

    const snapshot = simulation.snapshot();
    expect(snapshot.every((unit) => !unit.moving)).toBe(true);
    expect(new Set(snapshot.map((unit) => `${unit.position.x},${unit.position.z}`)).size).toBe(100);
    const nearest = Math.min(...snapshot.flatMap((unit, index) =>
      snapshot.slice(index + 1).map((other) => distanceBetween(unit, other))));
    expect(nearest).toBeGreaterThanOrEqual(
      UNIT_CATALOG.ghostrunner.radius * POSITION_SCALE * 2 + UNIT_SEPARATION_GAP - 5,
    );
  });

  test("keeps a formation compact across repeated mid-movement redirects", () => {
    const units = Array.from({ length: 36 }, (_, index) => unitAt(
      `ghostrunner-${index + 1}`,
      -12 + index % 6 * 1.05,
      -2.625 + Math.floor(index / 6) * 1.05,
    ));
    const simulation = new LocalUnitSimulation(units);
    const unitIds = units.map(({ id }) => id);
    const targets = [toSimPoint(20, 0), toSimPoint(25, 12), toSimPoint(12, 20), toSimPoint(-3, 15)];

    for (const target of targets) {
      expect(simulation.dispatch("player-1", { type: "move", unitIds, target }).accepted).toBe(true);
      for (let tick = 0; tick < 4; tick += 1) simulation.step();
      const moving = simulation.snapshot();
      const width = Math.max(...moving.map((unit) => unit.position.x))
        - Math.min(...moving.map((unit) => unit.position.x));
      const depth = Math.max(...moving.map((unit) => unit.position.z))
        - Math.min(...moving.map((unit) => unit.position.z));
      expect(Math.max(width, depth)).toBeLessThan(9 * POSITION_SCALE);
    }

    for (let tick = 0; tick < 60; tick += 1) simulation.step();
    const settled = simulation.snapshot();
    expect(settled.every((unit) => !unit.moving)).toBe(true);
    const nearest = Math.min(...settled.flatMap((unit, index) =>
      settled.slice(index + 1).map((other) => distanceBetween(unit, other))));
    expect(nearest).toBeGreaterThanOrEqual(900 + UNIT_SEPARATION_GAP - 5);
  });

  test("replaces every old group order when a formation slot is blocked", () => {
    const building = {
      id: "obstacle-1",
      position: toSimPoint(0, 0),
      radius: 400,
    };
    const units = ["ghostrunner-1", "ghostrunner-2"].map((id, index) => {
      const position = toSimPoint(-4, index * 0.8);
      return {
        id,
        kind: "ghostrunner" as const,
        ownerId: "player-1",
        health: 140,
        maxHealth: 140,
        pushable: true,
        radius: 450,
        speed: 10_350,
        attackCooldownTicks: 0,
        position,
        target: { ...position },
        path: [],
        order: "idle" as const,
        moving: false,
        attacking: false,
      };
    });
    const simulation = new LocalUnitSimulation(units, [building]);
    const unitIds = units.map((unit) => unit.id);

    simulation.dispatch("player-1", {
      type: "move",
      unitIds,
      target: toSimPoint(10, 0),
    });
    simulation.step();
    simulation.dispatch("player-1", {
      type: "move",
      unitIds,
      target: toSimPoint(1.1, 0),
    });
    for (let tick = 0; tick < 50; tick += 1) simulation.step();

    const snapshot = simulation.snapshot();
    expect(snapshot.every((unit) => !unit.moving && unit.position.x < 3_000)).toBe(true);
  });

  test("moves a unit out of an invalid building margin instead of leaving it stuck", () => {
    const building = {
      id: "command-center-1",
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
    };
    const simulation = createSimulation(2.2, 0, [building]);

    expect(simulation.dispatch("player-1", {
      type: "move",
      unitIds: ["ghostrunner-1"],
      target: toSimPoint(8, 0),
    }).accepted).toBe(true);
    for (let tick = 0; tick < 20; tick += 1) simulation.step();

    expect(simulation.snapshot()[0]).toMatchObject({
      position: toSimPoint(8, 0),
      moving: false,
    });
  });

  test("snaps a blocked move destination to reachable ground", () => {
    const building = {
      id: "command-center-1",
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
    };
    const simulation = createSimulation(-6, 0, [building]);

    expect(simulation.dispatch("player-1", {
      type: "move",
      unitIds: ["ghostrunner-1"],
      target: toSimPoint(0, 0),
    }).accepted).toBe(true);
    for (let tick = 0; tick < 20; tick += 1) simulation.step();

    const unit = simulation.snapshot()[0]!;
    expect(unit.moving).toBe(false);
    expect(Math.hypot(unit.position.x, unit.position.z)).toBeGreaterThanOrEqual(2_600);
  });

  test("separates overlapping unit collision circles", () => {
    const position = toSimPoint(0, 0);
    const units = ["ghostrunner-1", "ghostrunner-2"].map((id) => ({
      id,
      kind: "ghostrunner" as const,
      ownerId: "player-1",
      health: 140,
      maxHealth: 140,
      pushable: true,
      radius: 360,
      speed: 10_350,
      attackCooldownTicks: 0,
      position: { ...position },
      target: { ...position },
      path: [],
      order: "idle" as const,
      moving: false,
      attacking: false,
    }));
    const simulation = new LocalUnitSimulation(units);

    simulation.step();

    const [first, second] = simulation.snapshot();
    expect(Math.hypot(
      second!.position.x - first!.position.x,
      second!.position.z - first!.position.z,
    )).toBeGreaterThanOrEqual(720);
  });

  test("crowds flow around an unpushable unit without moving it", () => {
    const behemoth = unitAt("behemoth-1", 0, 0, false, 1_161);
    const runners = Array.from({ length: 12 }, (_, index) => {
      const angle = index / 12 * Math.PI * 2;
      return unitAt(
        `ghostrunner-${index + 1}`,
        Math.cos(angle),
        Math.sin(angle),
        true,
        450,
      );
    });
    const simulation = new LocalUnitSimulation([behemoth, ...runners]);

    for (let tick = 0; tick < 10; tick += 1) simulation.step();

    const [settledBehemoth, ...settledRunners] = simulation.snapshot();
    expect(settledBehemoth?.position).toEqual(toSimPoint(0, 0));
    expect(settledRunners.every((runner) => Math.hypot(
      runner.position.x - settledBehemoth!.position.x,
      runner.position.z - settledBehemoth!.position.z,
    ) >= behemoth.radius + runner.radius - 1)).toBe(true);
  });

  test("separates overlapping Behemoths without letting infantry push them", () => {
    const first = unitAt("behemoth-1", 0, 0, false, 1_524);
    const second = unitAt("behemoth-2", 1, 0, false, 1_524);
    const simulation = new LocalUnitSimulation([first, second]);

    simulation.step();

    const [settledFirst, settledSecond] = simulation.snapshot();
    expect(Math.hypot(
      settledSecond!.position.x - settledFirst!.position.x,
      settledSecond!.position.z - settledFirst!.position.z,
    )).toBeGreaterThanOrEqual(first.radius + second.radius - 1);
    expect(settledFirst!.position.x + settledSecond!.position.x)
      .toBe(first.position.x + second.position.x);
  });

  test("gives grouped Behemoths formation slots sized to their footprints", () => {
    const first = unitAt("behemoth-1", -10, -2, false, 1_524);
    const second = unitAt("behemoth-2", -10, 2, false, 1_524);
    const simulation = new LocalUnitSimulation([first, second]);

    expect(simulation.dispatch("player-1", {
      type: "move",
      unitIds: [first.id, second.id],
      target: toSimPoint(0, 0),
    }).accepted).toBe(true);
    for (let tick = 0; tick < 30; tick += 1) simulation.step();

    const settled = simulation.snapshot();
    expect(settled.every((unit) => !unit.moving && unit.position.x === unit.target.x
      && unit.position.z === unit.target.z)).toBe(true);
    expect(Math.hypot(
      settled[1]!.position.x - settled[0]!.position.x,
      settled[1]!.position.z - settled[0]!.position.z,
    )).toBeGreaterThan(first.radius + second.radius);
  });

  test("keeps skewed unit pairs on their existing sides when redirected", () => {
    for (const [kind, radius, pushable] of [
      ["behemoth", 1_524, false],
      ["hornet", 1_309, true],
    ] as const) {
      const lower = unitAt(`${kind}-1`, -8, -2, pushable, radius);
      const upper = unitAt(`${kind}-2`, -10, 2, pushable, radius);
      const simulation = new LocalUnitSimulation([lower, upper]);

      simulation.dispatch("player-1", {
        type: "move",
        unitIds: [lower.id, upper.id],
        target: toSimPoint(15, 0),
      });

      const byId = new Map(simulation.snapshot().map((unit) => [unit.id, unit]));
      expect(byId.get(lower.id)!.path.at(-1)!.z)
        .toBeLessThan(byId.get(upper.id)!.path.at(-1)!.z);
      simulation.dispose();
    }
  });

  test("routes around an unpushable unit instead of repeatedly colliding with it", () => {
    const runner = unitAt("ghostrunner-1", -5, 0);
    const behemoth = unitAt("behemoth-1", 0, 0, false, 1_161);
    const simulation = new LocalUnitSimulation([runner, behemoth]);

    expect(simulation.dispatch("player-1", {
      type: "move",
      unitIds: [runner.id],
      target: toSimPoint(5, 0),
    }).accepted).toBe(true);

    for (let tick = 0; tick < 20; tick += 1) {
      simulation.step();
      const currentRunner = simulation.snapshot().find((unit) => unit.id === runner.id)!;
      expect(Math.hypot(currentRunner.position.x, currentRunner.position.z))
        .toBeGreaterThanOrEqual(runner.radius + behemoth.radius - 1);
    }
    expect(simulation.snapshot().find((unit) => unit.id === runner.id)).toMatchObject({
      position: toSimPoint(5, 0),
      moving: false,
    });
  });

  test("resolves collisions deterministically regardless of spawn order", () => {
    const units = [
      unitAt("behemoth-1", 0, 0, false, 1_161),
      unitAt("ghostrunner-1", 0.8, 0),
      unitAt("ghostrunner-2", -0.4, 0.5),
    ];
    const first = new LocalUnitSimulation(units);
    const second = new LocalUnitSimulation([...units].reverse());

    first.step();
    second.step();

    const byId = (simulation: LocalUnitSimulation) => simulation.snapshot()
      .map(({ id, position }) => ({ id, position }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(first)).toEqual(byId(second));
  });

  test("routes around a building instead of crossing its footprint", () => {
    const building = {
      id: "command-center-1",
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
    };
    const simulation = createSimulation(-6, 0, [building]);
    simulation.dispatch("player-1", {
      type: "move",
      unitIds: ["ghostrunner-1"],
      target: toSimPoint(6, 0),
    });

    for (let tick = 0; tick < 30; tick += 1) {
      simulation.step();
      const unit = simulation.snapshot()[0]!;
      expect(Math.hypot(unit.position.x, unit.position.z)).toBeGreaterThanOrEqual(2_590);
    }
    expect(simulation.snapshot()[0]).toMatchObject({
      position: toSimPoint(6, 0),
      moving: false,
    });
  });

  test("approaches a building and enters the attack state", () => {
    const building = {
      id: "turret-1",
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
    };
    const simulation = createSimulation(-8, 0, [building]);
    expect(simulation.dispatch("player-1", {
      type: "attack",
      unitIds: ["ghostrunner-1"],
      targetId: building.id,
    }).accepted).toBe(true);

    for (let tick = 0; tick < 30; tick += 1) simulation.step();

    const unit = simulation.snapshot()[0]!;
    expect(unit).toMatchObject({ moving: false, attacking: true, attackTargetId: building.id });
    expect(Math.hypot(unit.position.x, unit.position.z)).toBeCloseTo(2.85 * POSITION_SCALE, -1);
  });

  test("gives melee attack slots enough arrival margin to survive small collision pushes", () => {
    const building: BuildingState = {
      id: "turret-1",
      ownerId: "player-2",
      health: 2_500,
      maxHealth: 2_500,
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
    };
    const units = Array.from({ length: 12 }, (_, index) => unitAt(
      `ghostrunner-${index + 1}`,
      -9 - Math.floor(index / 4),
      index % 4 - 1.5,
    ));
    const simulation = new LocalUnitSimulation(units, [building]);

    simulation.dispatch("player-1", {
      type: "attack",
      unitIds: units.map(({ id }) => id),
      targetId: building.id,
    });

    const maximumRange = building.radius + units[0]!.radius + 0.55 * POSITION_SCALE;
    for (const unit of simulation.snapshot()) {
      const destination = unit.path.at(-1) ?? unit.position;
      expect(distanceBetween({ position: destination }, { position: building.position }))
        .toBeLessThanOrEqual(maximumRange - 0.1 * POSITION_SCALE);
    }

    for (let tick = 0; tick < 30; tick += 1) simulation.step();
    expect(simulation.snapshot().every((unit) => unit.attacking && !unit.moving)).toBe(true);
  });

  test("routes a second melee attacker around an occupied building edge", () => {
    const building: BuildingState = {
      id: "turret-1",
      ownerId: "player-2",
      health: 2_500,
      maxHealth: 2_500,
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
    };
    const front = unitAt("ghostrunner-1", -3, 0, true, 450);
    const behind = unitAt("ghostrunner-2", -4.05, 0, true, 450);
    const simulation = new LocalUnitSimulation([front, behind], [building]);

    expect(simulation.dispatch("player-1", {
      type: "attack",
      unitIds: [front.id, behind.id],
      targetId: building.id,
    }).accepted).toBe(true);

    const ordered = simulation.snapshot();
    expect(ordered.every((unit) => unit.moving && !unit.attacking)).toBe(true);
    expect(distanceBetween(
      { position: ordered[0]!.path.at(-1)! },
      { position: ordered[1]!.path.at(-1)! },
    ))
      .toBeGreaterThanOrEqual(front.radius + behind.radius + ATTACK_SEPARATION_GAP);

    for (let tick = 0; tick < 20; tick += 1) simulation.step();
    for (let tick = 0; tick < 10; tick += 1) {
      const attackers = simulation.snapshot();
      expect(attackers.every((unit) => unit.attacking && !unit.moving)).toBe(true);
      simulation.step();
    }
  });

  test("immediately assigns every available approach spot in a ten-unit attack", () => {
    const building: BuildingState = {
      id: "command-center-1",
      ownerId: "player-2",
      health: 2_500,
      maxHealth: 2_500,
      position: toSimPoint(0, 0),
      radius: 5.58 * POSITION_SCALE,
    };
    const units = Array.from({ length: 10 }, (_, index) => {
      const unit = unitAt(
        `ghostrunner-${index + 1}`,
        -12 + (index % 5) * 1.05,
        (Math.floor(index / 5) - 0.5) * 1.05,
      );
      unit.speed = 9 * POSITION_SCALE;
      unit.attackDamage = 20;
      unit.attackIntervalTicks = 11;
      return unit;
    });
    const simulation = new LocalUnitSimulation(units, [building]);

    simulation.dispatch("player-1", {
      type: "attack",
      unitIds: units.map(({ id }) => id),
      targetId: building.id,
    });

    const ordered = simulation.snapshot();
    expect(ordered.every((unit) => unit.moving && !unit.attacking)).toBe(true);
    const destinations = ordered.map((unit) => ({ position: unit.path.at(-1)! }));
    expect(destinations.every((position, index) => destinations.slice(index + 1)
      .every((other) => distanceBetween(position, other)
        >= units[0]!.radius * 2 + ATTACK_SEPARATION_GAP))).toBe(true);
    expect(destinations.some((position, index) => destinations.slice(index + 1)
      .some((other) => distanceBetween(position, other)
        < units[0]!.radius * 2 + UNIT_SEPARATION_GAP))).toBe(true);

    for (let tick = 0; tick < 20; tick += 1) simulation.step();
    expect(simulation.snapshot().every((unit) => unit.attacking && !unit.moving)).toBe(true);
  });

  test("stages excess melee attackers around a full building edge", () => {
    const building: BuildingState = {
      id: "turret-1",
      ownerId: "player-2",
      health: 2_500,
      maxHealth: 2_500,
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
    };
    const units = Array.from({ length: 48 }, (_, index) => unitAt(
      `ghostrunner-${index + 1}`,
      -12 - Math.floor(index / 8),
      index % 8 - 3.5,
      true,
      450,
    ));
    const simulation = new LocalUnitSimulation(units, [building]);
    const started = performance.now();

    simulation.dispatch("player-1", {
      type: "attack",
      unitIds: units.map(({ id }) => id),
      targetId: building.id,
    });

    const ordered = simulation.snapshot();
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(ordered.every((unit) => unit.order === "attack")).toBe(true);
    expect(ordered.every((unit) => unit.moving || unit.attacking)).toBe(true);
    const destinations = ordered.map((unit) => ({
      position: unit.path.at(-1) ?? unit.position,
    }));
    expect(destinations.some(({ position }) => distanceBetween(
      { position: building.position },
      { position },
    ) > 3.1 * POSITION_SCALE)).toBe(true);
    expect(destinations.every((position, index) => destinations.slice(index + 1)
      .every((other) => distanceBetween(position, other)
        >= 450 * 2 + ATTACK_SEPARATION_GAP))).toBe(true);
  });

  test("holds overflow attackers in place while the attack ring is full", () => {
    const building: BuildingState = {
      id: "turret-1",
      ownerId: "player-2",
      health: 2_500,
      maxHealth: 2_500,
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
    };
    const units = Array.from({ length: 48 }, (_, index) => unitAt(
      `ghostrunner-${index + 1}`,
      -12 - Math.floor(index / 8),
      index % 8 - 3.5,
    ));
    const simulation = new LocalUnitSimulation(units, [building]);

    simulation.dispatch("player-1", {
      type: "attack",
      unitIds: units.map(({ id }) => id),
      targetId: building.id,
    });
    for (let tick = 0; tick < 40; tick += 1) simulation.step();

    const settled = simulation.snapshot();
    const frontline = settled.filter((unit) => unit.formationPosition && distanceBetween(
      { position: unit.formationPosition },
      { position: building.position },
    ) <= 3.1 * POSITION_SCALE);
    expect(frontline.length).toBeGreaterThan(0);
    expect(frontline.every((unit) => unit.attacking && !unit.moving)).toBe(true);
    const staged = settled.filter((unit) => unit.formationPosition && distanceBetween(
      { position: unit.formationPosition },
      { position: building.position },
    ) > 3.1 * POSITION_SCALE);
    expect(staged.length).toBeGreaterThan(0);
    expect(staged.every((unit) => !unit.moving && !unit.attacking)).toBe(true);
    const positions = new Map(staged.map((unit) => [unit.id, unit.position]));

    for (let tick = 0; tick < 20; tick += 1) simulation.step();
    expect(simulation.snapshot().filter((unit) => positions.has(unit.id)).every((unit) => (
      !unit.moving && !unit.attacking
      && distanceBetween(unit, { position: positions.get(unit.id)! }) < 0.1 * POSITION_SCALE
    ))).toBe(true);
  });

  test("promotes a staged melee attacker when an occupied spot becomes free", () => {
    const building: BuildingState = {
      id: "turret-1",
      ownerId: "player-2",
      health: 2_500,
      maxHealth: 2_500,
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
    };
    const units = Array.from({ length: 48 }, (_, index) => unitAt(
      `ghostrunner-${index + 1}`,
      -12 - Math.floor(index / 8),
      index % 8 - 3.5,
    ));
    const victim = units[0]!;
    const enemy = unitAt("a-enemy", -12, -3.5);
    enemy.ownerId = "player-2";
    enemy.attackDamage = victim.health;
    enemy.order = "attack";
    enemy.attacking = true;
    enemy.attackTargetId = victim.id;
    enemy.target = { ...victim.position };
    const simulation = new LocalUnitSimulation([...units, enemy], [building]);

    simulation.dispatch("player-1", {
      type: "attack",
      unitIds: units.map(({ id }) => id),
      targetId: building.id,
    });
    const stagedIds = new Set(simulation.snapshot().filter((unit) => {
      const destination = unit.path.at(-1) ?? unit.position;
      return unit.ownerId === "player-1" && unit.order === "attack"
        && distanceBetween({ position: building.position }, { position: destination })
          > 3.1 * POSITION_SCALE;
    }).map(({ id }) => id));
    expect(stagedIds.size).toBeGreaterThan(0);

    for (let tick = 0; tick < 20; tick += 1) simulation.step();
    const result = simulation.snapshot();
    expect(result.find(({ id }) => id === victim.id)?.health).toBe(0);
    expect(result.some((unit) => {
      const destination = unit.path.at(-1) ?? unit.position;
      return stagedIds.has(unit.id) && distanceBetween(
        { position: building.position },
        { position: destination },
      ) <= 3.1 * POSITION_SCALE;
    })).toBe(true);
  });

  test("gives Hornets separate firing positions around a building", () => {
    const building: BuildingState = {
      id: "turret-1",
      ownerId: "player-2",
      health: 2_500,
      maxHealth: 2_500,
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
      attackRadius: 1.5 * POSITION_SCALE,
    };
    const hornets = [-3, 0, 3].map((z, index) => {
      const hornet = unitAt(`hornet-${index + 1}`, -20, z, true, 1_309);
      hornet.speed = 8.5 * POSITION_SCALE;
      hornet.attackRange = 14 * POSITION_SCALE;
      hornet.attackDamage = 30;
      hornet.attackIntervalTicks = 8;
      return hornet;
    });
    const simulation = new LocalUnitSimulation(hornets, [building]);

    simulation.dispatch("player-1", {
      type: "attack",
      unitIds: hornets.map(({ id }) => id),
      targetId: building.id,
    });
    const destinations = simulation.snapshot().map((unit) => ({
      position: unit.path.at(-1) ?? unit.position,
    }));
    expect(destinations.every((position, index) => destinations.slice(index + 1)
      .every((other) => distanceBetween(position, other)
        >= hornets[0]!.radius * 2 + ATTACK_SEPARATION_GAP))).toBe(true);
    const lateralPositions = destinations.map(({ position }) => position.z);
    expect(Math.max(...lateralPositions) - Math.min(...lateralPositions))
      .toBeLessThan(4 * POSITION_SCALE);

    for (let tick = 0; tick < 20; tick += 1) simulation.step();
    expect(simulation.snapshot().every((unit) => unit.attacking && !unit.moving)).toBe(true);
  });

  test("does not leave a ranged attacker moving forever behind an occupied firing line", () => {
    const building: BuildingState = {
      id: "turret-1",
      ownerId: "player-2",
      health: 2_500,
      maxHealth: 2_500,
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
      attackRadius: 1.5 * POSITION_SCALE,
    };
    const hornets = [
      unitAt("hornet-1", -15.3, -1.45, true, 1_309),
      unitAt("hornet-2", -15.3, 1.45, true, 1_309),
      unitAt("hornet-3", -18, 0, true, 1_309),
    ];
    for (const hornet of hornets) {
      hornet.speed = 8.5 * POSITION_SCALE;
      hornet.attackRange = 14 * POSITION_SCALE;
      hornet.attackDamage = 30;
      hornet.attackIntervalTicks = 8;
    }
    const simulation = new LocalUnitSimulation(hornets, [building]);

    simulation.dispatch("player-1", {
      type: "attack",
      unitIds: hornets.map(({ id }) => id),
      targetId: building.id,
    });
    for (let tick = 0; tick < 30; tick += 1) simulation.step();

    const third = simulation.snapshot().find(({ id }) => id === "hornet-3")!;
    expect(third).toMatchObject({ moving: false, attacking: true });
    const position = { ...third.position };
    for (let tick = 0; tick < 10; tick += 1) simulation.step();
    const later = simulation.snapshot().find(({ id }) => id === third.id)!;
    expect(later).toMatchObject({ moving: false, attacking: true });
    expect(distanceBetween(later, { position })).toBeLessThan(0.1 * POSITION_SCALE);
  });

  test("finishes a ranged building approach before switching to attack", () => {
    const building: BuildingState = {
      id: "turret-1",
      ownerId: "player-2",
      health: 2_500,
      maxHealth: 2_500,
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
      attackRadius: 1.5 * POSITION_SCALE,
    };
    const hornets = [
      unitAt("hornet-1", -15.3, -1.3, true, 1_309),
      unitAt("hornet-2", -15.3, 1.3, true, 1_309),
      unitAt("hornet-3", -20, 0, true, 1_309),
    ];
    for (const hornet of hornets) {
      hornet.speed = 8.5 * POSITION_SCALE;
      hornet.attackRange = 14 * POSITION_SCALE;
      hornet.attackDamage = 30;
      hornet.attackIntervalTicks = 8;
    }
    const simulation = new LocalUnitSimulation(hornets, [building]);

    simulation.dispatch("player-1", {
      type: "attack",
      unitIds: hornets.map(({ id }) => id),
      targetId: building.id,
    });
    const rearStates: UnitState[] = [];
    for (let tick = 0; tick < 30; tick += 1) {
      simulation.step();
      rearStates.push(simulation.snapshot().find(({ id }) => id === "hornet-3")!);
    }

    const firstAttack = rearStates.findIndex(({ attacking }) => attacking);
    expect(firstAttack).toBeGreaterThanOrEqual(0);
    expect(rearStates.slice(firstAttack)).toEqual(rearStates.slice(firstAttack).map((unit) =>
      expect.objectContaining({ moving: false, attacking: true })));
  });

  test("lines up Behemoths around a shared attack-ground point", () => {
    const target = toSimPoint(20, 0);
    const behemoths = [-1.55, 1.55].map((z, index) => {
      const behemoth = unitAt(`behemoth-${index + 1}`, 0, z, false, 1_524);
      behemoth.health = behemoth.maxHealth = 900;
      behemoth.speed = 5 * POSITION_SCALE;
      behemoth.attackMinRange = 7 * POSITION_SCALE;
      behemoth.attackRange = 22 * POSITION_SCALE;
      behemoth.attackGroundRadius = 4 * POSITION_SCALE;
      behemoth.attackDamage = 110;
      behemoth.attackIntervalTicks = 30;
      return behemoth;
    });
    const simulation = new LocalUnitSimulation(behemoths);

    simulation.dispatch("player-1", {
      type: "attack-ground",
      unitIds: behemoths.map(({ id }) => id),
      target,
    });
    const ordered = simulation.snapshot();
    expect(ordered[0]).toMatchObject({ attacking: true, moving: false });
    expect(ordered[1]).toMatchObject({ attacking: false, moving: true });
    expect(distanceBetween(ordered[0]!, { position: ordered[1]!.path.at(-1)! }))
      .toBeGreaterThanOrEqual(behemoths[0]!.radius * 2 + ATTACK_SEPARATION_GAP);

    for (let tick = 0; tick < 10; tick += 1) simulation.step();
    expect(simulation.snapshot().every((unit) => unit.attacking && !unit.moving)).toBe(true);
  });

  test("settles a ranged unit just inside its displayed maximum range", () => {
    const building = {
      id: "turret-1",
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
      attackRadius: 1.5 * POSITION_SCALE,
    };
    const hornet = unitAt("hornet-1", -20, 0, true, 1_309);
    hornet.attackRange = UNIT_CATALOG.hornet.attackRange! * POSITION_SCALE;
    const simulation = new LocalUnitSimulation([hornet], [building]);

    expect(simulation.dispatch("player-1", {
      type: "attack",
      unitIds: [hornet.id],
      targetId: building.id,
    }).accepted).toBe(true);
    for (let tick = 0; tick < 30; tick += 1) simulation.step();

    const unit = simulation.snapshot()[0]!;
    expect(unit).toMatchObject({ moving: false, attacking: true, attackTargetId: building.id });
    const distanceToVisibleFootprint = Math.hypot(unit.position.x, unit.position.z)
      - building.attackRadius;
    expect(distanceToVisibleFootprint)
      .toBeCloseTo(hornet.attackRange - 0.15 * POSITION_SCALE, -1);
  });

  test("keeps a ranged unit attacking after nearby units separate from it", () => {
    const building: BuildingState = {
      id: "turret-1",
      ownerId: "player-2",
      health: 2_500,
      maxHealth: 2_500,
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
      attackRadius: 1.5 * POSITION_SCALE,
    };
    const hornet = unitAt("hornet-1", -20, 0, true, 1_309);
    hornet.attackRange = 14 * POSITION_SCALE;
    hornet.attackDamage = 30;
    hornet.attackIntervalTicks = 8;
    const nearbyInfantry = unitAt("ghostrunner-1", -13.8, 0, true, 360);
    const simulation = new LocalUnitSimulation([hornet, nearbyInfantry], [building]);

    simulation.dispatch("player-1", {
      type: "attack",
      unitIds: [hornet.id],
      targetId: building.id,
    });
    for (let tick = 0; tick < 30; tick += 1) simulation.step();

    for (let tick = 0; tick < 10; tick += 1) {
      simulation.step();
      expect(simulation.snapshot().find(({ id }) => id === hornet.id))
        .toMatchObject({ moving: false, attacking: true });
    }
  });

  test("immediately attacks from a valid direct-fire position", () => {
    const building = {
      id: "turret-1",
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
    };
    const hornet = unitAt("hornet-1", -8, 0, true, 1_309);
    hornet.attackRange = UNIT_CATALOG.hornet.attackRange! * POSITION_SCALE;
    const simulation = new LocalUnitSimulation([hornet], [building]);

    expect(simulation.dispatch("player-1", {
      type: "attack",
      unitIds: [hornet.id],
      targetId: building.id,
    }).accepted).toBe(true);
    simulation.step();
    expect(simulation.snapshot()[0]).toMatchObject({
      position: toSimPoint(-8, 0),
      moving: false,
      attacking: true,
    });
  });

  test("keeps multiple in-range Hornets firing from their current positions", () => {
    const building: BuildingState = {
      id: "turret-1",
      ownerId: "player-2",
      health: 2_500,
      maxHealth: 2_500,
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
    };
    const hornets = [-3, 0, 3].map((z, index) => {
      const hornet = unitAt(`hornet-${index + 1}`, -8, z, true, 1_309);
      hornet.attackRange = 14 * POSITION_SCALE;
      hornet.attackDamage = 30;
      return hornet;
    });
    const simulation = new LocalUnitSimulation(hornets, [building]);

    simulation.dispatch("player-1", {
      type: "attack",
      unitIds: hornets.map(({ id }) => id),
      targetId: building.id,
    });

    expect(simulation.snapshot()).toEqual(hornets.map((hornet) => expect.objectContaining({
      id: hornet.id,
      position: hornet.position,
      moving: false,
      attacking: true,
    })));
  });

  test("resolves direct building damage and emits deterministic combat events", () => {
    const building: BuildingState = {
      id: "turret-1",
      ownerId: "player-2",
      health: 100,
      maxHealth: 100,
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
    };
    const hornet = unitAt("hornet-1", -(16 - 0.15), 0, true, 1_309);
    hornet.attackRange = 14 * POSITION_SCALE;
    hornet.attackDamage = 60;
    hornet.attackIntervalTicks = 8;
    const simulation = new LocalUnitSimulation([hornet], [building]);

    expect(simulation.dispatch("player-1", {
      type: "attack",
      unitIds: [hornet.id],
      targetId: building.id,
    }).accepted).toBe(true);
    simulation.step();
    expect(simulation.buildingSnapshot()[0]?.health).toBe(100);
    expect(simulation.drainEvents()).toEqual([
      {
        type: "weapon-fired",
        tick: 1,
        attackerId: hornet.id,
        attack: "direct",
        targetId: building.id,
        target: building.position,
        impactTick: 5,
      },
    ]);

    for (let tick = 0; tick < 4; tick += 1) simulation.step();
    expect(simulation.buildingSnapshot()[0]?.health).toBe(40);
    expect(simulation.drainEvents()).toEqual([expect.objectContaining({
      type: "damage",
      tick: 5,
      targetId: building.id,
      health: 40,
    })]);

    for (let tick = 0; tick < 8; tick += 1) simulation.step();
    expect(simulation.buildingSnapshot()).toEqual([]);
    expect(simulation.drainEvents().map((event) => event.type))
      .toEqual(["weapon-fired", "damage", "building-died"]);
    simulation.step();
    expect(simulation.snapshot()[0]).toMatchObject({ order: "idle", attacking: false });
    const clearedDestination = toSimPoint(8, 0);
    expect(simulation.dispatch("player-1", {
      type: "move",
      unitIds: [hornet.id],
      target: clearedDestination,
    }).accepted).toBe(true);
    expect(simulation.snapshot()[0]?.path).toEqual([clearedDestination]);
  });

  test("freezes command-center elimination after declaring the surviving player", () => {
    const attacker = unitAt("hornet-1", 8, 0, true, 1_309);
    attacker.attackRange = 14 * POSITION_SCALE;
    attacker.attackDamage = 30;
    const playerCenter = matchCommandCenter("player-center", "player-1", -20);
    const enemyCenter = matchCommandCenter("enemy-center", "player-2", 10, 30);
    const simulation = new LocalUnitSimulation(
      [attacker],
      [playerCenter, enemyCenter],
      undefined,
      { commandCenterElimination: ["player-1", "player-2"] },
    );

    expect(simulation.dispatch("player-1", {
      type: "attack",
      unitIds: [attacker.id],
      targetId: enemyCenter.id,
    }).accepted).toBe(true);
    simulation.step();
    simulation.step();

    expect(simulation.matchResult).toEqual({
      winnerId: "player-1",
      defeatedPlayerIds: ["player-2"],
      resolvedTick: 2,
    });
    expect(simulation.dispatch("player-1", {
      type: "move",
      unitIds: [attacker.id],
      target: toSimPoint(20, 0),
    }).accepted).toBe(false);
    const frozenHash = simulation.stateHash();
    simulation.step();
    expect(simulation.currentTick).toBe(2);
    expect(simulation.stateHash()).toBe(frozenHash);
  });

  test("counts a Command Center site but not a surviving Scout against defeat", () => {
    const defender = unitAt("scout-1", 6, 0);
    defender.kind = "scout-drone";
    const attacker = unitAt("hornet-enemy", 8, 0, true, 1_309);
    attacker.ownerId = "player-2";
    attacker.attackRange = 14 * POSITION_SCALE;
    attacker.attackDamage = 30;
    attacker.attackIntervalTicks = 1;
    const playerCenter = matchCommandCenter("player-center", "player-1", 10, 30);
    const replacementSite: BuildingState = {
      ...matchCommandCenter("replacement-site", "player-1", 12, 30),
      lifecycle: "constructing",
      constructionProgress: 0.4,
    };
    const enemyCenter = matchCommandCenter("enemy-center", "player-2", -20);
    const simulation = new LocalUnitSimulation(
      [defender, attacker],
      [playerCenter, replacementSite, enemyCenter],
      undefined,
      { commandCenterElimination: ["player-1", "player-2"] },
    );

    simulation.dispatch("player-2", {
      type: "attack",
      unitIds: [attacker.id],
      targetId: playerCenter.id,
    });
    simulation.step();
    expect(simulation.matchResult).toBeUndefined();

    simulation.dispatch("player-2", {
      type: "attack",
      unitIds: [attacker.id],
      targetId: replacementSite.id,
    });
    simulation.step();
    simulation.step();

    expect(simulation.matchResult).toEqual({
      winnerId: "player-2",
      defeatedPlayerIds: ["player-1"],
      resolvedTick: 3,
    });
    expect(simulation.snapshot().find(({ id }) => id === defender.id)?.health).toBeGreaterThan(0);
  });

  test("draws when both final Command Centers are destroyed on the same tick", () => {
    const playerAttacker = unitAt("hornet-player", 8, 0, true, 1_309);
    playerAttacker.attackRange = 14 * POSITION_SCALE;
    playerAttacker.attackDamage = 30;
    const enemyAttacker = unitAt("hornet-enemy", -8, 0, true, 1_309);
    enemyAttacker.ownerId = "player-2";
    enemyAttacker.attackRange = 14 * POSITION_SCALE;
    enemyAttacker.attackDamage = 30;
    const playerCenter = matchCommandCenter("player-center", "player-1", -10, 30);
    const enemyCenter = matchCommandCenter("enemy-center", "player-2", 10, 30);
    const simulation = new LocalUnitSimulation(
      [playerAttacker, enemyAttacker],
      [playerCenter, enemyCenter],
      undefined,
      { commandCenterElimination: ["player-1", "player-2"] },
    );

    simulation.dispatch("player-1", {
      type: "attack",
      unitIds: [playerAttacker.id],
      targetId: enemyCenter.id,
    });
    simulation.dispatch("player-2", {
      type: "attack",
      unitIds: [enemyAttacker.id],
      targetId: playerCenter.id,
    });
    simulation.step();
    simulation.step();

    expect(simulation.matchResult).toEqual({
      defeatedPlayerIds: ["player-1", "player-2"],
      resolvedTick: 2,
    });
  });

  test("active Turrets turn before firing at the nearest enemy", () => {
    const turret: BuildingState = {
      id: "enemy-turret",
      kind: "turret",
      lifecycle: "active",
      constructionProgress: 1,
      ownerId: "player-2",
      position: toSimPoint(0, 0),
      rotation: 0,
      radius: 1_800,
      attackRadius: 1_500,
      health: 900,
      maxHealth: 900,
    };
    const nearest = unitAt("ghostrunner-nearest", 6, 0);
    const farther = unitAt("ghostrunner-farther", 9, 0);
    const simulation = new LocalUnitSimulation([farther, nearest], [turret]);

    const aimingEvents: ReturnType<typeof simulation.drainEvents> = [];
    for (let tick = 0; tick < 20 && !aimingEvents.some((event) =>
      event.type === "damage"); tick += 1) {
      simulation.step();
      aimingEvents.push(...simulation.drainEvents());
    }

    expect(simulation.snapshot().find((unit) => unit.id === nearest.id)?.health).toBe(115);
    expect(simulation.snapshot().find((unit) => unit.id === farther.id)?.health).toBe(140);
    expect(aimingEvents).toContainEqual(expect.objectContaining({
      type: "weapon-fired",
      attackerId: turret.id,
      targetId: nearest.id,
    }));

    expect(aimingEvents).toContainEqual(expect.objectContaining({
      type: "damage",
      attackerId: turret.id,
      targetId: nearest.id,
      amount: 25,
    }));
  });

  test("applies Turret damage when its projectile reaches the target", () => {
    const turret: BuildingState = {
      id: "enemy-turret",
      kind: "turret",
      lifecycle: "active",
      constructionProgress: 1,
      ownerId: "player-2",
      position: toSimPoint(0, 0),
      rotation: 0,
      radius: 1_800,
      attackRadius: 1_500,
      health: 900,
      maxHealth: 900,
    };
    const target = unitAt("ghostrunner-target", -6, 0);
    target.health = 25;
    const simulation = new LocalUnitSimulation([target], [turret]);

    simulation.step();

    expect(simulation.snapshot()[0]?.health).toBe(25);
    expect(simulation.drainEvents()).toEqual([expect.objectContaining({
      type: "weapon-fired",
      tick: 1,
      attackerId: turret.id,
      targetId: target.id,
      impactTick: 3,
    })]);

    simulation.step();
    expect(simulation.snapshot()[0]?.health).toBe(25);
    expect(simulation.drainEvents()).toEqual([]);

    simulation.step();
    expect(simulation.snapshot()[0]?.health).toBe(0);
    expect(simulation.drainEvents().map((event) => event.type)).toEqual([
      "damage",
      "unit-died",
    ]);
  });

  test("Turrets break equal-distance target ties by stable entity identity", () => {
    const turret: BuildingState = {
      id: "enemy-turret",
      kind: "turret",
      lifecycle: "active",
      constructionProgress: 1,
      ownerId: "player-2",
      position: toSimPoint(0, 0),
      rotation: 0,
      radius: 1_800,
      attackRadius: 1_500,
      health: 900,
      maxHealth: 900,
    };
    const alpha = unitAt("ghostrunner-alpha", 6, 0);
    const beta = unitAt("ghostrunner-beta", -6, 0);
    const simulation = new LocalUnitSimulation([beta, alpha], [turret]);

    simulation.step();

    expect(simulation.buildingSnapshot()[0]?.weapon).toMatchObject({
      targetId: alpha.id,
    });
  });

  test("hold-position guards attack nearby enemies without chasing them", () => {
    const guard = {
      ...unitAt("hornet-guard", 0, 0, false, 1_848),
      ownerId: "player-2",
      guardMode: "hold-position" as const,
      attackRange: 14_000,
      attackDamage: 30,
      attackIntervalTicks: 8,
      facing: Math.PI / 2,
    };
    const intruder = unitAt("ghostrunner-intruder", 10, 0);
    const simulation = new LocalUnitSimulation([intruder, guard]);

    for (let tick = 0; tick < 4; tick += 1) simulation.step();

    expect(simulation.snapshot().find((unit) => unit.id === intruder.id)?.health).toBe(110);
    expect(simulation.snapshot().find((unit) => unit.id === guard.id)).toMatchObject({
      position: toSimPoint(0, 0),
      moving: false,
      attacking: true,
      attackTargetId: intruder.id,
    });
  });

  test("hold-position guards ignore enemies outside their weapon range", () => {
    const guard = {
      ...unitAt("hornet-guard", 0, 0, false, 1_848),
      ownerId: "player-2",
      guardMode: "hold-position" as const,
      attackRange: 14_000,
      attackDamage: 30,
      attackIntervalTicks: 8,
    };
    const intruder = unitAt("ghostrunner-intruder", 20, 0);
    const simulation = new LocalUnitSimulation([guard, intruder]);

    for (let tick = 0; tick < 30; tick += 1) simulation.step();

    expect(simulation.snapshot().find((unit) => unit.id === intruder.id)?.health).toBe(140);
    expect(simulation.snapshot().find((unit) => unit.id === guard.id)).toMatchObject({
      position: toSimPoint(0, 0),
      order: "idle",
      moving: false,
      attacking: false,
      attackTargetId: undefined,
    });
  });

  test("a completed player Turret becomes an active defense", () => {
    const scout = unitAt("scout-1", 0, 0);
    const enemy = unitAt("ghostrunner-enemy", 8, 0);
    enemy.ownerId = "player-2";
    const simulation = new LocalUnitSimulation([scout, enemy]);
    simulation.dispatch("player-1", {
      type: "build",
      unitIds: [scout.id],
      kind: "turret",
      target: toSimPoint(2.7, 0),
      rotation: 0,
    });

    for (let tick = 0; tick < 100; tick += 1) simulation.step();
    expect(simulation.snapshot().find((unit) => unit.id === enemy.id)?.health).toBe(140);
    expect(simulation.buildingSnapshot()[0]).toMatchObject({
      lifecycle: "active",
      weapon: {
        range: 18_000,
        damage: 25,
        intervalTicks: 6,
      },
    });

    for (let tick = 0; tick < 10
      && simulation.snapshot().find((unit) => unit.id === enemy.id)?.health === 140;
      tick += 1) simulation.step();
    expect(simulation.snapshot().find((unit) => unit.id === enemy.id)?.health).toBe(115);
  });

  test("reloads ranged weapons while units are idle", () => {
    const building: BuildingState = {
      id: "turret-1",
      ownerId: "player-2",
      health: 100,
      maxHealth: 100,
      position: toSimPoint(0, 0),
      radius: 2 * POSITION_SCALE,
    };
    const hornet = unitAt("hornet-1", -(16 - 0.15), 0, true, 1_309);
    hornet.attackRange = 14 * POSITION_SCALE;
    hornet.attackDamage = 30;
    hornet.attackCooldownTicks = 2;
    const simulation = new LocalUnitSimulation([hornet], [building]);

    simulation.step();
    simulation.step();
    simulation.dispatch("player-1", {
      type: "attack",
      unitIds: [hornet.id],
      targetId: building.id,
    });
    simulation.step();

    expect(simulation.drainEvents().map((event) => event.type))
      .toEqual(["weapon-fired"]);
  });

  test("resolves direct damage against enemy units", () => {
    const hornet = unitAt("hornet-1", 10 - (14.45 - 0.15), 0, true, 1_309);
    hornet.attackRange = 14 * POSITION_SCALE;
    hornet.attackDamage = 30;
    hornet.attackIntervalTicks = 8;
    const target = unitAt("ghostrunner-1", 10, 0);
    target.ownerId = "player-2";
    const simulation = new LocalUnitSimulation([hornet, target]);

    expect(simulation.dispatch("player-1", {
      type: "attack",
      unitIds: [hornet.id],
      targetId: target.id,
    }).accepted).toBe(true);
    simulation.step();
    for (let tick = 0; tick < 4; tick += 1) simulation.step();

    expect(simulation.snapshot().find((unit) => unit.id === target.id)?.health).toBe(110);
    expect(simulation.drainEvents().map((event) => [event.type, "target" in event && event.target]))
      .toEqual([
        ["weapon-fired", target.position],
        ["damage", "unit"],
      ]);
  });

  test("produces the same state hash and event order from the same command log", () => {
    const first = unitAt("behemoth-1", 0, 0, false, 1_161);
    first.attackMinRange = 2 * POSITION_SCALE;
    first.attackRange = 20 * POSITION_SCALE;
    first.attackGroundRadius = 3 * POSITION_SCALE;
    first.attackDamage = 50;
    const target = unitAt("ghostrunner-1", 10, 0);
    target.ownerId = "player-2";
    const simulations = [
      new LocalUnitSimulation([first, target]),
      new LocalUnitSimulation([target, first]),
    ];

    for (const simulation of simulations) {
      simulation.dispatch("player-1", {
        type: "attack-ground",
        commandId: "attack-1",
        unitIds: [first.id],
        target: target.position,
      });
      for (let tick = 0; tick < 4; tick += 1) simulation.step();
    }

    expect(simulations[0]!.stateHash()).toBe(simulations[1]!.stateHash());
    expect(simulations[0]!.drainEvents()).toEqual(simulations[1]!.drainEvents());
  });

  test("plans a large obstructed formation command within a bounded budget", () => {
    const units = Array.from({ length: 80 }, (_, index) => unitAt(
      `ghostrunner-${index + 1}`,
      -25 + index % 8,
      -10 + Math.floor(index / 8),
    ));
    const buildings: BuildingState[] = Array.from({ length: 20 }, (_, index) => ({
      id: `obstacle-${index + 1}`,
      position: toSimPoint(0, -15 + index * 1.5),
      radius: 550,
    }));
    const simulation = new LocalUnitSimulation(units, buildings);
    const started = performance.now();

    expect(simulation.dispatch("player-1", {
      type: "move",
      unitIds: units.map((unit) => unit.id),
      target: toSimPoint(25, 0),
    }).accepted).toBe(true);

    // Generous enough for loaded CI, but catches rebuilding the obstacle graph per unit.
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  test("stop immediately replaces a movement order", () => {
    const simulation = createSimulation();
    simulation.dispatch("player-1", {
      type: "move",
      unitIds: ["ghostrunner-1"],
      target: toSimPoint(20, 0),
    });
    simulation.step();
    expect(simulation.dispatch("player-1", {
      type: "stop",
      unitIds: ["ghostrunner-1"],
    }).accepted).toBe(true);

    const stopped = simulation.snapshot()[0]!;
    expect(stopped).toMatchObject({ order: "idle", moving: false, attacking: false });
    simulation.step();
    expect(simulation.snapshot()[0]?.position).toEqual(stopped.position);
  });

  test("Behemoth attack ground damages friendly and enemy targets on its cooldown", () => {
    const behemoth = unitAt("behemoth-1", 10 - (22 - 0.15), 0, false, 1_161);
    behemoth.health = behemoth.maxHealth = 900;
    behemoth.attackMinRange = 7 * POSITION_SCALE;
    behemoth.attackRange = 22 * POSITION_SCALE;
    behemoth.attackGroundRadius = 4 * POSITION_SCALE;
    behemoth.attackDamage = 140;
    behemoth.attackIntervalTicks = 20;
    const firstTarget = unitAt("ghostrunner-1", 10, 0);
    const secondTarget = unitAt("hornet-1", 12, 0);
    secondTarget.health = secondTarget.maxHealth = 180;
    const safeUnit = unitAt("ghostrunner-3", 15, 0);
    const building: BuildingState = {
      id: "turret-1",
      ownerId: "player-2",
      health: 280,
      maxHealth: 280,
      position: toSimPoint(15, 0),
      radius: 2 * POSITION_SCALE,
    };
    const friendlyBuilding: BuildingState = {
      ...building,
      id: "turret-2",
      ownerId: "player-1",
      position: toSimPoint(10, 1),
    };
    const simulation = new LocalUnitSimulation([
      behemoth,
      firstTarget,
      secondTarget,
      safeUnit,
    ], [building, friendlyBuilding]);

    expect(simulation.dispatch("player-1", {
      type: "attack-ground",
      unitIds: [behemoth.id],
      target: toSimPoint(10, 0),
    }).accepted).toBe(true);
    simulation.step();

    let byId = new Map(simulation.snapshot().map((unit) => [unit.id, unit]));
    expect(byId.get(firstTarget.id)?.health).toBe(140);
    expect(byId.get(secondTarget.id)?.health).toBe(180);
    expect(simulation.drainEvents().map((event) => event.type)).toEqual(["weapon-fired"]);

    const flightDistance = Math.hypot(
      behemoth.position.x - 10 * POSITION_SCALE,
      behemoth.position.z,
    ) / POSITION_SCALE;
    const volleySeed = behemothVolleySeed(behemoth.id, 1);
    const impactDelay = behemothImpactDelayTicks(flightDistance, volleySeed, 0.1);
    expect(impactDelay).toBe(
      Math.max(1, Math.ceil(behemothFirstImpactSeconds(flightDistance, volleySeed) / 0.1) - 1)
        + 1,
    );
    for (let tick = 1; tick < impactDelay; tick += 1) simulation.step();
    expect(simulation.snapshot().find(({ id }) => id === firstTarget.id)?.health).toBe(140);
    simulation.step();

    byId = new Map(simulation.snapshot().map((unit) => [unit.id, unit]));
    expect(byId.get(firstTarget.id)?.health).toBe(0);
    expect(byId.get(secondTarget.id)?.health).toBe(40);
    expect(byId.get(safeUnit.id)?.health).toBe(140);
    expect(simulation.buildingSnapshot().find(({ id }) => id === building.id)?.health).toBe(140);
    expect(simulation.buildingSnapshot().find(({ id }) => id === friendlyBuilding.id)?.health)
      .toBe(140);
    for (let tick = 0; tick < 19; tick += 1) simulation.step();
    expect(simulation.snapshot().find((unit) => unit.id === secondTarget.id)?.health).toBe(40);
    simulation.step();
    expect(simulation.snapshot().find((unit) => unit.id === secondTarget.id)?.health).toBe(0);
    expect(simulation.buildingSnapshot().filter(({ id }) =>
      id === building.id || id === friendlyBuilding.id
    )).toEqual([]);
  });

  test("moving while a Behemoth is still turning cancels the uncommitted attack", () => {
    const behemoth = unitAt("behemoth-1", -12, 0, false, 1_161);
    behemoth.health = behemoth.maxHealth = 900;
    behemoth.facing = -Math.PI / 2;
    behemoth.attackMinRange = 7 * POSITION_SCALE;
    behemoth.attackRange = 22 * POSITION_SCALE;
    behemoth.attackGroundRadius = 4 * POSITION_SCALE;
    behemoth.attackDamage = 140;
    behemoth.attackIntervalTicks = 20;
    const target = unitAt("ghostrunner-1", 0, 0);
    const simulation = new LocalUnitSimulation([behemoth, target]);

    expect(simulation.dispatch("player-1", {
      type: "attack-ground",
      unitIds: [behemoth.id],
      target: target.position,
    }).accepted).toBe(true);
    simulation.step();
    expect(simulation.drainEvents()).toEqual([]);

    expect(simulation.dispatch("player-1", {
      type: "move",
      unitIds: [behemoth.id],
      target: toSimPoint(-18, 0),
    }).accepted).toBe(true);
    for (let tick = 0; tick < 30; tick += 1) simulation.step();

    expect(simulation.snapshot().find(({ id }) => id === target.id)?.health).toBe(140);
    expect(simulation.drainEvents()).toEqual([]);
  });

  test("Behemoth backs out to its minimum range before attacking ground", () => {
    const behemoth = unitAt("behemoth-1", 0, 0, false, 1_161);
    behemoth.health = behemoth.maxHealth = 900;
    behemoth.attackMinRange = 7 * POSITION_SCALE;
    behemoth.attackRange = 22 * POSITION_SCALE;
    behemoth.attackGroundRadius = 4 * POSITION_SCALE;
    behemoth.attackDamage = 140;
    const target = unitAt("ghostrunner-1", 2, 0);
    target.ownerId = "player-2";
    const simulation = new LocalUnitSimulation([behemoth, target]);

    expect(simulation.dispatch("player-1", {
      type: "attack-ground",
      unitIds: [behemoth.id],
      target: toSimPoint(2, 0),
    }).accepted).toBe(true);
    expect(simulation.snapshot().find((unit) => unit.id === behemoth.id)?.moving).toBe(true);
    for (let tick = 0; tick < 25; tick += 1) simulation.step();

    const byId = new Map(simulation.snapshot().map((unit) => [unit.id, unit]));
    const settled = byId.get(behemoth.id)!;
    expect(Math.hypot(settled.position.x - 2 * POSITION_SCALE, settled.position.z))
      .toBeCloseTo(7 * POSITION_SCALE + 0.15 * POSITION_SCALE, -1);
    expect(settled).toMatchObject({ moving: false, attacking: true });
    expect(byId.get(target.id)?.health).toBe(0);
  });

});
