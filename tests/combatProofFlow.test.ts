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
  const map = generateMap(77);
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
    await advance(system, 36);
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
