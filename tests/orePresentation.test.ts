import { expect, test } from "bun:test";
import * as THREE from "three";
import { OrePresentation } from "../src/orePresentation";
import { selectableEntityId } from "../src/unitInput";

test("ore is selectable, gives an actual rock contact and retains its shape when exhausted", async () => {
  const world = new THREE.Group();
  const map = { size: 100, segments: 1, heights: new Float32Array(4) };
  const deposit = { id: "ore-1", position: { x: 0, z: 0 }, radius: 3000, amount: 40, initialAmount: 40 };
  const ore = new OrePresentation(world, map, [deposit], async () => {
    const model = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 10).translate(0, 2, 0), new THREE.MeshStandardMaterial());
    model.add(rock);
    return [model];
  });
  await ore.ready;
  const root = ore.selectables[0]!;
  const visual = root.children[0]!;
  const scale = visual.scale.clone();
  expect(selectableEntityId(visual.children[0])).toBe(deposit.id);
  const contact = ore.workface(deposit.id, new THREE.Vector3(4, 0.95, 0));
  expect(contact).toBeDefined();
  expect(contact!.x).toBeCloseTo(3 / Math.SQRT2, 4);
  expect(contact!.x).toBeLessThan(deposit.radius / 1000);
  expect(ore.workface("missing", new THREE.Vector3(4, 1, 0))).toBeUndefined();
  ore.update([{ ...deposit, amount: 0 }], new Set([deposit.id]));
  expect(visual.scale.equals(scale)).toBe(true);
  expect(root.children.find(child => child.userData.selectionOverlay)?.visible).toBe(true);
  ore.dispose();
  expect(world.children).toHaveLength(0);
});
