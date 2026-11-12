/** One mesh's triangles, with positions already in the building's own space (metres, y up). */
export interface PartSource {
  positions: Float32Array;
  index: ArrayLike<number>;
}

type Vec3 = [number, number, number];

export interface Part {
  /** Index of the source mesh this part belongs to; a part never spans two meshes. */
  mesh: number;
  min: Vec3;
  max: Vec3;
  /** Area-weighted centre of the part's surface. */
  centroid: Vec3;
  area: number;
}

export interface BuildingParts {
  /** In build order: lowest first, and around the building's axis within one level. */
  parts: Part[];
  /** For each source mesh, the index into `parts` of every triangle. */
  trianglePart: Uint16Array[];
  min: Vec3;
  max: Vec3;
}

export interface PartLimits {
  /** Parts whose bounding-box diagonal is shorter than this are merged into a neighbour. */
  minSize: number;
  /** Connected pieces longer than this are cut, when their triangles are small enough to cut cleanly. */
  maxSize: number;
  maxParts: number;
}

interface Cluster extends Part {
  /** Area-weighted centroid sum, so merged clusters keep an exact centroid. */
  weighted: Vec3;
  /** Longest bounding-box side of any single triangle: a cut can be no cleaner than this. */
  coarsest: number;
  merged?: Cluster;
  order: number;
}

const AXES = [0, 1, 2] as const;
const diagonal = ({ min, max }: Pick<Part, "min" | "max">) =>
  Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

const emptyCluster = (mesh: number): Cluster => ({
  mesh,
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
  centroid: [0, 0, 0],
  weighted: [0, 0, 0],
  area: 0,
  coarsest: 0,
  order: 0,
});

/** GLB vertices are split at UV and normal seams, so connectivity needs positions welded first. */
const weldVertices = (positions: Float32Array) => {
  const count = positions.length / 3;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  let extent = 0;
  for (const axis of AXES) {
    let high = -Infinity;
    for (let offset = axis; offset < positions.length; offset += 3) {
      min[axis] = Math.min(min[axis], positions[offset]!);
      high = Math.max(high, positions[offset]!);
    }
    extent = Math.max(extent, high - min[axis]);
  }
  // 17 bits per axis keeps the combined key an exact integer below 2^53. An open-addressed
  // table of those keys spares a Map entry per vertex on a 110,000-vertex model.
  const steps = 131071 / (extent || 1);
  const slots = 2 ** Math.ceil(Math.log2(count * 2 + 1));
  const keys = new Float64Array(slots).fill(-1);
  const ids = new Int32Array(slots);
  const welded = new Int32Array(count);
  let weldedCount = 0;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const offset = vertex * 3;
    const x = Math.round((positions[offset]! - min[0]) * steps);
    const y = Math.round((positions[offset + 1]! - min[1]) * steps);
    const z = Math.round((positions[offset + 2]! - min[2]) * steps);
    const key = (x * 131072 + y) * 131072 + z;
    let slot = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (slots - 1);
    while (keys[slot] !== -1 && keys[slot] !== key) slot = (slot + 1) & (slots - 1);
    if (keys[slot] === -1) {
      keys[slot] = key;
      ids[slot] = weldedCount;
      weldedCount += 1;
    }
    welded[vertex] = ids[slot]!;
  }
  return { welded, count: weldedCount };
};

/** Labels every triangle with the connected piece of surface it belongs to. */
const connectedPieces = ({ positions, index }: PartSource) => {
  const { welded, count } = weldVertices(positions);
  const parent = new Int32Array(count);
  for (let id = 0; id < count; id += 1) parent[id] = id;
  const find = (id: number) => {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]!]!;
      id = parent[id]!;
    }
    return id;
  };
  for (let corner = 0; corner < index.length; corner += 3) {
    const root = find(welded[index[corner]!]!);
    parent[find(welded[index[corner + 1]!]!)] = root;
    parent[find(welded[index[corner + 2]!]!)] = root;
  }
  const pieceOfRoot = new Map<number, number>();
  const pieces = new Int32Array(index.length / 3);
  for (let triangle = 0; triangle < pieces.length; triangle += 1) {
    const root = find(welded[index[triangle * 3]!]!);
    let piece = pieceOfRoot.get(root);
    if (piece === undefined) {
      piece = pieceOfRoot.size;
      pieceOfRoot.set(root, piece);
    }
    pieces[triangle] = piece;
  }
  return pieces;
};

