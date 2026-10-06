import { beforeAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createCombatProofEncounter } from "../src/combatProofEncounter";
import { generateMap } from "../src/map";
import { initializeNavigation } from "../src/sim/navigation";
import type { BuildingKind } from "../src/sim/units";
import {
  UnitSystem,
  type LoadedUnitPresentation,
  type UnitPresentationFactory,
  type UnitPresentationOptions,
} from "../src/unitSystem";

const presentationOptions: UnitPresentationOptions = {
  terrainAlignment: 0,
  turnResponsiveness: 20,
  selectionRing: { radius: 1, offset: { x: 0, z: 0 } },
  selectionHitbox: { radius: 1, height: 2, offset: { x: 0, y: 1, z: 0 } },
};

const ghostrunnerClips = [
  new THREE.AnimationClip("Idle", 1, []),
  new THREE.AnimationClip("Female_Throwing_Stance_Charge_inplace", 1, []),
  new THREE.AnimationClip("Attack", 1, []),
];

const createUnitPresentation: UnitPresentationFactory = (unit): LoadedUnitPresentation => {
  const root = new THREE.Group();
  root.name = `${unit.id} model`;
  const visual = new THREE.Group();
  root.add(visual);
  return {
    root,
    visual,
    animations: unit.kind === "ghostrunner" ? ghostrunnerClips : [],
    options: presentationOptions,
  };
};

const settlePresentations = async (system: UnitSystem) => {
  await Promise.resolve();
  await Promise.resolve();
  system.update(0);
};

const advance = async (system: UnitSystem, seconds: number) => {
  system.update(seconds);
  await settlePresentations(system);
};

const validPlacement = (
  system: UnitSystem,
  kind: BuildingKind,
  origin: { x: number; z: number },
  radii = [12, 16, 20, 24, 28],
) => {
  for (const radius of radii) {
    for (let index = 0; index < 16; index += 1) {
      const angle = index / 16 * Math.PI * 2;
      const x = origin.x + Math.cos(angle) * radius;
      const z = origin.z + Math.sin(angle) * radius;
      if (system.previewConstruction(kind, x, z)) return { x, z };
    }
  }
  throw new Error(`No valid ${kind} placement near the player start`);
};

const createProof = async () => {
  const map = generateMap(77, 6);
  const encounter = createCombatProofEncounter(map);
  const world = new THREE.Group();
  const system = new UnitSystem(
    world,
    map,
    encounter.units,
    encounter.buildings,
    undefined,
    () => new THREE.Group(),
    createUnitPresentation,
  );
  await settlePresentations(system);
  return { encounter, system };
};

beforeAll(() => initializeNavigation());

