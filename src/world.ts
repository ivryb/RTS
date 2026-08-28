import * as THREE from "three";
import { createCombatProofEncounter } from "./combatProofEncounter";
import type { GeneratedMap } from "./map";
import { createTerrain } from "./terrain";
import { createUnitModelFactory, loadBuildingModel } from "./modelAssets";
import { UnitSystem } from "./unitSystem";

export const createWorld = (map: GeneratedMap) => {
  const world = new THREE.Group();
  const terrain = createTerrain(map);
  world.add(terrain);
  world.userData.terrain = terrain;

  const encounter = createCombatProofEncounter(map);
  const unitSystem = new UnitSystem(
    world,
    map,
    encounter.units,
    encounter.buildings,
    undefined,
    ({ kind }) => loadBuildingModel(kind),
    createUnitModelFactory(),
  );
  world.userData.focus = encounter.focus;
  world.userData.unitSystem = unitSystem;
  return world;
};

export const updateWorld = (world: THREE.Group, deltaSeconds: number) => {
  (world.userData.unitSystem as UnitSystem | undefined)?.update(deltaSeconds);
  for (const update of world.userData.updates ?? []) update(deltaSeconds);
};

export const disposeWorld = (world: THREE.Group) => {
  world.userData.disposed = true;
  (world.userData.unitSystem as UnitSystem | undefined)?.dispose();
  for (const mixer of world.userData.mixers ?? []) mixer.stopAllAction();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  world.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Sprite)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    material.dispose();
  }
};
