import * as THREE from "three";

/** One arm is six prisms: upper arm, forearm, shoulder and elbow joints, the torch and its nozzle. */
export const ARM_PARTS = 6;
/** Arms drawn at once, at most: two each for 128 working drones. More are left out. */
const MOST_ARMS = 256;
/** Metres from shoulder to elbow, and from elbow to the tip of the tool. */
const UPPER = 0.68;
const FORE = 0.68;
/** The share of its length an arm stretches to at most, so its elbow always shows a bend. */
const STRETCH = 0.93;
/** Metres across each prism. At the default zoom a metre is about 21 pixels. */
const UPPER_WIDTH = 0.085;
const FORE_WIDTH = 0.07;
const JOINT_WIDTH = 0.14;
const TORCH_WIDTH = 0.095;
const NOZZLE_WIDTH = 0.065;
/** Metres from the wrist to the tip of the tool, and the part of that which is its nozzle. */
const TORCH_LENGTH = 0.3;
const NOZZLE_LENGTH = 0.12;

/**
 * The graphite and ivory of the drone and the buildings: "Graphite machinery" and "Aged ivory
 * armor" in the Aged desert palette, `tools/assets/building_materials/palette.json`. Ivan asked
 * for dark arms with pale joints in D77-13, after seeing them thicker and orange.
 */
const GRAPHITE = new THREE.Color().setRGB(50 / 255, 46 / 255, 40 / 255, THREE.SRGBColorSpace);
const IVORY = new THREE.Color().setRGB(214 / 255, 188 / 255, 148 / 255, THREE.SRGBColorSpace);
/** The colour of each of an arm's parts, in the order they are placed: arm, arm, joint, joint, torch, nozzle. */
const COLOURS = [GRAPHITE, GRAPHITE, IVORY, IVORY, GRAPHITE, IVORY] as const;

const along = new THREE.Vector3();
const bend = new THREE.Vector3();
const hinge = new THREE.Vector3();
const elbow = new THREE.Vector3();
const from = new THREE.Vector3();
const to = new THREE.Vector3();
const side = new THREE.Vector3();

/**
 * The small jointed arms Scout Drones work with, all of them in one draw call. Refill it every
 * frame: `begin`, then `reach` once per arm.
 */
export class ScoutArms {
  private readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private count = 0;
  /** The part of the instance buffer to upload: one object, handed to three.js again every frame. */
  private readonly drawn = { start: 0, count: 0 };

  constructor(world: THREE.Object3D) {
    // A six-sided prism one metre long and across, standing on its end: an arm is a few pixels thick.
    const prism = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1).translate(0, 0.5, 0);
    this.mesh = new THREE.InstancedMesh(
      prism, new THREE.MeshStandardMaterial({ metalness: 0.18, roughness: 0.68 }), MOST_ARMS * ARM_PARTS,
    );
    this.mesh.name = "Scout tool arms";
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let part = 0; part < MOST_ARMS * ARM_PARTS; part += 1) this.mesh.setColorAt(part, COLOURS[part % ARM_PARTS]!);
    // The arms move every frame, so bounds for culling would have to be measured every frame too.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    world.add(this.mesh);
  }

  begin() {
    this.count = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /**
   * Draws one arm this frame from `shoulder` to `tip`, where its tool ends, both in the world.
   * Its elbow bends toward `pole`, a direction. `size`, from 0 to 1, scales the whole arm, so it
   * can grow out of the hull: at 0 nothing is drawn. A `tip` out of reach is pulled in to where
   * the arm ends, and `tip` is set to it.
   */
  reach(shoulder: THREE.Vector3, tip: THREE.Vector3, pole: THREE.Vector3, size: number) {
    if (size <= 0 || this.count === MOST_ARMS) return;
    const upper = UPPER * size;
    const fore = FORE * size;
    along.subVectors(tip, shoulder);
    const distance = THREE.MathUtils.clamp(along.length(), Math.abs(upper - fore) + 0.02 * size, (upper + fore) * STRETCH);
    if (along.lengthSq() < 1e-8) along.set(0, -1, 0);
    along.normalize();
    tip.copy(shoulder).addScaledVector(along, distance);
    // The elbow stands off the line from shoulder to tip, on the pole's side of it.
    bend.copy(pole).addScaledVector(along, -pole.dot(along));
    if (bend.lengthSq() < 1e-8) bend.set(along.y, -along.x, 0);
    bend.normalize();
    // Both joints turn about the same pin, square to the plane the arm bends in.
    hinge.crossVectors(along, bend).multiplyScalar(JOINT_WIDTH * 0.55 * size);
    const toElbow = (upper * upper - fore * fore + distance * distance) / (2 * distance);
    elbow.copy(shoulder).addScaledVector(along, toElbow)
      .addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - toElbow * toElbow)));
    along.subVectors(tip, elbow).normalize();
    const at = this.count * ARM_PARTS;
    this.count += 1;
    this.place(at, shoulder, elbow, UPPER_WIDTH * size);
    this.place(at + 1, elbow, from.copy(tip).addScaledVector(along, -TORCH_LENGTH * size), FORE_WIDTH * size);
    this.place(at + 2, from.subVectors(shoulder, hinge), to.addVectors(shoulder, hinge), JOINT_WIDTH * size);
    this.place(at + 3, from.subVectors(elbow, hinge), to.addVectors(elbow, hinge), JOINT_WIDTH * size);
    from.copy(tip).addScaledVector(along, -TORCH_LENGTH * size);
    to.copy(tip).addScaledVector(along, -NOZZLE_LENGTH * size);
    this.place(at + 4, from, to, TORCH_WIDTH * size);
    this.place(at + 5, to, tip, NOZZLE_WIDTH * size);
    this.mesh.count = this.count * ARM_PARTS;
    this.mesh.visible = true;
    const { updateRanges } = this.mesh.instanceMatrix;
    this.drawn.count = this.mesh.count * 16;
    updateRanges.length = 0;
    updateRanges.push(this.drawn);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Draws one arm far below the terrain, so loading compiles the shader instead of the first drone at work. */
  prepareRendering() {
    this.reach(from.set(0, -10_000, 0), to.set(0, -10_001, 0), side.set(1, 0, 0), 1);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  /** Stands prism `index` from `start` to `end`, `width` across. */
  private place(index: number, start: THREE.Vector3, end: THREE.Vector3, width: number) {
    const matrix = this.mesh.instanceMatrix.array;
    const at = index * 16;
    const x = end.x - start.x;
    const y = end.y - start.y;
    const z = end.z - start.z;
    const length = Math.hypot(x, y, z) || 1;
    // Any direction square to the prism's axis will do for its first side.
    if (Math.abs(y) < length * 0.9) side.set(-z, 0, x); else side.set(0, z, -y);
    side.normalize().multiplyScalar(width);
    matrix[at] = side.x;
    matrix[at + 1] = side.y;
    matrix[at + 2] = side.z;
    matrix[at + 3] = 0;
    matrix[at + 4] = x;
    matrix[at + 5] = y;
    matrix[at + 6] = z;
    matrix[at + 7] = 0;
    // The second side: the first crossed with the axis, at the same width.
    matrix[at + 8] = (side.y * z - side.z * y) / length;
    matrix[at + 9] = (side.z * x - side.x * z) / length;
    matrix[at + 10] = (side.x * y - side.y * x) / length;
    matrix[at + 11] = 0;
    matrix[at + 12] = start.x;
    matrix[at + 13] = start.y;
    matrix[at + 14] = start.z;
    matrix[at + 15] = 1;
  }
}