describe("assembled combat proof", () => {
  test("presents shots fired by an enemy Turret in the live simulation", async () => {
    const map = generateMap(77, 6);
    const encounter = createCombatProofEncounter(map);
    const turret = encounter.buildings.find(({ id }) => id === "enemy-turret-left")!;
    const ghostrunner = {
      ...encounter.units.find(({ id }) => id === "ghostrunner-1")!,
      x: turret.x + 4,
      z: turret.z - 8,
      health: 25,
    };
    const world = new THREE.Group();
    const system = new UnitSystem(
      world,
      map,
      [ghostrunner],
      [turret],
      undefined,
      async () => {
        const root = new THREE.Group();
        const head = new THREE.Group();
        head.name = "TurretHead";
        const muzzle = new THREE.Object3D();
        muzzle.name = "TurretMuzzle";
        muzzle.position.set(-1.585, 0.42, 0);
        head.add(muzzle);
        root.add(head);
        return root;
      },
      createUnitPresentation,
    );
    await settlePresentations(system);
    expect(system.select([ghostrunner.id])).toBe(1);
    expect(system.moveSelected(turret.x + 4, turret.z + 8)).toBe(true);

    let fired = false;
    for (let step = 0; step < 80 && !fired; step += 1) {
      system.update(0.05);
      fired = Boolean(world.getObjectByName("Turret projectile"));
    }

    expect(fired).toBe(true);
    const targetRoot = world.getObjectByName(`${ghostrunner.id} model`)!;
    expect(targetRoot.visible).toBe(true);
    for (let step = 0; step < 20
      && world.getObjectByName("Turret projectile"); step += 1) {
      system.update(0.05);
    }
    expect(world.getObjectByName("Turret projectile")).toBeUndefined();
    expect(targetRoot.visible).toBe(false);
    system.dispose();
  });

  test("lets Ghostrunners leave the starting area before reaching nearby defenses", async () => {
    const { encounter, system } = await createProof();
    const distanceFromCenter = Math.hypot(encounter.focus.x, encounter.focus.z);
    const destination = {
      x: encounter.focus.x - encounter.focus.x / distanceFromCenter * 40,
      z: encounter.focus.z - encounter.focus.z / distanceFromCenter * 40,
    };

    expect(system.select(["ghostrunner-2"])).toBe(1);
    expect(system.moveSelected(destination.x, destination.z)).toBe(true);
    await advance(system, 4.5);

    const [ghostrunner] = system.selectedUnits();
    expect(ghostrunner?.moving).toBe(false);
    expect(Math.hypot(ghostrunner!.x - destination.x, ghostrunner!.z - destination.z))
      .toBeLessThan(1);
    system.dispose();
  });

  test("supports production, construction, siege victory, and a clean reset", async () => {
    const { encounter, system } = await createProof();
    const playerStart = encounter.focus;
    const enemyCenter = encounter.buildings.find(({ id }) => id === "enemy-command-center")!;

    expect(system.select(["local-command-center"])).toBe(1);
    expect(system.trainSelected("scout-drone")).toBe(true);
    expect(system.trainSelected("ghostrunner")).toBe(true);
    expect(system.trainSelected("hornet")).toBe(true);
    expect(system.trainSelected("behemoth")).toBe(true);
    await advance(system, 76);

    expect(system.select(["local-player-scout-drone-1"])).toBe(1);
    const turretPosition = validPlacement(system, "turret", playerStart);
    expect(system.buildSelected("turret", turretPosition.x, turretPosition.z)).toBe(true);
    await advance(system, 15);
    system.select(["local-player-building-1"]);
    expect(system.selectedBuildings()[0]).toMatchObject({ kind: "turret", lifecycle: "active" });

    system.select(["local-player-scout-drone-1"]);
    const expansionPosition = validPlacement(
      system,
      "command-center",
      playerStart,
      [28, 24, 20],
    );
    expect(system.buildSelected("command-center", expansionPosition.x, expansionPosition.z))
      .toBe(true);
    await advance(system, 70);
    system.select(["local-player-building-2"]);
    expect(system.selectedBuildings()[0]).toMatchObject({
      kind: "command-center",
      lifecycle: "active",
    });
    expect(system.trainSelected("behemoth")).toBe(true);
    expect(system.trainSelected("behemoth")).toBe(true);
    await advance(system, 71);
    system.select(["local-player-building-2"]);
    const expansionQueue = system.selectedBuildings()[0]?.productionQueue ?? [];
    expect(expansionQueue).toEqual([]);

    const directAttackers = [
      "ghostrunner-1",
      "ghostrunner-2",
      "ghostrunner-3",
      "local-player-ghostrunner-2",
      "local-player-hornet-3",
    ];
    expect(system.select(directAttackers)).toBe(directAttackers.length);
    expect(system.attackSelected(enemyCenter.id)).toBe(true);
    const siegeAttackers = [
      "local-player-behemoth-4",
      "local-player-behemoth-5",
      "local-player-behemoth-6",
    ];
    expect(system.select(siegeAttackers)).toBe(siegeAttackers.length);
    expect(system.attackGroundSelected(enemyCenter.x, enemyCenter.z)).toBe(true);
    await advance(system, 75);

    expect(system.matchOutcome).toBe("victory");
    system.dispose();

    const restarted = await createProof();
    expect(restarted.system.matchOutcome).toBeUndefined();
    expect(restarted.system.select(["local-command-center"])).toBe(1);
    expect(restarted.system.selectedBuildings()[0]).toMatchObject({
      health: 2_500,
      productionQueue: [],
    });
    restarted.system.dispose();
  });
});
