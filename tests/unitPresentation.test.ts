import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { sampleHeight, type GeneratedMap } from "../src/map";
import type { MatchFrame, MatchSession } from "../src/matchSession";
import {
  POSITION_SCALE,
  toSimPoint,
  type BuildingState,
  type DispatchResult,
  type PlayerCommand,
  type UnitState,
} from "../src/sim/units";
import { pickSurface, selectableEntityId } from "../src/unitInput";
import { UnitSystem, createHealthBar, updateHealthBar, type UnitPresentationOptions, type UnitSpawn } from "../src/unitSystem";
import type { OreModelLoader } from "../src/orePresentation";

const map = {
  size: 100,
  segments: 1,
  heights: new Float32Array(4),
} as GeneratedMap;

const options: UnitPresentationOptions = {
  terrainAlignment: 0,
  turnResponsiveness: 50,
  selectionRing: { radius: 1, offset: { x: 0, z: 0 } },
  selectionHitbox: { radius: 1, height: 1, offset: { x: 0, y: 0.5, z: 0 } },
};

const unit = (kind: UnitSpawn["kind"]): UnitState => ({
  id: `${kind}-1`,
  kind,
  ownerId: "local-player",
  health: 100,
  maxHealth: 100,
  pushable: true,
  radius: POSITION_SCALE,
  speed: 5 * POSITION_SCALE,
  attackRange: kind === "hornet" ? 14 * POSITION_SCALE : undefined,
  attackDamage: 20,
  attackIntervalTicks: 8,
  attackCooldownTicks: 0,
  position: { x: 0, z: 0 },
  target: { x: 10 * POSITION_SCALE, z: 0 },
  path: [],
  order: "attack",
  moving: false,
  attacking: true,
  attackTargetId: "building-1",
});

const activeBuilding = (
  id = "building-1",
  kind: BuildingState["kind"] = "turret",
  overrides: Partial<BuildingState> = {},
): BuildingState => ({
  id,
  kind,
  lifecycle: "active",
  constructionProgress: 1,
  ownerId: "enemy-player",
  position: { x: 10 * POSITION_SCALE, z: 2 * POSITION_SCALE },
  rotation: Math.PI / 4,
  radius: 2 * POSITION_SCALE,
  attackRadius: 1.5 * POSITION_SCALE,
  health: 2_500,
  maxHealth: 2_500,
  ...overrides,
});

/** A stand-in for the scaffold kit model: every piece is a plain box of about the real size. */
const scaffoldKit = async () => {
  const kit = new THREE.Group();
  kit.name = "ScaffoldKit";
  kit.userData = { bay: 1.6, lift: 1.8, post_top: 1.885, jack_top: 0.25 };
  const material = new THREE.MeshStandardMaterial();
  const sizes: Record<string, [number, number, number]> = {
    Post: [0.15, 1.8, 0.15],
    Rail: [1.6, 0.1, 0.1],
    Brace: [1.6, 0.1, 0.1],
    Foot: [0.36, 0.25, 0.36],
    Pad: [1.6, 0.06, 1.6],
    PadCut: [1.6, 0.06, 1.6],
    Curb: [1.6, 0.26, 0.22],
    Beacon: [0.17, 0.22, 0.17],
  };
  for (const [name, [width, height, depth]] of Object.entries(sizes)) {
    const geometry = new THREE.BoxGeometry(width, height, depth).translate(width / 2, height / 2, depth / 2);
    const piece = new THREE.Mesh(geometry, material);
    piece.name = `Scaffold${name}`;
    kit.add(piece);
  }
  return kit;
};

/** Resolves once a site placed in this turn has been given its scaffold. */
const kitLoaded = () => new Promise((resolve) => setTimeout(resolve));

/** What a click selects when its ray runs from `from` towards `towards`. */
const clicked = (system: UnitSystem, world: THREE.Group, from: THREE.Vector3, towards: THREE.Vector3) => {
  world.updateMatrixWorld(true);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  if (from.x === towards.x && from.z === towards.z) camera.up.set(0, 0, -1);
  camera.position.copy(from);
  camera.lookAt(towards);
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(), camera);
  return selectableEntityId(pickSurface(ray.intersectObjects(system.selectables, true))?.object);
};

/** What a click straight down onto the world point (x, z) selects. */
const clickedFromAbove = (system: UnitSystem, world: THREE.Group, x: number, z: number) =>
  clicked(system, world, new THREE.Vector3(x, 50, z), new THREE.Vector3(x, 0, z));

const createTurretHead = () => {
  const head = new THREE.Group();
  head.name = "TurretHead";
  const muzzle = new THREE.Object3D();
  muzzle.name = "TurretMuzzle";
  muzzle.position.set(-1.585, 0.42, 0);
  head.add(muzzle);
  return head;
};

class TestSession implements MatchSession {
  readonly frames: MatchFrame[];
  readonly commands: PlayerCommand[] = [];
  readonly results = new Map<string, DispatchResult>();
  submissionStatus: "accepted" | "queued" = "accepted";

  constructor(frame: MatchFrame) {
    this.frames = [frame];
  }

  submit(command: PlayerCommand) {
    this.commands.push(structuredClone(command));
    return { commandId: "test", status: this.submissionStatus };
  }

  commandResult(commandId: string) {
    return this.results.get(commandId);
  }

  advance() {}

  readFrame(afterVersion: number) {
    while (this.frames[0] && this.frames[0].version <= afterVersion) this.frames.shift();
    return this.frames.shift();
  }
}

const frame = (
  version: number,
  unitState: UnitState | readonly UnitState[],
  building: BuildingState | readonly BuildingState[],
  events: MatchFrame["events"] = [],
): MatchFrame => ({
  version,
  tick: version - 1,
  full: true,
  units: structuredClone(Array.isArray(unitState) ? unitState : [unitState]),
  buildings: structuredClone(Array.isArray(building) ? building : [building]),
  events,
});

const spawn = (state: UnitState): UnitSpawn => ({
  id: state.id,
  kind: state.kind,
  x: 0,
  z: 0,
  health: state.health,
  radius: 1,
  speed: 5,
  attackRange: state.attackRange && state.attackRange / POSITION_SCALE,
});

test("gather orders affect only owned selected Scouts and reject exhausted ore", () => {
  const scout = { ...unit("scout-drone"), order: "idle" as const, attacking: false };
  const enemy = { ...scout, id: "enemy-scout", ownerId: "enemy-player" };
  const soldier = unit("ghostrunner");
  const deposit = { id: "ore-1", position: toSimPoint(5, 0), radius: 3000, amount: 200, initialAmount: 200 };
  const initial = { ...frame(1, [scout, enemy, soldier], []), titaniumDeposits: [deposit] };
  const session = new TestSession(initial);
  const system = new UnitSystem(new THREE.Group(), map, [], [], session);
  system.attachScoutDrone(scout.id, new THREE.Group(), new THREE.Group(), options);
  system.attachScoutDrone(enemy.id, new THREE.Group(), new THREE.Group(), options);
  system.attachGhostrunner(soldier.id, new THREE.Group(), [], options);
  system.select([scout.id, enemy.id, soldier.id]);
  expect(system.gatherSelected(deposit.id)).toBe(true);
  expect(session.commands).toEqual([{ type: "gather", unitIds: [scout.id], depositId: deposit.id }]);
  session.frames.push({ ...frame(2, [scout, enemy, soldier], []), titaniumDeposits: [{ ...deposit, amount: 0 }] });
  system.update(0);
  expect(system.gatherSelected(deposit.id)).toBe(false);
  expect(session.commands).toHaveLength(1);
  session.frames.push({ ...frame(3, [{ ...scout, cargoTitanium: 6 }, enemy, soldier], []), titaniumDeposits: [{ ...deposit, amount: 0 }] });
  system.update(0);
  expect(system.gatherSelected(deposit.id)).toBe(true);
  expect(session.commands).toHaveLength(2);
  system.dispose();
});

// A box of rock scaled to the deposit's 3 m footprint: flat faces 2.12 m from its centre, 1.65 m tall.
const boxRock: OreModelLoader = async () => {
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(10, 4, 10).translate(0, 2, 0), new THREE.MeshStandardMaterial()));
  return [model];
};
const ROCK_FACE = 3 / Math.SQRT2;
const ROCK_TOP = 4 * 3 / (5 * Math.SQRT2) - 0.05;

/**
 * Scouts extracting from one deposit, standing 4.5 m out along +x, -x, +z and -z in turn. They
 * have turned to face it, unless `facing` is false.
 */
