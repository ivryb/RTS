import { expect, test } from "bun:test";
import * as THREE from "three";
import { miningLook, ScoutLasers } from "../src/scoutLaser";

test("draws every laser fired in a frame, however many, and none in a frame without any", () => {
  const world = new THREE.Group();
  const lasers = new ScoutLasers(world, miningLook);
  const mesh = world.getObjectByName("Scout mining lasers") as THREE.Mesh<THREE.InstancedBufferGeometry>;
  expect(mesh.visible).toBe(false);
  lasers.begin(1 / 60);
  // More than its first buffer holds, so the buffer has to grow without losing earlier lasers.
  for (let index = 0; index < 100; index += 1) {
    lasers.fire(new THREE.Vector3(index, 1, 0), new THREE.Vector3(index, 2, 3), new THREE.Vector3(index, 2, 3), 0.5, index / 100);
  }
  expect(mesh.visible).toBe(true);
  expect(mesh.geometry.instanceCount).toBe(100);
  for (const index of [0, 31, 32, 99]) {
    expect(mesh.geometry.getAttribute("beamStart").getX(index)).toBe(index);
    expect(mesh.geometry.getAttribute("beamEnd").getZ(index)).toBe(3);
    // Each laser keeps its own strength, so one can fade while the others burn.
    expect(mesh.geometry.getAttribute("beamPower").getX(index)).toBeCloseTo(index / 100);
  }
  lasers.begin(1 / 60);
  expect(mesh.visible).toBe(false);
  lasers.dispose();
  expect(world.children).toHaveLength(0);
});
