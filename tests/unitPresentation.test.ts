import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import type { GeneratedMap } from "../src/map";
import type { MatchFrame, MatchSession } from "../src/matchSession";
import {
  POSITION_SCALE,
  toSimPoint,
  type BuildingState,
  type DispatchResult,
  type PlayerCommand,
  type UnitState,
} from "../src/sim/units";
import { UnitSystem, type UnitPresentationOptions, type UnitSpawn } from "../src/unitSystem";

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

describe("unit presentation timing", () => {
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

  test("previews Scout construction and presents authoritative site progress", () => {
    const scout = unit("scout-drone");
    const session = new TestSession(frame(1, scout, []));
    const world = new THREE.Group();
    const system = new UnitSystem(
      world,
      map,
      [spawn(scout)],
      [],
      session,
      (state) => {
        const root = new THREE.Group();
        root.name = `${state.kind} construction`;
        root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2)));
        return root;
      },
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
      constructionProgress: 0.25,
      ownerId: "local-player",
      health: 225,
      maxHealth: 900,
      builderId: scout.id,
      position: { x: 3 * POSITION_SCALE, z: 0 },
      weapon: {
        range: 18 * POSITION_SCALE,
        damage: 25,
        intervalTicks: 6,
        cooldownTicks: 0,
      },
    });
    const workingScout = structuredClone(scout);
    workingScout.order = "build";
    workingScout.attacking = false;
    workingScout.moving = false;
    workingScout.constructionTargetId = site.id;
    workingScout.target = { ...site.position };
    session.frames.push(frame(2, workingScout, site));
    system.update(0);
    const visual = world.getObjectByName("turret construction")!
      .getObjectByName("Building visual")!;
    expect(visual.scale.y).toBeCloseTo(0.3625);
    expect(world.getObjectByName("Construction beam")?.visible).toBe(true);
    system.select([site.id]);
    expect(world.getObjectByName("Turret attack range")?.visible).toBe(false);
    expect(system.selectedBuildings()[0]).toMatchObject({
      lifecycle: "constructing",
      constructionProgress: 0.25,
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
    session.frames.push(frame(3, scout, completed));
    system.update(0);
    expect(visual.scale.y).toBe(1);
    expect(world.getObjectByName("Construction beam")?.visible).toBe(false);
    system.select([completed.id]);
    expect(world.getObjectByName("Turret attack range")?.visible).toBe(true);
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

  test("collapses and fades a destroyed building after authoritative removal", async () => {
    const ghostrunner = unit("ghostrunner");
    const building = activeBuilding("turret-new");
    const session = new TestSession(frame(1, ghostrunner, []));
    const world = new THREE.Group();
    const system = new UnitSystem(
      world,
      map,
      [spawn(ghostrunner)],
      [],
      session,
      async (state) => {
        const root = new THREE.Group();
        root.name = `${state.kind} model`;
        const model = new THREE.Mesh(
          new THREE.BoxGeometry(2, 2, 2),
          new THREE.MeshStandardMaterial(),
        );
        model.name = "Building model mesh";
        root.add(model);
        return root;
      },
    );

    session.frames.push(frame(2, ghostrunner, building));
    system.update(0);
    await Promise.resolve();

    const root = world.getObjectByName("turret model");
    expect(root).toBeDefined();
    expect(root?.userData.buildingId).toBe(building.id);
    expect(root?.position.x).toBe(10);
    expect(root?.position.z).toBe(2);
    expect(root?.rotation.y).toBe(building.rotation);
    expect(system.attackables).toContain(root!);
    const selectionRing = root!.getObjectByName("Selection ring") as THREE.Mesh;
    const selectionHitbox = root!.children.find((child) => child instanceof THREE.Mesh
      && child.material instanceof THREE.MeshBasicMaterial
      && child.material.visible === false) as THREE.Mesh;
    const healthFill = root!.getObjectByName("Health bar fill") as THREE.Sprite;
    const model = root!.getObjectByName("Building model mesh") as THREE.Mesh;
    let selectionGeometryDisposed = false;
    let hitboxGeometryDisposed = false;
    let healthMaterialDisposed = false;
    let modelGeometryDisposed = false;
    let modelMaterialDisposed = false;
    selectionRing.geometry.addEventListener("dispose", () => {
      selectionGeometryDisposed = true;
    });
    selectionHitbox.geometry.addEventListener("dispose", () => {
      hitboxGeometryDisposed = true;
    });
    healthFill.material.addEventListener("dispose", () => {
      healthMaterialDisposed = true;
    });
    model.geometry.addEventListener("dispose", () => {
      modelGeometryDisposed = true;
    });
    (model.material as THREE.Material).addEventListener("dispose", () => {
      modelMaterialDisposed = true;
    });

    session.frames.push(frame(3, ghostrunner, [], [{
      type: "building-died",
      tick: 2,
      id: building.id,
      attackerId: ghostrunner.id,
    }]));
    system.update(0);

    expect(world.getObjectByName("turret model")).toBe(root);
    expect(system.attackables).not.toContain(root!);
    expect(selectionGeometryDisposed).toBe(true);
    expect(hitboxGeometryDisposed).toBe(true);
    expect(healthMaterialDisposed).toBe(true);
    expect(modelGeometryDisposed).toBe(false);
    expect(modelMaterialDisposed).toBe(false);

    system.update(0.4);
    expect(root!.getObjectByName("Building visual")?.scale.y).toBeLessThan(1);
    expect((model.material as THREE.Material).opacity).toBeLessThan(1);

    system.update(0.5);
    expect(world.getObjectByName("turret model")).toBeUndefined();
    expect(modelGeometryDisposed).toBe(true);
    expect(modelMaterialDisposed).toBe(true);
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
        const head = new THREE.Group();
        head.name = "TurretHead";
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
    expect(head.getObjectByName("Turret muzzle")?.position.toArray()).toEqual([-0.52, 0.17, 0]);
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
        const head = new THREE.Group();
        head.name = "TurretHead";
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
    expect(world.getObjectByName("Turret muzzle")).toBeDefined();

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
    const head = new THREE.Group();
    head.name = "TurretHead";
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
    const head = new THREE.Group();
    head.name = "TurretHead";
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
        const head = new THREE.Group();
        head.name = "TurretHead";
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
        const head = new THREE.Group();
        head.name = "TurretHead";
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
    expect(world.children.filter((object) => object instanceof THREE.PointLight)).toHaveLength(1);
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
    expect(world.children.filter((object) => object instanceof THREE.PointLight)).toHaveLength(1);

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