const miningScene = async (scoutCount = 1, facing = true) => {
  const deposit = { id: "ore-1", position: toSimPoint(0, 0), radius: 3000, amount: 200, initialAmount: 200 };
  const scouts = Array.from({ length: scoutCount }, (_, index) => {
    const position = toSimPoint(Math.round(Math.cos(index * Math.PI / 2)) * 4.5, Math.round(Math.sin(index * Math.PI / 2)) * 4.5);
    return {
      ...unit("scout-drone"), id: `scout-drone-${index + 1}`, attacking: false, attackTargetId: undefined,
      order: "gather" as const, position, target: position, cargoTitanium: 2,
      harvest: { depositId: deposit.id, phase: "extracting" as const, workPosition: position },
    } satisfies UnitState as UnitState;
  });
  const session = new TestSession({ ...frame(1, scouts, []), titaniumDeposits: [deposit] });
  const world = new THREE.Group();
  const system = new UnitSystem(
    world, { ...map, titaniumDeposits: [deposit] } as GeneratedMap, [], [], session, undefined, undefined, boxRock,
  );
  for (const scout of scouts) system.attachScoutDrone(scout.id, new THREE.Group(), new THREE.Group(), options);
  await new Promise(resolve => setTimeout(resolve));
  if (facing) system.update(0.1);
  let version = 1;
  return {
    deposit, scouts, system, world,
    laser: (id = "scout-drone-1") => system.inspect().units.find(candidate => candidate.id === id)?.miningLaser,
    lasersDrawn: () => world.getObjectByName("Scout mining lasers")?.visible,
    /** Delivers the scouts and deposit as they now stand, as the next simulation frame. */
    advance: () => {
      version += 1;
      session.frames.push({ ...frame(version, scouts, []), titaniumDeposits: [deposit] });
      system.update(0.1);
    },
  };
};

test("a Scout extracting Titanium fires a laser from its body onto the rock face", async () => {
  const { system, world, laser, lasersDrawn } = await miningScene();
  system.update(0.1);
  const beam = laser();
  expect(lasersDrawn()).toBe(true);
  expect(beam).toBeDefined();
  // It leaves the drone, which stands at x 4.5 and faces the rock, and ends on the face, not in or past it.
  expect(beam!.from[0]).toBeGreaterThan(3.5);
  expect(beam!.from[0]).toBeLessThan(4.5);
  expect(beam!.to[0]).toBeCloseTo(ROCK_FACE, 4);
  expect(beam!.to[2]).toBeCloseTo(0, 1);
  expect(world.getObjectByName("Scout mineral cutter")).toBeUndefined();
  system.dispose();
});

test("the laser waits until the Scout has turned to face the rock", async () => {
  const { system, laser } = await miningScene(1, false);
  system.update(0.005);
  expect(laser()).toBeUndefined();
  system.update(0.1);
  expect(laser()).toBeDefined();
  system.dispose();
});

test("the laser's contact sweeps up and down the rock face and never leaves it", async () => {
  const { system, laser } = await miningScene();
  const heights: number[] = [];
  for (let step = 0; step < 60; step += 1) {
    system.update(0.05);
    const beam = laser()!;
    expect(beam.to[0]).toBeCloseTo(ROCK_FACE, 4);
    heights.push(beam.to[1]);
  }
  expect(Math.min(...heights)).toBeGreaterThan(0.1);
  expect(Math.min(...heights)).toBeLessThan(0.35);
  expect(Math.max(...heights)).toBeGreaterThan(ROCK_TOP - 0.25);
  expect(Math.max(...heights)).toBeLessThan(ROCK_TOP + 0.001);
  const turns = heights.slice(2).filter((height, index) =>
    Math.sign(height - heights[index + 1]!) !== Math.sign(heights[index + 1]! - heights[index]!));
  expect(turns.length).toBeGreaterThanOrEqual(2);
  system.dispose();
});

test("drones mining one deposit do not sweep in step", async () => {
  const { system, laser } = await miningScene(2);
  let widestGap = 0;
  for (let step = 0; step < 40; step += 1) {
    system.update(0.05);
    widestGap = Math.max(widestGap, Math.abs(laser("scout-drone-1")!.to[1] - laser("scout-drone-2")!.to[1]));
  }
  expect(widestGap).toBeGreaterThan(0.4);
  system.dispose();
});

describe("the mining laser stops when", () => {
  const endings: Record<string, (scene: Awaited<ReturnType<typeof miningScene>>) => void> = {
    "the cargo is full": ({ scouts, deposit }) => Object.assign(scouts[0]!, {
      cargoTitanium: 20, moving: true,
      harvest: { depositId: deposit.id, phase: "to-dropoff", dropoffId: "home", workPosition: toSimPoint(-8, 0) },
    }),
    "the Scout gets a new order": ({ scouts }) => Object.assign(scouts[0]!, {
      order: "move", moving: true, harvest: undefined,
    }),
    "the Scout is destroyed": ({ scouts }) => Object.assign(scouts[0]!, { health: 0 }),
    "the deposit runs out": ({ scouts, deposit }) => {
      deposit.amount = 0;
      Object.assign(scouts[0]!, { order: "idle", harvest: undefined });
    },
  };
  for (const [ending, apply] of Object.entries(endings)) {
    test(ending, async () => {
      const scene = await miningScene();
      scene.system.update(0.1);
      expect(scene.laser()).toBeDefined();
      apply(scene);
      scene.advance();
      expect(scene.laser()).toBeUndefined();
      expect(scene.lasersDrawn()).toBe(false);
      scene.system.dispose();
    });
  }
});

test("authoritative mining and hauling show different physical work states and delivered stock", () => {
  const scout = unit("scout-drone");
  scout.attacking = false;
  scout.order = "gather";
  scout.cargoTitanium = 2;
  scout.harvest = { depositId: "ore-1", phase: "extracting", workPosition: toSimPoint(0, 0) };
  const deposit = { id: "ore-1", position: toSimPoint(5, 0), radius: 3000, amount: 198, initialAmount: 200 };
  const initial = { ...frame(1, scout, []), titaniumDeposits: [deposit], playerTitanium: { "local-player": 0 } };
  const session = new TestSession(initial);
  const world = new THREE.Group();
  const system = new UnitSystem(world, map, [], [], session);
  const root = new THREE.Group();
  system.attachScoutDrone(scout.id, root, new THREE.Group(), options);
  system.select([scout.id]);
  system.update(0.1);
  expect(system.selectedUnits()[0]?.harvest?.phase).toBe("extracting");
  expect(world.getObjectByName("Construction beam")?.visible).toBe(false);
  expect(root.getObjectByName("Titanium cargo")?.visible).toBe(true);
  expect(system.selectedGroups()[0]?.cargoTitanium).toBe(2);
  scout.cargoTitanium = 20;
  scout.moving = true;
  scout.harvest = { depositId: deposit.id, phase: "to-dropoff", dropoffId: "home", workPosition: toSimPoint(-8, 0) };
  session.frames.push({ ...frame(2, scout, []), titaniumDeposits: [deposit] });
  system.update(0.1);
  expect(root.getObjectByName("Titanium cargo")?.visible).toBe(true);
  expect(system.selectedUnits()[0]?.harvest?.phase).toBe("to-dropoff");
  scout.cargoTitanium = 0;
  scout.harvest = { depositId: deposit.id, phase: "to-deposit", workPosition: toSimPoint(0, 0) };
  session.frames.push({ ...frame(3, scout, []), playerTitanium: { "local-player": 20 } });
  system.update(0.1);
  expect(root.getObjectByName("Titanium cargo")?.visible).toBe(false);
  expect(system.titanium).toBe(20);
  system.dispose();
});

