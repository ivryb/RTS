import type * as THREE from "three";
import type { GeneratedMap } from "./map";

interface CombatProofWorld {
  map: GeneratedMap;
  world: THREE.Group;
}

interface CombatProofWorldLifecycle {
  remove: (world: THREE.Group) => void;
  dispose: (world: THREE.Group) => void;
  create: (seed: number) => CombatProofWorld;
  add: (world: THREE.Group) => void;
  bindInput: (world: THREE.Group) => void;
  resetOutcome: () => void;
}

/** Replaces every world-bound part of an encounter before restart or map generation returns. */
export const replaceCombatProofWorld = (
  previous: THREE.Group | undefined,
  seed: number,
  lifecycle: CombatProofWorldLifecycle,
) => {
  if (previous) {
    lifecycle.remove(previous);
    lifecycle.dispose(previous);
  }
  const loaded = lifecycle.create(seed);
  lifecycle.add(loaded.world);
  lifecycle.bindInput(loaded.world);
  lifecycle.resetOutcome();
  return loaded;
};
