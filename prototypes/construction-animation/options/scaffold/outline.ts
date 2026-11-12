import * as THREE from "three";

const SLICES = 24;
const DIRECTIONS = 48;
/** Metres between samples along a cross-section edge. */
const STEP = 0.12;

/**
 * How far a building's surface reaches from its vertical axis, per height slice and compass
 * direction, in the building root's own frame. Welding points sit on it, so the work always
 * touches the real hull at the height being built.
 */
export interface Outline {
  /** Surface distance from the axis at `height` (0 ground to 1 top), towards `angle`. */
  radius(height: number, angle: number): number;
}

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const toRoot = new THREE.Matrix4();

/** Slices every triangle once: about 4 ms for the 76,290-triangle Command Center. */
export const measureOutline = (root: THREE.Object3D, visual: THREE.Object3D, bounds: THREE.Box3): Outline => {
  const radii = new Float32Array(SLICES * DIRECTIONS);
  const floor = bounds.min.y;
  const thickness = (bounds.max.y - floor) / SLICES;
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const mark = (x: number, z: number, slice: number) => {
    const direction = Math.floor((Math.atan2(z, x) / (Math.PI * 2) + 0.5) * DIRECTIONS) % DIRECTIONS;
    const index = slice * DIRECTIONS + direction;
    const reach = Math.hypot(x, z);
    if (reach > radii[index]) radii[index] = reach;
  };
  /** Appends the point where the edge from `p` to `q` crosses height `y`, when it does. */
  const cross = (p: THREE.Vector3, q: THREE.Vector3, y: number, out: number[]) => {
    if ((p.y - y) * (q.y - y) > 0 || p.y === q.y) return;
    const t = (y - p.y) / (q.y - p.y);
    out.push(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t);
  };
  const cut: number[] = [];

  visual.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    toRoot.multiplyMatrices(rootInverse, object.matrixWorld);
    const corners = index ? index.count : position.count;
    for (let corner = 0; corner < corners; corner += 3) {
      a.fromBufferAttribute(position, index ? index.getX(corner) : corner).applyMatrix4(toRoot);
      b.fromBufferAttribute(position, index ? index.getX(corner + 1) : corner + 1).applyMatrix4(toRoot);
      c.fromBufferAttribute(position, index ? index.getX(corner + 2) : corner + 2).applyMatrix4(toRoot);
      const low = Math.max(0, Math.ceil((Math.min(a.y, b.y, c.y) - floor) / thickness - 0.5));
      const high = Math.min(SLICES - 1, Math.floor((Math.max(a.y, b.y, c.y) - floor) / thickness - 0.5));
      for (let slice = low; slice <= high; slice += 1) {
        const y = floor + (slice + 0.5) * thickness;
        cut.length = 0;
        cross(a, b, y, cut);
        cross(b, c, y, cut);
        cross(c, a, y, cut);
        if (cut.length < 4) continue;
        const steps = Math.max(1, Math.ceil(Math.hypot(cut[2] - cut[0], cut[3] - cut[1]) / STEP));
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          mark(cut[0] + (cut[2] - cut[0]) * t, cut[1] + (cut[3] - cut[1]) * t, slice);
        }
      }
    }
  });

  // A direction the hull never crosses at some height borrows its nearest neighbour, then the
  // slice below, so a welding point is never left hanging in the air at the axis.
  for (let slice = 0; slice < SLICES; slice += 1) {
    const row = radii.subarray(slice * DIRECTIONS, (slice + 1) * DIRECTIONS);
    const measured = row.slice();
    for (let direction = 0; direction < DIRECTIONS; direction += 1) {
      for (let reach = 0; reach <= DIRECTIONS / 2 && !row[direction]; reach += 1) {
        row[direction] = measured[(direction + reach) % DIRECTIONS]
          || measured[(direction - reach + DIRECTIONS) % DIRECTIONS];
      }
      if (!row[direction] && slice > 0) row[direction] = radii[(slice - 1) * DIRECTIONS + direction];
    }
  }

  return {
    radius(height, angle) {
      const slice = Math.min(SLICES - 1, Math.max(0, Math.floor(height * SLICES)));
      const turn = angle / (Math.PI * 2) + 0.5;
      const direction = Math.floor((turn - Math.floor(turn)) * DIRECTIONS) % DIRECTIONS;
      return radii[slice * DIRECTIONS + direction];
    },
  };
};