describe("unit presentation timing", () => {
  test("damaged health fills stay aligned with their backing at every unit rotation", () => {
    const parent = new THREE.Group();
    const bar = createHealthBar(3, 2.4);
    parent.add(bar.root);
    for (const health of [100, 65, 10, 1, 0]) {
      updateHealthBar(bar, health, 100, true);
      for (const rotation of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
        parent.rotation.set(.2, rotation, -.15);
        parent.updateMatrixWorld(true);
        expect(bar.fill.getWorldPosition(new THREE.Vector3()).distanceTo(
          bar.root.getWorldPosition(new THREE.Vector3()),
        )).toBeLessThan(.00001);
        if (health > 0) expect(-bar.fill.center.x * bar.fill.scale.x).toBeCloseTo(-.5);
      }
    }
  });

  test("ground attack feedback survives worker delay and stays at the ground coordinate", () => {
    const artillery = unit("behemoth");
    artillery.order = "idle";
    artillery.attacking = false;
    const enemy = unit("ghostrunner");
    enemy.ownerId = "enemy-player";
    const session = new TestSession(frame(1, [artillery, enemy], []));
    session.submissionStatus = "queued";
    const world = new THREE.Group();
    const system = new UnitSystem(world, map, [spawn(artillery)], [], session);
    const root = new THREE.Group();
    const visual = new THREE.Group();
    for (const name of ["TrackBeltXNegative", "TrackBeltXPositive"]) {
      const belt = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ map: new THREE.Texture() }),
      );
      belt.name = name;
      visual.add(belt);
    }
    root.add(visual);
    world.add(root);
    system.attachBehemoth(artillery.id, root, visual, options);
    system.select([artillery.id]);
    expect(system.attackGroundSelected(12, 7)).toBe(true);
    system.update(.15);
    const marker = world.getObjectByName("Ground attack target")!;
    expect(marker.visible).toBe(true);
    expect(world.getObjectByName("Attack feedback")?.visible).toBe(false);
    artillery.order = "attack-ground";
    artillery.attackTargetId = undefined;
    artillery.attackGroundTarget = toSimPoint(12, 7);
    artillery.attacking = true;
    session.frames.push(frame(2, [artillery, enemy], []));
    system.update(.1);
    enemy.position = toSimPoint(30, 30);
    session.frames.push(frame(3, [artillery, enemy], []));
    system.update(2);
    expect(marker.visible).toBe(true);
    expect(marker.position.x).toBe(12);
    expect(marker.position.z).toBe(7);
    expect(system.selectedUnits()[0]?.attackTargetId).toBeUndefined();
    system.select();
    system.update(0);
    expect(marker.visible).toBe(false);
    system.select([artillery.id]);
    system.update(0);
    expect(marker.visible).toBe(true);
    artillery.order = "idle";
    artillery.attackGroundTarget = undefined;
    session.frames.push(frame(4, [artillery, enemy], []));
    system.update(0);
    expect(marker.visible).toBe(false);
  });

  test("enemy units are inspectable but cannot receive local orders", () => {
    const enemy = unit("ghostrunner");
    enemy.ownerId = "enemy-player";
    const session = new TestSession(frame(1, enemy, []));
    const system = new UnitSystem(new THREE.Group(), map, [spawn(enemy)], [], session);
    const root = new THREE.Group();
    system.attachGhostrunner(enemy.id, root, [new THREE.AnimationClip("Idle", 1, [])], options);
    system.select([enemy.id]);
    expect(system.selectedUnits()).toHaveLength(1);
    expect(system.selectedCommandableUnits()).toHaveLength(0);
    expect(system.moveSelected(5, 5)).toBe(false);
    expect(system.stopSelected()).toBe(false);
    expect(system.attackSelected("building-1")).toBe(false);
    expect(system.attackGroundSelected(5, 5)).toBe(false);
    expect(session.commands).toHaveLength(0);
  });

  test("creates a trained unit model from a later authoritative frame", async () => {
    const session = new TestSession(frame(1, [], []));
    const world = new THREE.Group();
    const loadedKinds: UnitState["kind"][] = [];
    const system = new UnitSystem(
      world,
      map,
      [],
      [],
      session,
      undefined,
      async (state) => {
        loadedKinds.push(state.kind);
        const root = new THREE.Group();
        root.name = `${state.kind} trained model`;
        const visual = new THREE.Group();
        root.add(visual);
        return { root, visual, animations: [], options };
      },
    );
    const trained = {
      ...unit("hornet"),
      id: "local-player-hornet-1",
      position: toSimPoint(4, 2),
      target: toSimPoint(4, 2),
      order: "idle" as const,
      moving: false,
      attacking: false,
      attackTargetId: undefined,
    };

    session.frames.push(frame(2, trained, []));
    system.update(0);
    await Promise.resolve();

    const root = world.getObjectByName("hornet trained model");
    expect(loadedKinds).toEqual(["hornet"]);
    expect(root?.userData.unitId).toBe(trained.id);
    expect(root?.position.x).toBe(4);
    expect(root?.position.z).toBe(2);
    expect(system.selectables).toContain(root!);
  });

  test("falls back to a selectable trained unit when its model fails to load", async () => {
    const session = new TestSession(frame(1, [], []));
    const world = new THREE.Group();
    const system = new UnitSystem(
      world,
      map,
      [],
      [],
      session,
      undefined,
      async () => Promise.reject(new Error("asset unavailable")),
    );
    const trained = {
      ...unit("scout-drone"),
      id: "local-player-scout-drone-2",
      order: "idle" as const,
      moving: false,
      attacking: false,
      attackTargetId: undefined,
    };

    session.frames.push(frame(2, trained, []));
    system.update(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fallback = world.getObjectByName("Unit fallback");
    expect(fallback?.userData.unitId).toBe(trained.id);
    expect(fallback?.visible).toBe(true);
    expect(system.selectables).toContain(fallback!);
  });

  test("submits production and rally commands for one selected friendly Command Center", () => {
    const commandCenter = activeBuilding("command-center-1", "command-center", {
      ownerId: "local-player",
      productionQueue: [{
        id: "training-1",
        kind: "hornet",
        progressTicks: 50,
        totalTicks: 200,
      }],
      rallyPoint: toSimPoint(12, 4),
    });
    const session = new TestSession(frame(1, [], commandCenter));
    const world = new THREE.Group();
    const system = new UnitSystem(
      world,
      map,
      [],
      [],
      session,
      () => new THREE.Group(),
    );
    system.select([commandCenter.id]);

    expect(system.selectedCommandCenter()).toMatchObject({
      id: commandCenter.id,
      productionQueue: [expect.objectContaining({ id: "training-1", kind: "hornet" })],
    });
    expect(world.getObjectByName("Rally point")).toMatchObject({
      visible: true,
      position: expect.objectContaining({ x: 12, z: 4 }),
    });
    expect(system.trainSelected("behemoth")).toBe(true);
    expect(system.cancelTrainingSelected("training-1")).toBe(true);
    expect(system.setRallyPointSelected(18, 6)).toBe(true);
    expect(session.commands).toEqual([
      { type: "train", buildingId: commandCenter.id, kind: "behemoth" },
      { type: "cancel-training", buildingId: commandCenter.id, itemId: "training-1" },
      { type: "set-rally-point", buildingId: commandCenter.id, target: toSimPoint(18, 6) },
    ]);
  });

  test("clears selection and rejects presentation commands after an authoritative result", () => {
    const ghostrunner = unit("ghostrunner");
    const session = new TestSession(frame(1, ghostrunner, []));
    const system = new UnitSystem(new THREE.Group(), map, [spawn(ghostrunner)], [], session);
    system.attachGhostrunner(ghostrunner.id, new THREE.Group(), [
      new THREE.AnimationClip("Idle", 1, []),
      new THREE.AnimationClip("Female_Throwing_Stance_Charge_inplace", 1, []),
      new THREE.AnimationClip("Attack", 1, []),
    ], options);
    system.select([ghostrunner.id]);

    const matchResult = {
      winnerId: "enemy-player",
      defeatedPlayerIds: ["local-player"],
      resolvedTick: 1,
    };
    session.frames.push({ ...frame(2, ghostrunner, []), matchResult });
    system.update(0);

    expect(system.matchResult).toEqual(matchResult);
    expect(system.matchOutcome).toBe("defeat");
    expect(system.selectedUnits()).toEqual([]);
    expect(system.moveSelected(4, 0)).toBe(false);
    expect(system.select([ghostrunner.id])).toBe(0);
    expect(session.commands).toEqual([]);
  });

  test("previews Scout construction and builds the site up from the ground inside a scaffold", async () => {
    const scout = unit("scout-drone");
    const session = new TestSession(frame(1, scout, []));
    const world = new THREE.Group();
    const finished = new THREE.MeshStandardMaterial();
    const system = new UnitSystem(
      world,
      map,
      [spawn(scout)],
      [],
      session,
      (state) => {
        const root = new THREE.Group();
        root.name = `${state.kind} construction`;
        // Three metres tall, standing on the ground.
        const model = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2).translate(0, 1.5, 0), finished);
        model.name = "Building model mesh";
        root.add(model);
        return root;
      },
      undefined,
      undefined,
      scaffoldKit,
    );
    const scoutRoot = new THREE.Group();
    system.attachScoutDrone(scout.id, scoutRoot, new THREE.Group(), options);
    system.select([scout.id]);

    expect(system.previewConstruction("turret", 0, 0)).toBe(false);
    expect(system.previewConstruction("turret", 3, 0)).toBe(true);
    expect(world.getObjectByName("Construction placement")?.visible).toBe(true);
    expect(system.buildSelected("turret", 3, 0)).toBe(true);
    expect(session.commands).toEqual([expect.objectContaining({
      type: "build",
      unitIds: [scout.id],
      kind: "turret",
      target: { x: 3 * POSITION_SCALE, z: 0 },
    })]);

    const site = activeBuilding("turret-site", "turret", {
      lifecycle: "constructing",
      constructionProgress: 0,
      ownerId: "local-player",
      health: 1,
      maxHealth: 900,
      builderId: scout.id,
      position: { x: 3 * POSITION_SCALE, z: 0 },
      weapon: {
        range: 18 * POSITION_SCALE,
        damage: 25,
        intervalTicks: 6,
        cooldownTicks: 0,
        facing: 0,
      },
    });
    const travellingScout = structuredClone(scout);
    travellingScout.order = "build";
    travellingScout.attacking = false;
    travellingScout.moving = true;
    travellingScout.constructionTargetId = site.id;
    travellingScout.target = { ...site.position };
    session.frames.push(frame(2, travellingScout, site));
    system.update(0);
    await kitLoaded();
    system.update(0);
    const model = world.getObjectByName("turret construction")!.getObjectByName("Building model mesh") as THREE.Mesh;
    const beam = world.getObjectByName("Construction beam") as THREE.Line;
    // Nothing is built yet, so the site is clicked through its scaffold and pad alone.
    expect(beam.visible).toBe(false);
    expect(clickedFromAbove(system, world, 3.3, 0.4)).toBe(site.id);
    expect(clickedFromAbove(system, world, 9, 0.4)).toBeUndefined();

    const workingScout = structuredClone(travellingScout);
    workingScout.moving = false;
    const quarterBuilt = { ...structuredClone(site), constructionProgress: 0.25, health: 225 };
    session.frames.push(frame(3, workingScout, quarterBuilt));
    system.update(0);
    session.frames.push(frame(4, workingScout, { ...quarterBuilt, constructionProgress: 0.35, health: 315 }));
    system.update(0);
    // The model is never stretched: it is cut off at the height built so far, where the beam ends.
    expect(model.parent!.scale.y).toBe(1);
    expect(model.material).not.toBe(finished);
    expect(beam.visible).toBe(true);
    expect(beam.geometry.getAttribute("position").getY(1)).toBeCloseTo(0.75);
    // Between two simulation ticks the cut keeps rising.
    system.update(0.05);
    expect(beam.geometry.getAttribute("position").getY(1)).toBeCloseTo(0.9);
    expect(clickedFromAbove(system, world, 3.3, 0.4)).toBe(site.id);
    // The model is clicked only where it is built: below the cut at 0.9 m, not above it.
    const levelWith = (height: number) =>
      clicked(system, world, new THREE.Vector3(3.5, height, 30), new THREE.Vector3(3.5, height, 0));
    expect(levelWith(0.6)).toBe(site.id);
    expect(levelWith(2.4)).toBeUndefined();
    system.select([site.id]);
    expect(world.getObjectByName("Turret attack range")?.visible).toBe(false);
    expect(system.selectedBuildings()[0]).toMatchObject({
      lifecycle: "constructing",
      constructionProgress: 0.35,
      builderId: scout.id,
    });
    system.select([scout.id]);
    expect(system.resumeConstructionSelected(site.id)).toBe(true);
    expect(session.commands[1]).toEqual(expect.objectContaining({
      type: "resume-construction",
      unitIds: [scout.id],
      buildingId: site.id,
    }));

    const completed = structuredClone(site);
    completed.lifecycle = "active";
    completed.constructionProgress = 1;
    completed.health = completed.maxHealth;
    completed.builderId = undefined;
    session.frames.push(frame(5, scout, completed));
    system.update(0);
    // Complete: the untouched model from the first frame, while the scaffold is still leaving.
    expect(model.material).toBe(finished);
    expect(beam.visible).toBe(false);
    expect(clickedFromAbove(system, world, 4.08, 0.4)).toBe(site.id);
    system.update(1);
    // A second later nothing of the site is left around the building.
    expect(clickedFromAbove(system, world, 4.08, 0.4)).toBeUndefined();
    expect(clickedFromAbove(system, world, 3.3, 0.4)).toBe(site.id);
    system.select([completed.id]);
    expect(world.getObjectByName("Turret attack range")?.visible).toBe(true);
  });

  test("drops the scaffold and fades a half-built site destroyed before completion", async () => {
    const ghostrunner = unit("ghostrunner");
    const session = new TestSession(frame(1, ghostrunner, []));
    const world = new THREE.Group();
    const finished = new THREE.MeshStandardMaterial();
    let finishedDisposed = false;
    finished.addEventListener("dispose", () => {
      finishedDisposed = true;
    });
    const system = new UnitSystem(
      world,
      map,
      [spawn(ghostrunner)],
      [],
      session,
      () => {
        const root = new THREE.Group();
        root.name = "site model";
        const model = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2).translate(0, 1.5, 0), finished);
        model.name = "Building model mesh";
        root.add(model);
        return root;
      },
      undefined,
      undefined,
      scaffoldKit,
    );
    const site = activeBuilding("turret-site", "turret", {
      lifecycle: "constructing",
      constructionProgress: 0.4,
      health: 200,
      maxHealth: 900,
    });
    session.frames.push(frame(2, ghostrunner, site));
    system.update(0);
    await kitLoaded();
    system.update(0);
    const root = world.getObjectByName("site model")!;
    const model = root.getObjectByName("Building model mesh") as THREE.Mesh;
    expect(clickedFromAbove(system, world, 11.08, 2.4)).toBe(site.id);

    session.frames.push(frame(3, ghostrunner, [], [{
      type: "building-died",
      tick: 2,
      id: site.id,
      attackerId: ghostrunner.id,
    }]));
    system.update(0);
    expect(clickedFromAbove(system, world, 11.08, 2.4)).toBeUndefined();

    system.update(0.4);
    // The stump stands as it was cut, without the collapse a finished building gets, and fades.
    expect(world.getObjectByName("site model")).toBe(root);
    expect(root.getObjectByName("Building visual")?.scale.y).toBe(1);
    expect(model.material).not.toBe(finished);
    expect((model.material as THREE.Material).opacity).toBeCloseTo(0.5);

    system.update(0.5);
    expect(world.getObjectByName("site model")).toBeUndefined();
    // The model belongs to its factory and may be shared: it gets its own material back, untouched.
    expect(model.material).toBe(finished);
    expect(finished.opacity).toBe(1);
    expect(finishedDisposed).toBe(false);
  });

  test("keeps placement active until a queued build is authoritatively accepted", () => {
    const scout = unit("scout-drone");
    const session = new TestSession(frame(1, scout, []));
    session.submissionStatus = "queued";
    const world = new THREE.Group();
    const system = new UnitSystem(world, map, [spawn(scout)], [], session);
    system.attachScoutDrone(scout.id, new THREE.Group(), new THREE.Group(), options);
    system.select([scout.id]);
    system.previewConstruction("turret", 3, 0);
    const resolutions: boolean[] = [];

    expect(system.buildSelected("turret", 3, 0, (accepted) => {
      resolutions.push(accepted);
    })).toBe(true);
    expect(world.getObjectByName("Construction placement")?.visible).toBe(true);
    expect(resolutions).toEqual([]);

    session.results.set("test", {
      accepted: true,
      commandId: "test",
      duplicate: false,
      playerId: "local-player",
      serverTick: 1,
    });
    system.update(0);

    expect(resolutions).toEqual([true]);
    expect(world.getObjectByName("Construction placement")?.visible).toBe(false);
  });

  test("keeps placement available after an authoritative build rejection", () => {
    const scout = unit("scout-drone");
    const session = new TestSession(frame(1, scout, []));
    session.submissionStatus = "queued";
    const world = new THREE.Group();
    const system = new UnitSystem(world, map, [spawn(scout)], [], session);
    system.attachScoutDrone(scout.id, new THREE.Group(), new THREE.Group(), options);
    system.select([scout.id]);
    system.previewConstruction("turret", 3, 0);
    const resolutions: boolean[] = [];
    system.buildSelected("turret", 3, 0, (accepted) => resolutions.push(accepted));

    session.results.set("test", {
      accepted: false,
      commandId: "test",
      duplicate: false,
      playerId: "local-player",
      serverTick: 1,
    });
    system.update(0);

    expect(resolutions).toEqual([false]);
    expect(world.getObjectByName("Construction placement")?.visible).toBe(true);
  });

  test("faces newly constructed Command Centers toward the gameplay camera", () => {
    const scout = unit("scout-drone");
    const session = new TestSession(frame(1, scout, []));
    const system = new UnitSystem(new THREE.Group(), map, [spawn(scout)], [], session);
    system.attachScoutDrone(scout.id, new THREE.Group(), new THREE.Group(), options);
    system.select([scout.id]);

    expect(system.buildSelected("command-center", 12, 0)).toBe(true);
    expect(session.commands[0]).toEqual(expect.objectContaining({
      type: "build",
      kind: "command-center",
      rotation: Math.PI / 4,
    }));
  });

  test("offers construction only for selected locally owned Scouts", () => {
    const friendlyScout = unit("scout-drone");
    const enemyScout = { ...unit("scout-drone"), id: "enemy-scout", ownerId: "enemy-player" };
    const session = new TestSession(frame(1, [friendlyScout, enemyScout], []));
    const system = new UnitSystem(
      new THREE.Group(),
      map,
      [spawn(friendlyScout), spawn(enemyScout)],
      [],
      session,
    );
    system.attachScoutDrone(friendlyScout.id, new THREE.Group(), new THREE.Group(), options);
    system.attachScoutDrone(enemyScout.id, new THREE.Group(), new THREE.Group(), options);

    system.select([enemyScout.id]);
    expect(system.canSelectedBuild()).toBe(false);
    system.select([friendlyScout.id]);
    expect(system.canSelectedBuild()).toBe(true);
  });

  test("selects buildings and shows contextual health for units and buildings", () => {
    const ghostrunner = unit("ghostrunner");
    const building = activeBuilding("enemy-command-center", "command-center");
    const session = new TestSession(frame(1, ghostrunner, building));
    const world = new THREE.Group();
    const system = new UnitSystem(
      world,
      map,
      [spawn(ghostrunner)],
      [],
      session,
      (state) => {
        const root = new THREE.Group();
        root.name = `${state.kind} model`;
        root.add(new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4)));
        return root;
      },
    );
    const unitRoot = new THREE.Group();
    system.attachGhostrunner(ghostrunner.id, unitRoot, [
      new THREE.AnimationClip("Idle", 1, []),
      new THREE.AnimationClip("Female_Throwing_Stance_Charge_inplace", 1, []),
      new THREE.AnimationClip("Attack", 1, []),
    ], options);
    const buildingRoot = world.getObjectByName("command-center model")!;
    const unitHealth = unitRoot.getObjectByName("Health bar")!;
    const buildingHealth = buildingRoot.getObjectByName("Health bar")!;

    expect(system.selectables).toContain(buildingRoot);
    expect(unitHealth.visible).toBe(false);
    expect(buildingHealth.visible).toBe(false);

    system.select([building.id]);

    expect(system.selectedBuildings()).toEqual([expect.objectContaining({
      id: building.id,
      kind: "command-center",
      name: "Command Center",
      friendly: false,
      health: 2_500,
      maxHealth: 2_500,
    })]);
    const buildingSelectionRing = buildingRoot.getObjectByName("Selection ring") as THREE.Mesh<
      THREE.RingGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(buildingSelectionRing.visible).toBe(true);
    expect(buildingHealth.visible).toBe(true);

    system.select([ghostrunner.id]);
    const healthBackground = unitHealth.getObjectByName("Health bar background") as THREE.Sprite;
    const healthFill = unitHealth.getObjectByName("Health bar fill") as THREE.Sprite;
    const layerOrder = [healthBackground.renderOrder, healthFill.renderOrder];
    unitRoot.rotation.y = Math.PI;
    expect([healthBackground.renderOrder, healthFill.renderOrder]).toEqual(layerOrder);
    expect(healthFill.renderOrder).toBeGreaterThan(healthBackground.renderOrder);
    expect(healthFill.position.z).toBe(0);
    expect(buildingSelectionRing.material.polygonOffset).toBe(true);
    expect(unitHealth.visible).toBe(true);
    expect(buildingHealth.visible).toBe(false);

    system.select();
    const damagedBuilding = structuredClone(building);
    damagedBuilding.health = 2_400;
    session.frames.push(frame(2, ghostrunner, damagedBuilding, [{
      type: "damage",
      tick: 1,
      attackerId: ghostrunner.id,
      targetId: building.id,
      target: "building",
      amount: 100,
      health: 2_400,
    }]));
    system.update(0);

    expect(unitHealth.visible).toBe(true);
    expect(buildingHealth.visible).toBe(true);
    expect((buildingHealth.getObjectByName("Health bar fill") as THREE.Sprite).scale.x)
      .toBeCloseTo(2.4 / 2.5);

    session.frames.push({
      ...frame(33, ghostrunner, damagedBuilding),
      tick: 32,
    });
    system.update(0);

    expect(unitHealth.visible).toBe(false);
    expect(buildingHealth.visible).toBe(true);
  });

  test("a destroyed building fades on its own materials and leaves the model it shares untouched", async () => {
    const ghostrunner = unit("ghostrunner");
    const doomed = activeBuilding("turret-doomed");
    const survivor = activeBuilding("turret-survivor", "turret", {
      position: { x: -10 * POSITION_SCALE, z: 2 * POSITION_SCALE },
    });
    // Mirrors the match's model library: every building is a clone of one loaded source.
    const texture = new THREE.Texture();
    const source = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshStandardMaterial({ map: texture }),
    );
    source.name = "Building model mesh";
    const disposed = new Set<string>();
    source.geometry.addEventListener("dispose", () => disposed.add("geometry"));
    source.material.addEventListener("dispose", () => disposed.add("material"));
    texture.addEventListener("dispose", () => disposed.add("texture"));
    const session = new TestSession(frame(1, ghostrunner, []));
    const world = new THREE.Group();
    const system = new UnitSystem(world, map, [spawn(ghostrunner)], [], session, async () => {
      const root = new THREE.Group();
      root.add(source.clone());
      return root;
    });

    session.frames.push(frame(2, ghostrunner, [doomed, survivor]));
    system.update(0);
    await Promise.resolve();

    const rootOf = (id: string) => system.selectables.find((root) => root.userData.buildingId === id)!;
    const meshOf = (root: THREE.Object3D) => root.getObjectByName("Building model mesh") as THREE.Mesh<
      THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const doomedRoot = rootOf(doomed.id);
    const survivorRoot = rootOf(survivor.id);
    expect(meshOf(doomedRoot).geometry).toBe(meshOf(survivorRoot).geometry);
    expect(meshOf(doomedRoot).material.map).toBe(meshOf(survivorRoot).material.map);
    const selectionRing = doomedRoot.getObjectByName("Selection ring") as THREE.Mesh;
    let selectionRingDisposed = false;
    selectionRing.geometry.addEventListener("dispose", () => {
      selectionRingDisposed = true;
    });

    session.frames.push(frame(3, ghostrunner, [survivor], [{
      type: "building-died",
      tick: 2,
      id: doomed.id,
      attackerId: ghostrunner.id,
    }]));
    system.update(0);
    expect(system.attackables).not.toContain(doomedRoot);
    expect(selectionRingDisposed).toBe(true);

    system.update(0.4);
    const fading = meshOf(doomedRoot).material;
    let fadingDisposed = false;
    fading.addEventListener("dispose", () => {
      fadingDisposed = true;
    });
    expect(doomedRoot.getObjectByName("Building visual")?.scale.y).toBeLessThan(1);
    expect(fading).not.toBe(source.material);
    expect(fading.map).toBe(texture);
    expect(fading.opacity).toBeLessThan(1);
    system.update(0.5);
    expect(doomedRoot.parent).toBeNull();
    expect(fadingDisposed).toBe(true);

    const survivorMesh = meshOf(survivorRoot);
    expect(survivorRoot.parent).toBe(world);
    expect(survivorRoot.visible).toBe(true);
    expect(survivorMesh.material.opacity).toBe(1);
    expect(survivorMesh.material.transparent).toBe(false);
    expect(survivorMesh.material.depthWrite).toBe(true);
    expect(disposed.size).toBe(0);
    system.dispose();
  });

  test("a destroyed building sinks and leaves while the player has a unit selected", async () => {
    const ghostrunner = unit("ghostrunner");
    const building = activeBuilding("turret-target");
    const session = new TestSession(frame(1, ghostrunner, building));
    const world = new THREE.Group();
    const system = new UnitSystem(world, map, [spawn(ghostrunner)], [], session, () => {
      const root = new THREE.Group();
      root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial()));
      return root;
    });
    system.attachGhostrunner(ghostrunner.id, new THREE.Group(), [new THREE.AnimationClip("Idle", 1, [])], options);
    system.update(0);
    system.select([ghostrunner.id]);
    const root = system.attackables.find((candidate) => candidate.userData.buildingId === building.id)!;

    session.frames.push(frame(2, ghostrunner, [], [{
      type: "building-died",
      tick: 1,
      id: building.id,
      attackerId: ghostrunner.id,
    }]));
    system.update(0);
    expect(system.attackables).not.toContain(root);
    system.update(0.4);
    expect(root.getObjectByName("Building visual")?.scale.y).toBeLessThan(1);
    system.update(0.5);
    expect(root.parent).toBeNull();
    system.dispose();
  });

  test("shows its range, aims, then fires a synchronized heavy Turret projectile", async () => {
    const intruder = unit("ghostrunner");
    const turret = activeBuilding("enemy-turret", "turret", {
      position: { x: 4 * POSITION_SCALE, z: 0 },
      weapon: {
        range: 18 * POSITION_SCALE,
        damage: 25,
        intervalTicks: 6,
        cooldownTicks: 10,
        facing: -Math.PI / 2,
        targetId: intruder.id,
      },
    });
    const session = new TestSession(frame(1, intruder, turret));
    const world = new THREE.Group();
    const system = new UnitSystem(
      world,
      map,
      [spawn(intruder)],
      [],
      session,
      async () => {
        const root = new THREE.Group();
        root.name = "turret model";
        root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2)));
        const head = createTurretHead();
        root.add(head);
        return root;
      },
    );
    system.attachGhostrunner(intruder.id, new THREE.Group(), [
      new THREE.AnimationClip("Idle", 1, []),
      new THREE.AnimationClip("Female_Throwing_Stance_Charge_inplace", 1, []),
      new THREE.AnimationClip("Attack", 1, []),
    ], options);
    await Promise.resolve();

    const head = world.getObjectByName("TurretHead")!;
    expect(head.rotation.y).toBeCloseTo(-Math.PI / 4, 5);
    expect(head.getObjectByName("TurretMuzzle")?.position.toArray()).toEqual([-1.585, 0.42, 0]);
    system.select([turret.id]);
    expect(world.getObjectByName("Turret attack range")?.visible).toBe(true);

    session.frames.push(frame(2, intruder, turret, [{
      type: "weapon-fired",
      tick: 1,
      attackerId: turret.id,
      attack: "direct",
      targetId: intruder.id,
      target: { ...intruder.position },
      impactTick: 5,
    }]));
    system.update(0);

    const projectile = world.getObjectByName("Turret projectile")!;
    expect(projectile).toBeDefined();
    const authoredMuzzle = head.getObjectByName("TurretMuzzle")!;
    expect(projectile.position.distanceTo(authoredMuzzle.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-6);
    // Keep the successful Hornet silhouette: a thin core that reads as a streak,
    // with extra turret weight coming from length instead of cylinder thickness.
    expect(projectile.scale.toArray()).toEqual([1, 1.35, 1]);
    expect(Math.abs(Math.atan2(
      Math.sin(-Math.PI / 4 - head.rotation.y),
      Math.cos(-Math.PI / 4 - head.rotation.y),
    ))).toBeLessThanOrEqual(THREE.MathUtils.degToRad(6));
    session.frames.push(frame(3, intruder, turret));
    system.update(0);
    const position = projectile.position.clone();
    system.update(0.04);
    expect(world.getObjectByName("Turret projectile")).toBeDefined();
    expect(projectile.position.equals(position)).toBe(false);
    session.frames.push(frame(5, intruder, turret));
    system.update(0);
    expect(world.getObjectByName("Turret projectile")).toBeDefined();
    session.frames.push(frame(6, intruder, turret));
    system.update(0);
    expect(world.getObjectByName("Turret projectile")).toBeUndefined();
  });

  test("presents a Turret shot when its model loads before the worker adds weapon state", () => {
    const intruder = unit("ghostrunner");
    intruder.position = toSimPoint(0, 8);
    const turret = activeBuilding("enemy-turret", "turret", {
      position: toSimPoint(0, 0),
      rotation: 0,
    });
    const session = new TestSession(frame(1, intruder, turret));
    const world = new THREE.Group();
    const system = new UnitSystem(
      world,
      map,
      [],
      [],
      session,
      () => {
        const root = new THREE.Group();
        const head = createTurretHead();
        root.add(head);
        return root;
      },
    );
    const armedTurret = structuredClone(turret);
    armedTurret.weapon = {
      range: 18 * POSITION_SCALE,
      damage: 25,
      intervalTicks: 6,
      cooldownTicks: 10,
      facing: 0,
      targetId: intruder.id,
    };
    expect(world.getObjectByName("TurretMuzzle")).toBeDefined();

    session.frames.push(frame(2, intruder, armedTurret, [{
      type: "weapon-fired",
      tick: 1,
      attackerId: turret.id,
      attack: "direct",
      targetId: intruder.id,
      target: { ...intruder.position },
      impactTick: 3,
    }]));
    for (let frameIndex = 0; frameIndex < 60
      && !world.getObjectByName("Turret projectile"); frameIndex += 1) {
      system.update(1 / 60);
    }

    expect(world.getObjectByName("Turret projectile")).toBeDefined();
    system.dispose();
  });

  test("does not compress a late Turret shot into the next firing interval", async () => {
    const intruder = unit("ghostrunner");
    intruder.position = toSimPoint(0, 8);
    const turret = activeBuilding("enemy-turret", "turret", {
      position: toSimPoint(0, 0),
      rotation: 0,
      weapon: {
        range: 18 * POSITION_SCALE,
        damage: 25,
        intervalTicks: 6,
        cooldownTicks: 6,
        facing: 0,
        targetId: intruder.id,
      },
    });
    let resolveModel!: (root: THREE.Group) => void;
    const model = new Promise<THREE.Group>((resolve) => {
      resolveModel = resolve;
    });
    const session = new TestSession(frame(1, intruder, turret));
    const world = new THREE.Group();
    const system = new UnitSystem(world, map, [], [], session, () => model);

    session.frames.push(frame(2, intruder, turret, [{
      type: "weapon-fired",
      tick: 1,
      attackerId: turret.id,
      attack: "direct",
      targetId: intruder.id,
      target: { ...intruder.position },
      impactTick: 5,
    }]));
    system.update(0);
    session.frames.push(frame(3, intruder, turret));
    system.update(0);

    const root = new THREE.Group();
    const head = createTurretHead();
    root.add(head);
    resolveModel(root);
    await Promise.resolve();
    await Promise.resolve();

    expect(world.getObjectByName("Turret projectile")).toBeUndefined();
    session.frames.push(frame(8, intruder, turret, [{
      type: "weapon-fired",
      tick: 7,
      attackerId: turret.id,
      attack: "direct",
      targetId: intruder.id,
      target: { ...intruder.position },
      impactTick: 11,
    }]));
    system.update(0);
    expect(world.getObjectByName("Turret projectile")).toBeDefined();
    system.dispose();
  });

  test("does not replay an expired Turret shot after firing and impact frames coalesce", () => {
    const intruder = unit("ghostrunner");
    const turret = activeBuilding("enemy-turret", "turret", {
      position: toSimPoint(0, 0),
      rotation: 0,
    });
    const session = new TestSession(frame(1, intruder, turret));
    const world = new THREE.Group();
    const system = new UnitSystem(world, map, [spawn(intruder)], [], session);
    const intruderRoot = new THREE.Group();
    system.attachGhostrunner(intruder.id, intruderRoot, [
      new THREE.AnimationClip("Idle", 1, []),
      new THREE.AnimationClip("Female_Throwing_Stance_Charge_inplace", 1, []),
      new THREE.AnimationClip("Attack", 1, []),
      new THREE.AnimationClip("Dead", 1, []),
    ], options);
    const turretRoot = new THREE.Group();
    const head = createTurretHead();
    turretRoot.add(head);
    system.attachBuilding(turret.id, turretRoot);
    const dead = { ...structuredClone(intruder), health: 0 };

    session.frames.push(frame(5, dead, turret, [
      {
        type: "weapon-fired",
        tick: 1,
        attackerId: turret.id,
        attack: "direct",
        targetId: intruder.id,
        target: { ...intruder.position },
        impactTick: 4,
      },
      {
        type: "damage",
        tick: 4,
        attackerId: turret.id,
        targetId: intruder.id,
        target: "unit",
        amount: intruder.health,
        health: 0,
      },
      {
        type: "unit-died",
        tick: 4,
        id: intruder.id,
        attackerId: turret.id,
      },
    ]));
    system.update(0.1);

    expect(world.getObjectByName("Turret projectile")).toBeUndefined();
    expect(intruderRoot.visible).toBe(true);
    system.dispose();
  });

  test("sweeps an idle Turret head and aims it at its current target", async () => {
    const target = unit("ghostrunner");
    target.position = { x: 0, z: 10 * POSITION_SCALE };
    const weapon = {
      range: 18 * POSITION_SCALE,
      damage: 25,
      intervalTicks: 6,
      cooldownTicks: 0,
      facing: -Math.PI / 2,
    };
    const turret = activeBuilding("enemy-turret", "turret", {
      position: { x: 0, z: 0 },
      rotation: Math.PI / 4,
      weapon,
    });
    const session = new TestSession(frame(1, target, turret));
    const world = new THREE.Group();
    const system = new UnitSystem(
      world,
      map,
      [spawn(target)],
      [],
      session,
      async () => {
        const root = new THREE.Group();
        const head = createTurretHead();
        root.add(head);
        return root;
      },
    );
    await Promise.resolve();

    const head = world.getObjectByName("TurretHead")!;
    system.update(1);
    expect(Math.abs(head.rotation.y)).toBeGreaterThan(0.01);

    const attackingTurret = structuredClone(turret);
    attackingTurret.weapon = { ...weapon, targetId: target.id };
    session.frames.push(frame(2, target, attackingTurret));
    const rotationBeforeAiming = head.rotation.y;
    system.update(0);

    expect(head.rotation.y).toBe(rotationBeforeAiming);
    for (let step = 0; step < 20; step += 1) system.update(0.05);
    expect(head.rotation.y).toBeCloseTo(Math.PI / 4, 2);
  });

  test("animates Turret aim every render frame between simulation ticks", async () => {
    const target = unit("ghostrunner");
    target.position = toSimPoint(0, 10);
    const turret = activeBuilding("enemy-turret", "turret", {
      position: toSimPoint(0, 0),
      rotation: 0,
      weapon: {
        range: 18 * POSITION_SCALE,
        damage: 25,
        intervalTicks: 6,
        cooldownTicks: 0,
        facing: -Math.PI / 2,
        targetId: target.id,
      },
    });
    const session = new TestSession(frame(1, target, turret));
    const world = new THREE.Group();
    const system = new UnitSystem(
      world,
      map,
      [],
      [],
      session,
      () => {
        const root = new THREE.Group();
        const head = createTurretHead();
        root.add(head);
        return root;
      },
    );
    await Promise.resolve();

    const head = world.getObjectByName("TurretHead")!;
    const angles = [head.rotation.y];
    for (let frameIndex = 0; frameIndex < 5; frameIndex += 1) {
      system.update(1 / 60);
      angles.push(head.rotation.y);
    }

    for (let index = 1; index < angles.length; index += 1) {
      expect(angles[index]).toBeGreaterThan(angles[index - 1]!);
    }
    system.dispose();
  });

  test("falls back to a selectable building presentation when model loading fails", async () => {
    const ghostrunner = unit("ghostrunner");
    const building = activeBuilding("failed-model");
    const session = new TestSession(frame(1, ghostrunner, []));
    const world = new THREE.Group();
    const system = new UnitSystem(
      world,
      map,
      [spawn(ghostrunner)],
      [],
      session,
      async () => Promise.reject(new Error("asset unavailable")),
    );

    session.frames.push(frame(2, ghostrunner, building));
    system.update(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fallback = world.getObjectByName("Building fallback");
    expect(fallback?.userData.buildingId).toBe(building.id);
    expect(fallback?.getObjectByName("Building fallback footprint")?.visible).toBe(true);
    expect(fallback?.getObjectByName("Selection ring")).toBeDefined();
    expect(system.attackables).toContain(fallback!);
  });

  test("advances Ghostrunner attack animation on every render frame", () => {
    const ghostrunner = unit("ghostrunner");
    ghostrunner.target = { x: 0, z: 10 * POSITION_SCALE };
    const building = activeBuilding("building-1", "turret", {
      position: ghostrunner.target,
    });
    const session = new TestSession(frame(1, ghostrunner, building));
    const system = new UnitSystem(new THREE.Group(), map, [spawn(ghostrunner)], [], session);
    const clips = [
      new THREE.AnimationClip("Idle", 1, []),
      new THREE.AnimationClip("Female_Throwing_Stance_Charge_inplace", 1, []),
      new THREE.AnimationClip("Attack", 1, []),
    ];
    system.attachGhostrunner(ghostrunner.id, new THREE.Group(), clips, options);
    const presentation = (system as unknown as {
      presentations: Map<string, { actions: Record<string, THREE.AnimationAction> }>;
    }).presentations.get(ghostrunner.id)!;

    system.update(0.016);
    const firstFrameTime = presentation.actions.attack.time;
    system.update(0.016);

    expect(firstFrameTime).toBeGreaterThan(0);
    expect(presentation.actions.attack.time).toBeGreaterThan(firstFrameTime);
  });

  test("plays, holds, and fades the Ghostrunner death presentation", () => {
    const ghostrunner = unit("ghostrunner");
    const building = activeBuilding("building-1", "turret", {
      position: ghostrunner.target,
    });
    const session = new TestSession(frame(1, ghostrunner, building));
    const system = new UnitSystem(new THREE.Group(), map, [spawn(ghostrunner)], [], session);
    const root = new THREE.Group();
    const corpse = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
    );
    root.add(corpse);
    const clips = [
      new THREE.AnimationClip("Idle", 1, []),
      new THREE.AnimationClip("Female_Throwing_Stance_Charge_inplace", 1, []),
      new THREE.AnimationClip("Attack", 1, []),
      new THREE.AnimationClip("Dead", 1, []),
    ];
    system.attachGhostrunner(ghostrunner.id, root, clips, options);

    system.select([ghostrunner.id]);
    expect(root.getObjectByName("Selection ring")?.visible).toBe(true);
    const dead = structuredClone(ghostrunner);
    dead.health = 0;
    dead.order = "idle";
    dead.attacking = false;
    session.frames.push(frame(2, dead, building, [{
      type: "unit-died",
      tick: 1,
      id: dead.id,
      attackerId: "behemoth-1",
    }]));

    system.update(0);
    const presentation = (system as unknown as {
      presentations: Map<string, {
        actions: Record<string, THREE.AnimationAction>;
        state: string;
      }>;
    }).presentations.get(ghostrunner.id)!;
    expect(root.visible).toBe(true);
    expect(root.getObjectByName("Selection ring")?.visible).toBe(false);
    expect(system.select([ghostrunner.id])).toBe(0);
    expect(presentation.state).toBe("death");
    expect(presentation.actions.death.isRunning()).toBe(true);
    expect(presentation.actions.death.getEffectiveTimeScale()).toBe(1.3);
    expect((corpse.material as THREE.Material).transparent).toBe(true);
    expect((corpse.material as THREE.Material).opacity).toBeCloseTo(0.95);

    session.frames.push(frame(3, dead, building));
    system.update(0.1);
    expect(root.visible).toBe(true);
    system.update(1 / 1.3 + 4 - 0.1);
    expect(root.visible).toBe(true);
    system.update(1);
    expect((corpse.material as THREE.Material).opacity).toBeCloseTo(0.475);
    system.update(1.01);
    expect(root.visible).toBe(false);
  });

  test("waits for the visual Behemoth impact before presenting an early death frame", () => {
    const behemoth = unit("behemoth");
    behemoth.order = "attack-ground";
    behemoth.attackTargetId = undefined;
    behemoth.attackGroundTarget = { ...behemoth.target };
    const ghostrunner = unit("ghostrunner");
    ghostrunner.id = "ghostrunner-target";
    ghostrunner.attacking = false;
    ghostrunner.order = "idle";
    const building = activeBuilding("building-1", "turret", {
      position: behemoth.target,
    });
    const session = new TestSession(frame(1, [behemoth, ghostrunner], building));
    const world = new THREE.Group();
    const system = new UnitSystem(
      world,
      map,
      [spawn(behemoth), spawn(ghostrunner)],
      [],
      session,
    );

    const ghostrunnerRoot = new THREE.Group();
    system.attachGhostrunner(ghostrunner.id, ghostrunnerRoot, [
      new THREE.AnimationClip("Idle", 1, []),
      new THREE.AnimationClip("Female_Throwing_Stance_Charge_inplace", 1, []),
      new THREE.AnimationClip("Attack", 1, []),
      new THREE.AnimationClip("Dead", 1, []),
    ], options);
    const behemothRoot = new THREE.Group();
    const visual = new THREE.Group();
    for (const name of ["TrackBeltXNegative", "TrackBeltXPositive"]) {
      const belt = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ map: new THREE.Texture() }),
      );
      belt.name = name;
      visual.add(belt);
    }
    behemothRoot.add(visual);
    behemothRoot.rotation.y = Math.PI;
    system.attachBehemoth(behemoth.id, behemothRoot, visual, {
      ...options,
      turnResponsiveness: 1,
    });

    session.frames.push(frame(2, [behemoth, ghostrunner], building, [{
      type: "weapon-fired",
      tick: 1,
      attackerId: behemoth.id,
      attack: "ground",
      target: behemoth.target,
    }]));
    system.update(0);
    const dead = structuredClone(ghostrunner);
    dead.health = 0;
    session.frames.push(frame(3, [behemoth, dead], building, [{
      type: "unit-died",
      tick: 2,
      id: dead.id,
      attackerId: behemoth.id,
    }]));
    system.update(0.1);

    const presentation = (system as unknown as {
      presentations: Map<string, { state: string }>;
    }).presentations.get(ghostrunner.id)!;
    expect(ghostrunnerRoot.visible).toBe(true);
    expect(presentation.state).not.toBe("death");

    for (let frameIndex = 0; frameIndex < 80
      && !world.getObjectByName("Behemoth explosion"); frameIndex += 1) {
      system.update(0.1);
    }
    expect(world.getObjectByName("Behemoth explosion")).toBeDefined();
    expect(presentation.state).not.toBe("death");
    system.update(0.079);
    expect(presentation.state).not.toBe("death");
    system.update(0.002);
    expect(presentation.state).toBe("death");
  });

  test("retains a Hornet shot until its model is attached and facing the target", () => {
    const hornet = unit("hornet");
    const building = activeBuilding("building-1", "turret", {
      position: hornet.target,
    });
    const session = new TestSession(frame(1, hornet, building));
    const world = new THREE.Group();
    const system = new UnitSystem(world, map, [spawn(hornet)], [], session);
    session.frames.push(frame(2, hornet, building, [{
      type: "weapon-fired",
      tick: 1,
      attackerId: hornet.id,
      attack: "direct",
      targetId: building.id,
      target: building.position,
      impactTick: 4,
    }]));

    system.update(0);
    expect(world.getObjectByName("Hornet projectile")).toBeUndefined();

    const buildingRoot = new THREE.Group();
    buildingRoot.position.set(10, 0, 0);
    buildingRoot.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
    world.add(buildingRoot);
    system.attachBuilding(building.id, buildingRoot);
    const hornetRoot = new THREE.Group();
    const visual = new THREE.Group();
    hornetRoot.add(visual);
    world.add(hornetRoot);
    system.attachHornet(hornet.id, hornetRoot, visual, options);

    expect(world.getObjectByName("Hornet projectile")).toBeUndefined();
    system.update(0.1);
    expect(world.getObjectByName("Hornet projectile")).toBeDefined();
  });

  test("reuses flash lights without shading inactive lights or dropping shot animations", () => {
    const hornets = Array.from({ length: 12 }, (_, index) => ({
      ...unit("hornet"), id: `hornet-${index}`, facing: Math.PI / 2,
    }));
    const building = activeBuilding("building-1", "command-center", {
      position: hornets[0]!.target,
    });
    const session = new TestSession(frame(1, hornets, building));
    const world = new THREE.Group();
    const system = new UnitSystem(world, map, hornets.map(spawn), [], session);
    for (const hornet of hornets) {
      const root = new THREE.Group();
      const visual = new THREE.Group();
      root.add(visual);
      world.add(root);
      system.attachHornet(hornet.id, root, visual, options);
    }
    const visibleLights = () => {
      const lights: THREE.PointLight[] = [];
      world.traverseVisible((object) => {
        if (object instanceof THREE.PointLight) lights.push(object);
      });
      return lights;
    };
    const lights = world.children.filter((object) => object instanceof THREE.PointLight);
    const idleVisible = visibleLights();
    expect(lights.filter((light) => light.name === "Muzzle flash light")
      .every((light) => !light.visible)).toBe(true);
    const fire = (version: number) => {
      session.frames.push(frame(version, hornets, building, hornets.map((hornet) => ({
        type: "weapon-fired", tick: version - 1, attackerId: hornet.id,
        attack: "direct", targetId: building.id, target: building.position,
        impactTick: version + 4,
      }))));
      system.update(0.01);
    };
    fire(2);
    expect(visibleLights()).toHaveLength(idleVisible.length + 8);
    expect(lights.filter((light) => light.intensity > 0)).toHaveLength(8);
    expect(world.children.filter((child) => child instanceof THREE.Sprite)).toHaveLength(12);
    expect(world.children.filter((child) => child.name === "Hornet projectile")).toHaveLength(12);
    system.update(0.2);
    expect(visibleLights()).toEqual(idleVisible);
    expect(lights.every((light) => light.intensity === 0)).toBe(true);
    fire(3);
    expect(visibleLights()).toHaveLength(idleVisible.length + 8);
    expect(lights.filter((light) => light.intensity > 0)).toHaveLength(8);
    system.dispose();
    expect(visibleLights()).toHaveLength(0);
  });

  test("drops a queued Hornet shot when the simulation stops the attack", () => {
    const hornet = unit("hornet");
    const building = activeBuilding("building-1", "turret", {
      position: hornet.target,
    });
    const session = new TestSession(frame(1, hornet, building));
    const world = new THREE.Group();
    const system = new UnitSystem(world, map, [spawn(hornet)], [], session);
    session.frames.push(frame(2, hornet, building, [{
      type: "weapon-fired",
      tick: 1,
      attackerId: hornet.id,
      attack: "direct",
      targetId: building.id,
      target: building.position,
      impactTick: 4,
    }]));
    system.update(0);

    const waiting = structuredClone(hornet);
    waiting.attacking = false;
    session.frames.push(frame(3, waiting, building));
    system.update(0);

    const buildingRoot = new THREE.Group();
    buildingRoot.position.set(10, 0, 0);
    buildingRoot.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
    world.add(buildingRoot);
    system.attachBuilding(building.id, buildingRoot);
    const hornetRoot = new THREE.Group();
    const visual = new THREE.Group();
    hornetRoot.add(visual);
    world.add(hornetRoot);
    system.attachHornet(hornet.id, hornetRoot, visual, options);
    const initialRotation = hornetRoot.rotation.y;

    system.update(0.1);

    expect(world.getObjectByName("Hornet projectile")).toBeUndefined();
    expect(hornetRoot.rotation.y).toBe(initialRotation);
  });

  test("presents a Behemoth attack-ground event as a seven-rocket barrage", () => {
    const behemoth = unit("behemoth");
    behemoth.order = "attack-ground";
    behemoth.attackTargetId = undefined;
    behemoth.attackGroundTarget = { ...behemoth.target };
    behemoth.attackMinRange = 7 * POSITION_SCALE;
    behemoth.attackRange = 22 * POSITION_SCALE;
    behemoth.attackGroundRadius = 4 * POSITION_SCALE;
    behemoth.attackIntervalTicks = 30;
    const building = activeBuilding("building-1", "turret", {
      position: behemoth.target,
    });
    const session = new TestSession(frame(1, behemoth, building));
    const world = new THREE.Group();
    const slopedMap = {
      ...map,
      heights: new Float32Array([0, 0, 20, 20]),
    } as GeneratedMap;
    const system = new UnitSystem(world, slopedMap, [spawn(behemoth)], [], session);
    expect(world.children.filter((object) => object.name === "Behemoth barrage light")).toHaveLength(1);
    const root = new THREE.Group();
    const visual = new THREE.Group();
    for (const name of ["TrackBeltXNegative", "TrackBeltXPositive"]) {
      const belt = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ map: new THREE.Texture() }),
      );
      belt.name = name;
      visual.add(belt);
    }
    root.add(visual);
    root.rotation.y = -Math.PI / 2;
    world.add(root);
    system.attachBehemoth(behemoth.id, root, visual, options);
    session.frames.push(frame(2, behemoth, building, [{
      type: "weapon-fired",
      tick: 1,
      attackerId: behemoth.id,
      attack: "ground",
      target: behemoth.target,
    }]));

    system.update(0.01);
    expect(world.getObjectByName("Behemoth launch flash")).toBeUndefined();
    system.update(0.1);
    expect(world.getObjectByName("Behemoth launch flash")).toBeDefined();
    system.update(0.2);

    const rockets: THREE.Object3D[] = [];
    world.traverse((object) => {
      if (object.name === "Behemoth rocket") rockets.push(object);
    });
    expect(rockets).toHaveLength(7);
    expect(world.children.filter((object) => object.name === "Behemoth barrage light")).toHaveLength(1);

    system.update(1);
    const scorchMarks = world.getObjectByName("Behemoth scorch marks");
    expect(scorchMarks).toBeInstanceOf(THREE.Mesh);
    const scorchPositions = (scorchMarks as THREE.Mesh).geometry.getAttribute("position");
    const visibleHeights = Array.from(
      { length: scorchPositions.count },
      (_, index) => scorchPositions.getY(index),
    ).filter((height) => height !== 0);
    expect(Math.max(...visibleHeights) - Math.min(...visibleHeights)).toBeGreaterThan(0.5);
    for (let index = 0; index < scorchPositions.count; index += 1) {
      const height = scorchPositions.getY(index);
      if (height === 0) continue;
      const gridX = (scorchPositions.getX(index) / slopedMap.size + 0.5) * slopedMap.segments;
      const gridZ = (scorchPositions.getZ(index) / slopedMap.size + 0.5) * slopedMap.segments;
      expect(gridX).toBeCloseTo(Math.round(gridX));
      expect(gridZ).toBeCloseTo(Math.round(gridZ));
      const terrainIndex = Math.round(gridZ) * (slopedMap.segments + 1) + Math.round(gridX);
      expect(height).toBeCloseTo(slopedMap.heights[terrainIndex]! + 0.035);
    }
    system.update(20);
    expect(scorchMarks?.visible).toBe(true);
  });
});


test("construction preview stays planar over ridges for both building sizes and the blocked cross", () => {
  const scout = unit("scout-drone");
  const session = new TestSession(frame(1, scout, []));
  const world = new THREE.Group();
  const terrain = { ...map, size: 20, segments: 20, heights: Float32Array.from({ length: 441 }, (_, i) => {
    const x = i % 21 - 10;
    const z = Math.floor(i / 21) - 10;
    return Math.max(0, 3 - Math.abs(x + z) * .8);
  }) };
  const system = new UnitSystem(world, terrain, [], [], session);
  for (const kind of ["turret", "command-center", "turret"] as const) {
    system.previewConstruction(kind, 0, 0);
    const preview = world.getObjectByName("Construction placement")!;
    preview.updateMatrixWorld(true);
    let checked = 0;
    preview.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const positions = object.geometry.getAttribute("position");
      expect(object.material.depthTest).toBe(false);
      for (let i = 0; i < positions.count; i++) {
        const point = object.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, i));
        expect(point.y).toBeCloseTo(sampleHeight(terrain, 0, 0) + .1, 5);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(100);
  }
});
