import * as THREE from "three";
import type { SiteModel } from "../../sketch";

const PROFILE_STEPS = 64;
/**
 * Share of the build that follows raw height. The rest follows the model's volume, so a thin
 * mast is printed quickly and a wide hull slowly; this share keeps the top of the building from
 * flashing past in the last moments.
 */
const HEIGHT_SHARE = 0.4;
/**
 * Metres the build surface drops per metre away from the site's axis. Material spreads outward
 * from where the beam lands, so a level deck fills in over a few centimetres of progress.
 */
export const CONE_SLOPE = 0.05;
/** Cells of the solid grid along x, y and z. Buildings are wider than tall. */
const SOLID_CELLS = new THREE.Vector3(96, 64, 96);

/** What the print look derives from a building's triangles, once per building kind. */
export interface BuildingShape {
  height: number;
  /** Height the build surface must reach on the site's axis for its cone to clear the whole model. */
  surfaceTop: number;
  /** How far up the build surface is, from 0 on the ground to 1 at `surfaceTop`, at a construction progress. */
  surfaceAt(progress: number): number;
  /** 1 where the finished model is solid and 0 in the open. Shared by every site of the kind. */
  solid: THREE.Data3DTexture;
  /** Takes a point in the building root's space to its place in `solid`. */
  toSolid: THREE.Matrix4;
}

/** Every triangle of the model in the building root's space, nine numbers each. */
const collectTriangles = (model: SiteModel) => {
  const fromWorld = model.root.matrixWorld.clone().invert();
  const toRoot = new THREE.Matrix4();
  const corner = new THREE.Vector3();
  const meshes: Float32Array[] = [];
  model.visualRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry: THREE.BufferGeometry = object.geometry;
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    toRoot.multiplyMatrices(fromWorld, object.matrixWorld);
    const count = index ? index.count : position.count;
    const triangles = new Float32Array(count * 3);
    for (let at = 0; at < count; at += 1) {
      corner.fromBufferAttribute(position, index ? index.getX(at) : at).applyMatrix4(toRoot).toArray(triangles, at * 3);
    }
    meshes.push(triangles);
  });
  const triangles = new Float32Array(meshes.reduce((sum, mesh) => sum + mesh.length, 0));
  let offset = 0;
  for (const mesh of meshes) {
    triangles.set(mesh, offset);
    offset += mesh.length;
  }
  return triangles;
};

const measureSurface = (triangles: Float32Array, height: number) => {
  // Upward-facing area minus downward-facing area in each height step. Summed from the top
  // down it is the model's cross-section at that height, which needs no closed or tidy mesh.
  const facingUp = new Float64Array(PROFILE_STEPS);
  for (let at = 0; at < triangles.length; at += 9) {
    const ax = triangles[at]!;
    const az = triangles[at + 2]!;
    const up = ((triangles[at + 5]! - az) * (triangles[at + 6]! - ax) - (triangles[at + 3]! - ax) * (triangles[at + 8]! - az)) / 2;
    const ys = [triangles[at + 1]!, triangles[at + 4]!, triangles[at + 7]!];
    const low = Math.min(...ys) / height * PROFILE_STEPS;
    const high = Math.max(...ys) / height * PROFILE_STEPS;
    const first = THREE.MathUtils.clamp(Math.floor(low), 0, PROFILE_STEPS - 1);
    const last = THREE.MathUtils.clamp(Math.floor(high), first, PROFILE_STEPS - 1);
    // A triangle that spans several height steps gives each the share of its height inside it.
    for (let step = first; step <= last; step += 1) {
      const inside = first === last ? 1 : (Math.min(high, step + 1) - Math.max(low, step)) / (high - low);
      facingUp[step]! += up * Math.max(0, inside);
    }
  }

  const volume = new Float64Array(PROFILE_STEPS);
  let section = 0;
  for (let step = PROFILE_STEPS - 1; step >= 0; step -= 1) {
    const above = section;
    section += facingUp[step]!;
    volume[step] = Math.max(0, above + section) / 2;
  }
  const total = volume.reduce((sum, value) => sum + value, 0);
  // Work done once the surface has passed each step boundary, from 0 to 1.
  const work = new Float64Array(PROFILE_STEPS + 1);
  for (let step = 0; step < PROFILE_STEPS; step += 1) {
    work[step + 1] = work[step]! + (1 - HEIGHT_SHARE) * volume[step]! / total + HEIGHT_SHARE / PROFILE_STEPS;
  }
  const surfaceAt = new Float32Array(PROFILE_STEPS + 1);
  let step = 0;
  for (let sample = 0; sample <= PROFILE_STEPS; sample += 1) {
    const progress = sample / PROFILE_STEPS;
    while (step < PROFILE_STEPS - 1 && work[step + 1]! < progress) step += 1;
    const within = (progress - work[step]!) / (work[step + 1]! - work[step]!);
    surfaceAt[sample] = (step + THREE.MathUtils.clamp(within, 0, 1)) / PROFILE_STEPS;
  }
  return (progress: number) => {
    const at = THREE.MathUtils.clamp(progress, 0, 1) * PROFILE_STEPS;
    const sample = Math.min(PROFILE_STEPS - 1, Math.floor(at));
    return THREE.MathUtils.lerp(surfaceAt[sample]!, surfaceAt[sample + 1]!, at - sample);
  };
};

