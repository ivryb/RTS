import { expect, test } from "bun:test";
import * as THREE from "three";
import { BehemothBarrage, BEHEMOTH_ROCKET_COUNT } from "../src/behemothBarrage";
import { generateMap } from "../src/map";

test("artillery uploads only active effects and stops after they expire", () => {
  const world = new THREE.Group();
  const barrage = new BehemothBarrage(world, generateMap(77));
  const effects = world.children.filter((object) => object instanceof THREE.Mesh
    || object instanceof THREE.Points || object instanceof THREE.LineSegments);
  const versions = () => effects.flatMap((effect) =>
    Object.values<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>(effect.geometry.attributes).map((attribute) =>
      attribute instanceof THREE.BufferAttribute ? attribute.version : attribute.data.version));
  const initial = versions();
  barrage.update(0.1);
  expect(versions()).toEqual(initial);
  expect(effects.every((effect) => effect.geometry.drawRange.count === 0)).toBe(true);
  const launches = Array.from({ length: BEHEMOTH_ROCKET_COUNT }, () => new THREE.Vector3(0, 3, 0));
  barrage.fire(launches, 12, 0, 77, 12);
  for (let index = 0; index < 30; index += 1) barrage.update(0.1);
  const scorch = effects.find((effect) => effect.name === "Behemoth scorch marks")!;
  expect(scorch.geometry.drawRange.count).toBeGreaterThan(0);
  expect(scorch.geometry.drawRange.count).toBeLessThan(scorch.geometry.index!.count);
  for (let index = 0; index < 500; index += 1) barrage.update(0.1);
  const expired = versions();
  barrage.update(0.1);
  expect(versions()).toEqual(expired);
  expect(effects.every((effect) => effect.geometry.drawRange.count === 0)).toBe(true);
  barrage.dispose();
});