const addTriangle = (cluster: Cluster, { positions, index }: PartSource, triangle: number) => {
  const a = index[triangle * 3]! * 3;
  const b = index[triangle * 3 + 1]! * 3;
  const c = index[triangle * 3 + 2]! * 3;
  const ux = positions[b]! - positions[a]!;
  const uy = positions[b + 1]! - positions[a + 1]!;
  const uz = positions[b + 2]! - positions[a + 2]!;
  const vx = positions[c]! - positions[a]!;
  const vy = positions[c + 1]! - positions[a + 1]!;
  const vz = positions[c + 2]! - positions[a + 2]!;
  const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  cluster.area += area;
  for (const axis of AXES) {
    const low = Math.min(positions[a + axis]!, positions[b + axis]!, positions[c + axis]!);
    const high = Math.max(positions[a + axis]!, positions[b + axis]!, positions[c + axis]!);
    cluster.min[axis] = Math.min(cluster.min[axis], low);
    cluster.max[axis] = Math.max(cluster.max[axis], high);
    cluster.coarsest = Math.max(cluster.coarsest, high - low);
    cluster.weighted[axis] += area
      * (positions[a + axis]! + positions[b + axis]! + positions[c + axis]!) / 3;
  }
};

const triangleCentre = ({ positions, index }: PartSource, triangle: number, axis: number) =>
  (positions[index[triangle * 3]! * 3 + axis]!
    + positions[index[triangle * 3 + 1]! * 3 + axis]!
    + positions[index[triangle * 3 + 2]! * 3 + axis]!) / 3;

/**
 * Halves a piece across its longest side until every half fits `maxSize`. Triangles go to the
 * half their centre lies in, so the cut follows triangle edges; a piece made of triangles too
 * large for that (a flat plate, a plain box) is left whole rather than torn into shards.
 */
const splitOversized = (
  cluster: Cluster,
  triangles: number[],
  source: PartSource,
  maxSize: number,
  output: (cluster: Cluster, triangles: number[]) => void,
) => {
  if (diagonal(cluster) <= maxSize || cluster.coarsest > maxSize * 0.3 || triangles.length < 64) {
    output(cluster, triangles);
    return;
  }
  const axis = AXES.reduce((longest, candidate) =>
    cluster.max[candidate] - cluster.min[candidate] > cluster.max[longest] - cluster.min[longest]
      ? candidate
      : longest);
  const middle = (cluster.min[axis] + cluster.max[axis]) / 2;
  const halves = [emptyCluster(cluster.mesh), emptyCluster(cluster.mesh)] as const;
  const halfTriangles: [number[], number[]] = [[], []];
  for (const triangle of triangles) {
    const side = triangleCentre(source, triangle, axis) < middle ? 0 : 1;
    addTriangle(halves[side], source, triangle);
    halfTriangles[side].push(triangle);
  }
  if (!halfTriangles[0].length || !halfTriangles[1].length) {
    output(cluster, triangles);
    return;
  }
  splitOversized(halves[0], halfTriangles[0], source, maxSize, output);
  splitOversized(halves[1], halfTriangles[1], source, maxSize, output);
};

const gap = (first: Cluster, second: Cluster) => {
  let squared = 0;
  for (const axis of AXES) {
    const distance = Math.max(first.min[axis] - second.max[axis], second.min[axis] - first.max[axis], 0);
    squared += distance * distance;
  }
  return Math.sqrt(squared);
};

const centreOf = (cluster: Cluster, axis: number) => cluster.weighted[axis]! / (cluster.area || 1);

const absorb = (target: Cluster, source: Cluster) => {
  for (const axis of AXES) {
    target.min[axis] = Math.min(target.min[axis], source.min[axis]);
    target.max[axis] = Math.max(target.max[axis], source.max[axis]);
    target.weighted[axis] += source.weighted[axis];
  }
  target.area += source.area;
  source.merged = target;
};

/**
 * Merges the smallest cluster into its nearest neighbour until every part is large enough to
 * read and the count fits. "Nearest" is the gap between bounding boxes, then the distance
 * between centres, so a bolt joins the foot it sits on rather than the plinth under both.
 */
