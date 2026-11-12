import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** Metres of air kept between the building's bounding box and the scaffold. */
const CLEARANCE = 0.3;
/** Fraction of loose members (rails, braces, planks) knocked off a site with no health left. */
const BATTERED = 0.62;
const HANG_ANGLE = -1.05;

const pieceNames = ["Post", "Rail", "Brace", "Foot", "Pad", "Curb", "Deck", "Beacon"] as const;
type PieceName = typeof pieceNames[number];
/** Members a hit can knock loose; posts, feet and the pad always stand. */
const loose: Partial<Record<PieceName, "hangs" | "falls">> = { Rail: "hangs", Brace: "falls", Deck: "falls" };

export interface Cage {
  /** World positions of the four lamp lenses on the top corners. */
  beacons: readonly THREE.Vector3[];
  /** Ground corners of the pad in world space, walking around the site. */
  corners: readonly THREE.Vector3[];
  /**
   * `drop` lowers the whole scaffold into the ground, from 0 (standing) to 1 (gone, and no
   * longer drawn); `health` (0 to 1) decides which loose members hang or are missing.
   */
  set(drop: number, health: number): void;
  dispose(): void;
}

interface Member {
  piece: PieceName;
  matrix: THREE.Matrix4;
}

const kitUrl = new URL("./scaffold-kit.glb", import.meta.url);
const hang = new THREE.Matrix4().makeRotationZ(HANG_ANGLE);
/** A stable 0 to 1 number per member, so the same members fail at the same health every time. */
const chance = (index: number) => {
  const value = Math.sin(index * 12.9898 + 4.1414) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * Lays the kit out around a box in the building root's frame. Bays and lifts keep the kit's
 * fixed size; the cage grows by whole bays instead of stretching a part.
 */
const layOut = (bounds: THREE.Box3, bay: number, lift: number) => {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const baysX = Math.max(1, Math.ceil((size.x + CLEARANCE * 2) / bay));
  const baysZ = Math.max(1, Math.ceil((size.z + CLEARANCE * 2) / bay));
  // The scaffold stops at the nearest whole lift; a roof may stand a little proud of it.
  const lifts = Math.max(1, Math.round(size.y / lift));
  const x0 = center.x - baysX * bay / 2;
  const z0 = center.z - baysZ * bay / 2;
  const x1 = x0 + baysX * bay;
  const z1 = z0 + baysZ * bay;
  const floor = bounds.min.y;
  const members: Member[] = [];
  const add = (piece: PieceName, x: number, y: number, z: number, angle = 0) => {
    members.push({ piece, matrix: new THREE.Matrix4().makeRotationY(angle).setPosition(x, floor + y, z) });
  };

  for (let column = 0; column < baysX; column += 1) {
    for (let row = 0; row < baysZ; row += 1) add("Pad", x0 + column * bay, 0, z0 + (row + 1) * bay);
  }
  // Each face walks its bays with the outside of the site on its own +Z.
  const faces = [
    { x: x0, z: z1, bays: baysX },
    { x: x1, z: z1, bays: baysZ },
    { x: x1, z: z0, bays: baysX },
    { x: x0, z: z0, bays: baysZ },
  ];
  const corners: THREE.Vector3[] = [];
  faces.forEach((face, side) => {
    const angle = side * Math.PI / 2;
    const alongX = Math.cos(angle);
    const alongZ = -Math.sin(angle);
    corners.push(new THREE.Vector3(face.x, floor, face.z));
    add("Beacon", face.x, lifts * lift, face.z, angle);
    for (let index = 0; index < face.bays; index += 1) {
      const x = face.x + alongX * index * bay;
      const z = face.z + alongZ * index * bay;
      add("Foot", x, 0, z, angle);
      add("Curb", x, 0, z, angle);
      // Alternate faces lap their planks over the neighbours' at the corners.
      if (lifts >= 3) add("Deck", x, (lifts - 1) * lift + (side % 2) * 0.045, z, angle);
      const braced = Math.min(index, face.bays - 1 - index) % 2 === 0;
      for (let level = 0; level < lifts; level += 1) {
        add("Post", x, level * lift, z, angle);
        add("Rail", x, (level + 1) * lift, z, angle);
        if (!braced) continue;
        // Braces zigzag up the face; a brace leaning the other way is the same part turned round.
        const leansBack = (level + (index < face.bays / 2 ? 0 : 1)) % 2 === 1;
        if (leansBack) add("Brace", x + alongX * bay, level * lift, z + alongZ * bay, angle + Math.PI);
        else add("Brace", x, level * lift, z, angle);
      }
    }
  });
  return { members, corners, height: lifts * lift };
};

/**
 * Every site's scaffold, drawn in one call: a single BatchedMesh holds the kit's pieces and
 * one transform per placed member, whatever the number of sites.
 */
export class Scaffolding {
  private readonly batch: THREE.BatchedMesh;
  private readonly geometryIds = new Map<PieceName, number>();
  private readonly hitTester: THREE.Mesh;
  private capacity = 2048;
  private used = 0;

  private constructor(
    scene: THREE.Scene,
    private readonly pieces: Record<PieceName, THREE.BufferGeometry>,
    material: THREE.Material,
    private readonly bay: number,
    private readonly lift: number,
  ) {
    const geometries = Object.values(pieces);
    const vertices = geometries.reduce((total, geometry) => total + geometry.getAttribute("position").count, 0);
    const indices = geometries.reduce((total, geometry) => total + (geometry.getIndex()?.count ?? 0), 0);
    this.batch = new THREE.BatchedMesh(this.capacity, vertices, indices, material);
    this.batch.name = "Construction scaffolds";
    // Members never move between frames, so the per-frame culling and sorting passes are off:
    // the draw list is rebuilt only when a scaffold appears, sinks or loses a member.
    this.batch.perObjectFrustumCulled = false;
    this.batch.sortObjects = false;
    this.batch.frustumCulled = false;
    this.batch.receiveShadow = true;
    for (const name of pieceNames) this.geometryIds.set(name, this.batch.addGeometry(pieces[name]));
    this.hitTester = new THREE.Mesh(pieces.Post, material);
    scene.add(this.batch);
  }

  static async load(scene: THREE.Scene) {
    const { scene: kit } = await new GLTFLoader().loadAsync(kitUrl.href);
    const { bay, lift } = kit.getObjectByName("ScaffoldKit")!.userData as { bay: number; lift: number };
    let material: THREE.Material | undefined;
    const pieces = Object.fromEntries(pieceNames.map((name) => {
      const mesh = kit.getObjectByName(`Scaffold${name}`) as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      material = mesh.material;
      return [name, mesh.geometry];
    })) as Record<PieceName, THREE.BufferGeometry>;
    return new Scaffolding(scene, pieces, material!, bay, lift);
  }

  /** `bounds` is the building's box in `root`'s frame; the cage follows the root's rotation. */
  createCage(root: THREE.Object3D, bounds: THREE.Box3): Cage {
    const { batch, pieces, hitTester } = this;
    const { members, corners, height } = layOut(bounds, this.bay, this.lift);
    this.used += members.length;
    if (this.used > this.capacity) {
      this.capacity = Math.max(this.capacity * 2, this.used);
      batch.setInstanceCount(this.capacity);
    }
    // Members stay hidden until the first `set` places them.
    const ids = members.map(({ piece, matrix }) => {
      matrix.premultiply(root.matrixWorld);
      const id = batch.addInstance(this.geometryIds.get(piece)!);
      batch.setVisibleAt(id, false);
      return id;
    });
    for (const corner of corners) corner.applyMatrix4(root.matrixWorld);
    const beacons = members.filter(({ piece }) => piece === "Beacon")
      .map(({ matrix }) => new THREE.Vector3(0, 0.44, 0).applyMatrix4(matrix));
    // Tall enough to take the lamps on the top corners under the ground when it drops.
    const depth = height + 0.6;
    const reach = new THREE.Box3().setFromPoints(corners);
    reach.max.y += depth;
    reach.expandByScalar(0.3);

    // What the player sees is what a click hits: the members as they currently stand.
    const shown = new Uint8Array(members.length);
    const placed = members.map(() => new THREE.Matrix4());
    const pick = new THREE.Object3D();
    pick.name = "Scaffold pick";
    pick.raycast = (raycaster, hits) => {
      if (!raycaster.ray.intersectsBox(reach)) return;
      const first = hits.length;
      members.forEach(({ piece }, index) => {
        if (!shown[index]) return;
        hitTester.geometry = pieces[piece];
        hitTester.matrixWorld.copy(placed[index]);
        hitTester.raycast(raycaster, hits);
      });
      for (let index = first; index < hits.length; index += 1) hits[index].object = pick;
    };
    root.add(pick);

    let appliedDrop = -1;
    let appliedDamage = -1;
    return {
      beacons,
      corners,
      set(drop, health) {
        // Twenty damage steps: members fail one at a time without rewriting every frame.
        const damage = Math.round((1 - health) * 20) / 20;
        if (drop === appliedDrop && damage === appliedDamage) return;
        appliedDrop = drop;
        appliedDamage = damage;
        const standing = drop < 1;
        members.forEach(({ piece, matrix }, index) => {
          const failure = loose[piece];
          const failed = failure !== undefined && chance(index) < damage * BATTERED;
          const visible = standing && !(failed && (failure === "falls" || chance(index + 0.5) < 0.5));
          if (shown[index] !== Number(visible)) batch.setVisibleAt(ids[index], visible);
          shown[index] = Number(visible);
          if (!visible) return;
          placed[index].copy(matrix);
          if (failed) placed[index].multiply(hang);
          placed[index].elements[13] -= drop * depth;
          batch.setMatrixAt(ids[index], placed[index]);
        });
      },
      dispose: () => {
        for (const id of ids) batch.deleteInstance(id);
        this.used -= members.length;
        root.remove(pick);
      },
    };
  }
}
