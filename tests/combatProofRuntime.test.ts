import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import type { GeneratedMap } from "../src/map";
import { replaceCombatProofWorld } from "../src/combatProofRuntime";

describe("combat proof runtime", () => {
  test("restarts the same seed through the real world replacement boundary", () => {
    const previous = new THREE.Group();
    previous.name = "previous world";
    const next = new THREE.Group();
    next.name = "next world";
    const map = { seed: 77 } as GeneratedMap;
    const calls: string[] = [];

    const loaded = replaceCombatProofWorld(previous, 77, {
      remove: (world) => calls.push(`remove ${world.name}`),
      dispose: (world) => calls.push(`dispose ${world.name}`),
      create: (seed) => {
        calls.push(`create ${seed}`);
        return { map, world: next };
      },
      add: (world) => calls.push(`add ${world.name}`),
      bindInput: (world) => calls.push(`bind ${world.name}`),
      resetOutcome: () => calls.push("reset outcome"),
    });

    expect(loaded).toEqual({ map, world: next });
    expect(calls).toEqual([
      "remove previous world",
      "dispose previous world",
      "create 77",
      "add next world",
      "bind next world",
      "reset outcome",
    ]);
  });
});