const mergeSmall = (clusters: Cluster[], { minSize, maxParts }: PartLimits) => {
  const alive = new Set(clusters);
  const settled = new Set<Cluster>();
  while (alive.size > 1) {
    let smallest: Cluster | undefined;
    let smallestSize = Infinity;
    for (const cluster of alive) {
      if (settled.has(cluster)) continue;
      const size = diagonal(cluster);
      if (size < smallestSize) {
        smallest = cluster;
        smallestSize = size;
      }
    }
    if (!smallest || (smallestSize >= minSize && alive.size <= maxParts)) break;
    let nearest: Cluster | undefined;
    let nearestDistance = Infinity;
    for (const candidate of alive) {
      if (candidate === smallest || candidate.mesh !== smallest.mesh) continue;
      const centres = Math.hypot(
        centreOf(candidate, 0) - centreOf(smallest, 0),
        centreOf(candidate, 1) - centreOf(smallest, 1),
        centreOf(candidate, 2) - centreOf(smallest, 2),
      );
      const distance = gap(candidate, smallest) + centres * 0.25;
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    if (!nearest) {
      // The only part of its mesh: nothing to merge with, however small it is.
      settled.add(smallest);
      continue;
    }
    absorb(nearest, smallest);
    alive.delete(smallest);
  }
  return [...alive];
};

/**
 * Derives the kit of parts of any building from its triangles alone: connected pieces of
 * surface, cut where one is too large and merged where one is too small to read, ordered from
 * the ground up.
 */
export const deriveParts = (sources: readonly PartSource[], limits: PartLimits): BuildingParts => {
  const clusters: Cluster[] = [];
  const triangleCluster = sources.map((source, mesh) => {
    const pieces = connectedPieces(source);
    const trianglesOfPiece = new Map<number, number[]>();
    for (let triangle = 0; triangle < pieces.length; triangle += 1) {
      const piece = pieces[triangle]!;
      const list = trianglesOfPiece.get(piece);
      if (list) list.push(triangle);
      else trianglesOfPiece.set(piece, [triangle]);
    }
    const clusterOfTriangle = new Int32Array(pieces.length);
    for (const triangles of trianglesOfPiece.values()) {
      const piece = emptyCluster(mesh);
      for (const triangle of triangles) addTriangle(piece, source, triangle);
      splitOversized(piece, triangles, source, limits.maxSize, (cluster, members) => {
        for (const triangle of members) clusterOfTriangle[triangle] = clusters.length;
        clusters.push(cluster);
      });
    }
    return clusterOfTriangle;
  });

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const cluster of clusters) {
    for (const axis of AXES) {
      min[axis] = Math.min(min[axis], cluster.min[axis]);
      max[axis] = Math.max(max[axis], cluster.max[axis]);
    }
  }
  const all = [...clusters];
  const parts = mergeSmall(clusters, limits);
  for (const part of parts) {
    for (const axis of AXES) part.centroid[axis] = centreOf(part, axis);
  }

  // Lowest first. Parts that start within one level of each other go round the building's
  // axis in turn, the central one first, so four feet land one after another, not at random.
  const level = (max[1] - min[1]) * 0.08 || 1;
  const centreX = (min[0] + max[0]) / 2;
  const centreZ = (min[2] + max[2]) / 2;
  const reach = Math.hypot(max[0] - min[0], max[2] - min[2]) / 2 || 1;
  const sortKey = (part: Cluster) => {
    const x = part.centroid[0] - centreX;
    const z = part.centroid[2] - centreZ;
    const central = Math.hypot(x, z) < reach * 0.12;
    return Math.round(part.min[1] / level) * 10 + (central ? 0 : 1 + (Math.atan2(z, x) + Math.PI) / (Math.PI * 2));
  };
  parts.sort((first, second) => sortKey(first) - sortKey(second));
  parts.forEach((part, order) => {
    part.order = order;
  });

  const trianglePart = triangleCluster.map((clusterOfTriangle) => {
    const partOfTriangle = new Uint16Array(clusterOfTriangle.length);
    for (let triangle = 0; triangle < partOfTriangle.length; triangle += 1) {
      let cluster = all[clusterOfTriangle[triangle]!]!;
      while (cluster.merged) cluster = cluster.merged;
      partOfTriangle[triangle] = cluster.order;
    }
    return partOfTriangle;
  });
  return { parts, trianglePart, min, max };
};
