import * as THREE from "three";

export const SLICES = 48;
export const DIRECTIONS = 128;
/** Floats per direction of a deck row: how far the deck reaches, then where an air gap in it starts and ends. */
export const DECK_STRIDE = 4;
/** The gap start and end of a direction whose deck has no gap. */
export const NO_GAP = 1000;
/** A slice belongs to the main hull while its section keeps this share of the largest one's area. */
const HULL_SHARE = 0.1;
/** Share of directions a section may leave open and still be closed by a deck. */
const OPEN_SHARE = 0.1;
/** Metres of open air between two parts, such as a Turret's barrels, that a deck leaves open. */
const NARROWEST_GAP = 0.1;

const STEP = Math.PI * 2 / DIRECTIONS;
const cosines = Float32Array.from({ length: DIRECTIONS }, (_, direction) => Math.cos(direction * STEP - Math.PI));
const sines = Float32Array.from({ length: DIRECTIONS }, (_, direction) => Math.sin(direction * STEP - Math.PI));

/**
 * A building's outer outline: how far its surface reaches from its vertical axis, per height
 * slice and compass direction, in the building root's own frame. Direction `d` looks along the
 * angle `d * 2π / DIRECTIONS - π` from +x towards +z. The scaffold, the deck that closes the
 * cut and the welding points are all laid out from it.
 */
export interface Outline {
  /** Height of the model's lowest point above its root, and how tall it stands from there. */
  floor: number;
  height: number;
  /**
   * Top of the main hull as a fraction of the model's height. A thin part above it, such as
   * a dish on a mast, is left to stand proud of the scaffold.
   */
  roofline: number;
  /** The widest the main hull reaches from its axis, in metres. */
  radius: number;
  /**
   * `SLICES` rows of `DIRECTIONS` entries of `DECK_STRIDE` floats: the section a deck closes at
   * each height, widened to the sections just below and above it, so a deck gliding from row
   * to row never falls short of the hull. A reach is zero where no section surrounds the
   * axis, as on an off-centre mast. The gap is the open air the deck must not cover, such as
   * the space between a Turret's barrels.
   */
  decks: Float32Array;
  /** Sets `out.x` and `out.z` to the surface point at `height` (0 to 1) nearest to `angle`. */
  surface(height: number, angle: number, out: THREE.Vector3): void;
  /** How far the main hull reaches along the ground direction (x, z), a unit vector. */
  reach(x: number, z: number): number;
}

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const normal = new THREE.Vector3();
const edge = new THREE.Vector3();
const toRoot = new THREE.Matrix4();
const box = new THREE.Box3();

/** The model's box in its root's frame. */
const measureBounds = (rootInverse: THREE.Matrix4, visual: THREE.Object3D) => {
  const bounds = new THREE.Box3();
  visual.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    bounds.union(box.copy(geometry.boundingBox!).applyMatrix4(toRoot.multiplyMatrices(rootInverse, object.matrixWorld)));
  });
  return bounds;
};

/**
 * The widest stretch of open air along one direction's ray. `crossings` holds the distance of
 * every surface the ray passes, positive where it leaves a solid and negative where it enters
 * one. Parts overlap freely in the generated models, so air is where the ray is inside none.
 */
const widestGap = (crossings: number[]) => {
  crossings.sort((first, second) => Math.abs(first) - Math.abs(second));
  let inside = 0;
  for (const crossing of crossings) inside += crossing > 0 ? 1 : -1;
  let start = NO_GAP;
  let end = NO_GAP;
  for (let index = 0; index < crossings.length - 1; index += 1) {
    inside += crossings[index]! > 0 ? -1 : 1;
    const from = Math.abs(crossings[index]!);
    const to = Math.abs(crossings[index + 1]!);
    if (inside > 0 || crossings[index + 1]! > 0 || to - from < NARROWEST_GAP) continue;
    if (start === NO_GAP || to - from > end - start) {
      start = from;
      end = to;
    }
  }
  return [start, end] as const;
};

/**
 * Slices every triangle of `visual` once. `root` is the building's root, with its world matrix
 * current. A model with no meshes has no outline.
 */
