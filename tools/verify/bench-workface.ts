// Cost of tracing one workface on a 9,680-triangle rock, against casting as many rays with
// THREE.Raycaster. Needs no browser. Usage: bun tools/verify/bench-workface.ts
import * as THREE from "three";
import { OrePresentation, Workface } from "../../src/orePresentation";

const map = { size: 100, segments: 1, heights: new Float32Array(4) };
const deposit = { id: "ore-1", position: { x: 0, z: 0 }, radius: 3000, amount: 40, initialAmount: 40 };
const geometry = new THREE.IcosahedronGeometry(4, 21).translate(0, 1.5, 0);
console.log("triangles", geometry.getAttribute("position").count / 3);
const ore = new OrePresentation(new THREE.Group(), map, [deposit], async () =>
  [new THREE.Group().add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()))]);
await ore.ready;
const face = new Workface();
/** As many rays as a workface has samples. */
const RAYS = face.points.length / 3;
const origin = new THREE.Vector3();
const run = (count: number) => {
  let hits = 0;
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const angle = index * 0.618;
    origin.set(Math.cos(angle) * 4.5, 0.97, Math.sin(angle) * 4.5);
    if (ore.traceWorkface(deposit.id, origin, face)) hits += face.count;
  }
  return { microseconds: (performance.now() - started) / count * 1000, pointsPerTrace: hits / count };
};
run(200);
console.log("slice trace", [run(2000), run(2000), run(2000)]);

const raycaster = new THREE.Raycaster();
const visual = ore.selectables[0]!.children[0]!;
const direction = new THREE.Vector3();
const rays = (count: number) => {
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const angle = index * 0.618;
    origin.set(Math.cos(angle) * 4.5, 0.97, Math.sin(angle) * 4.5);
    for (let sample = 0; sample < RAYS; sample += 1) {
      raycaster.set(origin, direction.set(-origin.x, sample * 0.05 - 0.8, -origin.z).normalize());
      raycaster.intersectObject(visual, true);
    }
  }
  return (performance.now() - started) / count * 1000;
};
rays(20);
console.log(`${RAYS} raycasts, microseconds`, [rays(200), rays(200), rays(200)]);
