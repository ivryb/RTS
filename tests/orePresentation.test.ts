import { expect, test } from "bun:test";
import * as THREE from "three";
import { sampleHeight } from "../src/map";
import { OrePresentation, Workface, type OreModelLoader } from "../src/orePresentation";
import { selectableEntityId } from "../src/unitInput";

const map = { size: 100, segments: 1, heights: new Float32Array(4) };
const deposit = { id: "ore-1", position: { x: 0, z: 0 }, radius: 3000, amount: 40, initialAmount: 40 };
const rock = (width: number, x = 0, z = 0) =>
  new THREE.Mesh(new THREE.BoxGeometry(width, 4, width).translate(x, 2, z), new THREE.MeshStandardMaterial());
const loadRocks = (...rocks: THREE.Mesh[]): OreModelLoader => async () => [new THREE.Group().add(...rocks)];

const faceHeights = (face: Workface) =>
  Array.from({ length: face.count }, (_, index) => face.points[index * 3 + 1]!);

test("ore is selectable and retains its shape when exhausted", async () => {
  const world = new THREE.Group();
  const ore = new OrePresentation(world, map, [deposit], loadRocks(rock(10)));
  await ore.ready;
  const root = ore.selectables[0]!;
  const visual = root.children[0]!;
  const scale = visual.scale.clone();
  expect(selectableEntityId(visual.children[0])).toBe(deposit.id);
  ore.update([{ ...deposit, amount: 0 }], new Set([deposit.id]));
  expect(visual.scale.equals(scale)).toBe(true);
  expect(root.children.find(child => child.userData.selectionOverlay)?.visible).toBe(true);
  ore.dispose();
  expect(world.children).toHaveLength(0);
});

test("a workface follows the rock's real surface from the ground to its top edge", async () => {
  const ore = new OrePresentation(new THREE.Group(), map, [deposit], loadRocks(rock(10)));
  await ore.ready;
  const face = new Workface();
  // The box is scaled into the 3 m footprint: its face is 2.12 m out, short of the footprint circle.
  expect(ore.traceWorkface(deposit.id, new THREE.Vector3(4, 0.95, 0), face)).toBe(true);
  const heights = faceHeights(face);
  expect(face.count).toBeGreaterThan(8);
  for (let index = 0; index < face.count; index += 1) {
    expect(face.points[index * 3]!).toBeCloseTo(3 / Math.SQRT2, 4);
    expect(face.points[index * 3 + 2]!).toBeCloseTo(0, 4);
  }
  expect(heights).toEqual([...heights].sort((a, b) => a - b));
  expect(heights[0]!).toBeGreaterThan(0.1);
  expect(heights[0]!).toBeLessThan(0.3);
  expect(heights.at(-1)!).toBeGreaterThan(1.5);
  expect(heights.at(-1)!).toBeLessThan(4 * 3 / (5 * Math.SQRT2) - 0.05);
  expect(ore.traceWorkface("missing", new THREE.Vector3(4, 1, 0), face)).toBe(false);
  ore.dispose();
});

test("on sloping ground a workface stays above the sand that buries the rock's foot", async () => {
  // The ground climbs 0.3 m per metre toward +x, so the face looking uphill is buried to 0.64 m.
  const slope = { size: 100, segments: 1, heights: new Float32Array([-15, 15, -15, 15]) };
  const ore = new OrePresentation(new THREE.Group(), slope, [deposit], loadRocks(rock(10)));
  await ore.ready;
  const face = new Workface();
  expect(ore.traceWorkface(deposit.id, new THREE.Vector3(5.5, 1.9, 0), face)).toBe(true);
  expect(face.count).toBeGreaterThan(4);
  for (let index = 0; index < face.count; index += 1) {
    const [x, y, z] = face.points.subarray(index * 3, index * 3 + 3);
    expect(y!).toBeGreaterThan(sampleHeight(slope, x!, z!) + 0.1);
  }
  ore.dispose();
});

test("a drone standing well above a low rock still reaches it", async () => {
  const ore = new OrePresentation(new THREE.Group(), map, [deposit], loadRocks(rock(10)));
  await ore.ready;
  const face = new Workface();
  // From 3.2 m up, the 1.65 m rock lies steeply below the nose: its side face or its top will do.
  expect(ore.traceWorkface(deposit.id, new THREE.Vector3(4, 3.2, 0), face)).toBe(true);
  expect(face.count).toBeGreaterThan(8);
  const top = 4 * 3 / (5 * Math.SQRT2) - 0.05;
  for (let index = 0; index < face.count; index += 1) {
    const [x, y] = face.points.subarray(index * 3, index * 3 + 2);
    const onSide = Math.abs(x! - 3 / Math.SQRT2) < 1e-4 && y! < top + 1e-4;
    const onTop = Math.abs(y! - top) < 1e-4 && x! < 3 / Math.SQRT2 + 1e-4;
    expect(onSide || onTop).toBe(true);
  }
  ore.dispose();
});

test("a workface lands on rock even when the deposit's centre is a gap between rocks", async () => {
  const ore = new OrePresentation(new THREE.Group(), map, [deposit], loadRocks(rock(4, 0, -3), rock(4, 0, 3)));
  await ore.ready;
  const face = new Workface();
  // Looking along the gap from +x, straight at the centre, there is nothing to hit.
  expect(ore.traceWorkface(deposit.id, new THREE.Vector3(4, 0.95, 0), face)).toBe(true);
  expect(face.count).toBeGreaterThan(8);
  expect(Math.abs(face.points[2]!)).toBeGreaterThan(0.3);
  ore.dispose();
});