export const measureOutline = (root: THREE.Object3D, visual: THREE.Object3D): Outline | undefined => {
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const bounds = measureBounds(rootInverse, visual);
  if (bounds.isEmpty()) return;
  const radii = new Float32Array(SLICES * DIRECTIONS);
  const crossings: (number[] | undefined)[] = new Array(SLICES * DIRECTIONS);
  const floor = bounds.min.y;
  const height = bounds.max.y - floor;
  const thickness = height / SLICES;
  const limit = bounds.min.distanceTo(bounds.max);

  /** Records where each direction's ray from the axis crosses the segment (x0, z0) to (x1, z1). */
  const mark = (row: number, x0: number, z0: number, x1: number, z1: number) => {
    const from = Math.atan2(z0, x0);
    let sweep = Math.atan2(z1, x1) - from;
    if (sweep > Math.PI) sweep -= Math.PI * 2;
    else if (sweep < -Math.PI) sweep += Math.PI * 2;
    const first = Math.ceil((Math.min(from, from + sweep) + Math.PI) / STEP);
    const last = Math.floor((Math.max(from, from + sweep) + Math.PI) / STEP);
    const edgeX = x1 - x0;
    const edgeZ = z1 - z0;
    const lever = x0 * edgeZ - z0 * edgeX;
    for (let turn = first; turn <= last; turn += 1) {
      const direction = (turn % DIRECTIONS + DIRECTIONS) % DIRECTIONS;
      const reach = lever / (cosines[direction]! * edgeZ - sines[direction]! * edgeX);
      if (!(reach > 0 && reach < limit)) continue;
      if (reach > radii[row + direction]!) radii[row + direction] = reach;
      const leaving = normal.x * cosines[direction]! + normal.z * sines[direction]! > 0;
      (crossings[row + direction] ??= []).push(leaving ? reach : -reach);
    }
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
    // A mirrored mesh winds its triangles the other way round.
    const facing = toRoot.determinant() < 0 ? -1 : 1;
    const corners = index ? index.count : position.count;
    for (let corner = 0; corner < corners; corner += 3) {
      a.fromBufferAttribute(position, index ? index.getX(corner) : corner).applyMatrix4(toRoot);
      b.fromBufferAttribute(position, index ? index.getX(corner + 1) : corner + 1).applyMatrix4(toRoot);
      c.fromBufferAttribute(position, index ? index.getX(corner + 2) : corner + 2).applyMatrix4(toRoot);
      const low = Math.max(0, Math.ceil((Math.min(a.y, b.y, c.y) - floor) / thickness - 0.5));
      const high = Math.min(SLICES - 1, Math.floor((Math.max(a.y, b.y, c.y) - floor) / thickness - 0.5));
      if (low > high) continue;
      normal.subVectors(b, a).cross(edge.subVectors(c, a)).multiplyScalar(facing);
      for (let slice = low; slice <= high; slice += 1) {
        const y = floor + (slice + 0.5) * thickness;
        cut.length = 0;
        cross(a, b, y, cut);
        cross(b, c, y, cut);
        cross(c, a, y, cut);
        if (cut.length >= 4) mark(slice * DIRECTIONS, cut[0]!, cut[1]!, cut[2]!, cut[3]!);
      }
    }
  });

  // A direction the surface never crosses at some height borrows the nearest one that it does,
  // so a welding point is never left hanging in the air at the axis.
  const nearest = new Uint8Array(SLICES * DIRECTIONS);
  const sections = new Float32Array(SLICES * DIRECTIONS);
  const gapStarts = new Float32Array(SLICES * DIRECTIONS).fill(NO_GAP);
  const gapEnds = new Float32Array(SLICES * DIRECTIONS).fill(NO_GAP);
  const areas = new Float32Array(SLICES);
  for (let slice = 0; slice < SLICES; slice += 1) {
    const row = slice * DIRECTIONS;
    let open = 0;
    for (let direction = 0; direction < DIRECTIONS; direction += 1) {
      const radius = radii[row + direction]!;
      areas[slice]! += radius * radius;
      let source = direction;
      for (let turn = 1; turn <= DIRECTIONS / 2 && !radii[row + source]; turn += 1) {
        source = (direction + turn) % DIRECTIONS;
        if (!radii[row + source]) source = (direction - turn + DIRECTIONS) % DIRECTIONS;
      }
      nearest[row + direction] = source;
      if (!radius) open += 1;
    }
    if (open > DIRECTIONS * OPEN_SHARE) continue;
    for (let direction = 0; direction < DIRECTIONS; direction += 1) {
      sections[row + direction] = radii[row + nearest[row + direction]!]!;
      const found = crossings[row + direction];
      if (found) [gapStarts[row + direction], gapEnds[row + direction]] = widestGap(found);
    }
  }
  const decks = new Float32Array(SLICES * DIRECTIONS * DECK_STRIDE);
  for (let index = 0; index < SLICES * DIRECTIONS; index += 1) {
    const below = index - DIRECTIONS;
    const above = index + DIRECTIONS;
    decks[index * DECK_STRIDE] = Math.max(sections[index]!, sections[below] ?? 0, sections[above] ?? 0);
    decks[index * DECK_STRIDE + 1] = gapStarts[index]!;
    decks[index * DECK_STRIDE + 2] = gapEnds[index]!;
  }

  const hull = Math.max(...areas) * HULL_SHARE;
  let roof = SLICES - 1;
  while (roof > 0 && areas[roof]! < hull) roof -= 1;
  /** The widest the main hull gets in each direction, whatever the height. */
  const plan = new Float32Array(DIRECTIONS);
  for (let index = 0; index < (roof + 1) * DIRECTIONS; index += 1) {
    plan[index % DIRECTIONS] = Math.max(plan[index % DIRECTIONS]!, radii[index]!);
  }

  return {
    floor,
    height,
    roofline: (roof + 1) / SLICES,
    radius: Math.max(...plan),
    decks,
    surface(at, angle, out) {
      const slice = Math.min(SLICES - 1, Math.max(0, Math.floor(at * SLICES)));
      const turn = Math.round((angle + Math.PI) / STEP);
      const direction = nearest[slice * DIRECTIONS + (turn % DIRECTIONS + DIRECTIONS) % DIRECTIONS]!;
      const radius = radii[slice * DIRECTIONS + direction]!;
      out.x = radius * cosines[direction]!;
      out.z = radius * sines[direction]!;
    },
    reach(x, z) {
      let reach = 0;
      for (let direction = 0; direction < DIRECTIONS; direction += 1) {
        reach = Math.max(reach, plan[direction]! * (cosines[direction]! * x + sines[direction]! * z));
      }
      return reach;
    },
  };
};