/**
 * Fills a grid of cells with whether each lies inside the model. The model is a pile of
 * overlapping shells, so a cell is solid when a ray dropped on it from above has entered more
 * shells than it has left.
 */
const measureSolid = (triangles: Float32Array, bounds: THREE.Box3) => {
  const { x: wide, y: tall, z: deep } = SOLID_CELLS;
  // Open cells all round, and an uneven margin so a symmetric model's vertices miss the cell centres.
  const size = bounds.getSize(new THREE.Vector3());
  const min = bounds.min.clone().addScaledVector(size, -0.041);
  size.multiplyScalar(1.089);
  const scale = SOLID_CELLS.clone().divide(size);

  const crossings = new Int8Array(wide * tall * deep);
  for (let at = 0; at < triangles.length; at += 9) {
    const ax = (triangles[at]! - min.x) * scale.x;
    const ay = (triangles[at + 1]! - min.y) * scale.y;
    const az = (triangles[at + 2]! - min.z) * scale.z;
    const bx = (triangles[at + 3]! - min.x) * scale.x;
    const by = (triangles[at + 4]! - min.y) * scale.y;
    const bz = (triangles[at + 5]! - min.z) * scale.z;
    const cx = (triangles[at + 6]! - min.x) * scale.x;
    const cy = (triangles[at + 7]! - min.y) * scale.y;
    const cz = (triangles[at + 8]! - min.z) * scale.z;
    // Twice the triangle's area seen from above, negative when it faces up.
    const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (area === 0) continue;
    const lastX = Math.floor(Math.max(ax, bx, cx) - 0.5);
    const lastZ = Math.floor(Math.max(az, bz, cz) - 0.5);
    for (let z = Math.ceil(Math.min(az, bz, cz) - 0.5); z <= lastZ; z += 1) {
      for (let x = Math.ceil(Math.min(ax, bx, cx) - 0.5); x <= lastX; x += 1) {
        const px = x + 0.5;
        const pz = z + 0.5;
        const shareA = ((bx - px) * (cz - pz) - (cx - px) * (bz - pz)) / area;
        const shareB = ((cx - px) * (az - pz) - (ax - px) * (cz - pz)) / area;
        const shareC = 1 - shareA - shareB;
        if (shareA < 0 || shareB < 0 || shareC < 0) continue;
        // The highest cell whose centre lies under the crossing.
        const y = Math.floor(shareA * ay + shareB * by + shareC * cy - 0.5);
        if (y >= 0) crossings[x + y * wide + z * wide * tall]! += area < 0 ? 1 : -1;
      }
    }
  }

  const solid = new Uint8Array(crossings.length);
  for (let z = 0; z < deep; z += 1) {
    for (let x = 0; x < wide; x += 1) {
      let shells = 0;
      for (let y = tall - 1; y >= 0; y -= 1) {
        const cell = x + y * wide + z * wide * tall;
        shells += crossings[cell]!;
        if (shells > 0) solid[cell] = 255;
      }
    }
  }
  const texture = new THREE.Data3DTexture(solid, wide, tall, deep);
  texture.format = THREE.RedFormat;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const toSolid = new THREE.Matrix4().makeScale(1 / size.x, 1 / size.y, 1 / size.z)
    .multiply(new THREE.Matrix4().makeTranslation(-min.x, -min.y, -min.z));
  return { solid: texture, toSolid };
};

export const measureShape = (model: SiteModel): BuildingShape => {
  const triangles = collectTriangles(model);
  const bounds = new THREE.Box3().setFromArray(triangles);
  const height = bounds.max.y;
  let surfaceTop = height;
  for (let at = 0; at < triangles.length; at += 3) {
    surfaceTop = Math.max(surfaceTop, triangles[at + 1]! + CONE_SLOPE * Math.hypot(triangles[at]!, triangles[at + 2]!));
  }
  return { height, surfaceTop, surfaceAt: measureSurface(triangles, height), ...measureSolid(triangles, bounds) };
};
