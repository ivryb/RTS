import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** Fraction of loose members (rails, braces) knocked off a site with no health left. */
const BATTERED = 0.62;
const HANG_ANGLE = -1.05;
/**
 * The game's fixed camera looks from +x +z. A side of the site whose outward face turns this
 * far towards it stays open, down to its kerb, so the building's front reads through.
 */
const TOWARD_CAMERA = new THREE.Vector2(Math.SQRT1_2, Math.SQRT1_2);
const OPEN_FACING = 0.3;
/** Half the gap left between two road plates of the pad. */
const JOINT = 0.015;
/**
 * Metres a lamp sinks into its post while the scaffold drops. A lamp is the last thing above
 * the ground, and without this its head was left there alone for a frame or two.
 */
const LAMP_RETRACT = 0.3;

const pieceNames = ["Post", "Rail", "Brace", "Foot", "Pad", "PadCut", "Curb", "Beacon"] as const;
type PieceName = typeof pieceNames[number];
/** Members a hit can knock loose; posts, feet and the pad always stand. */
const loose: Partial<Record<PieceName, "hangs" | "falls">> = { Rail: "hangs", Brace: "falls" };

export interface Cage {
  /** World positions of the lamp lenses, one on every corner. */
  beacons: readonly THREE.Vector3[];
  /**
   * `drop` lowers the whole scaffold into the ground, from 0 (standing) to 1 (gone, and no
   * longer drawn); `health` (0 to 1) decides which loose members hang or are missing.
   */
  set(drop: number, health: number): void;
  dispose(): void;
}

/** Sizes the kit's generator records on its root: nominal bay and lift, and where a lamp stands. */
interface KitSizes {
  bay: number;
  lift: number;
  post_top: number;
  jack_top: number;
}

interface Member {
  piece: PieceName;
  matrix: THREE.Matrix4;
}

const kitUrl = new URL("./scaffold-kit.glb", import.meta.url);
const hang = new THREE.Matrix4().makeRotationZ(HANG_ANGLE);

interface Side {
  start: THREE.Vector3;
  length: number;
  alongX: number;
  alongZ: number;
  /** True for a side that stays open towards the camera. */
  open: boolean;
}

/** Cuts off the part of a ground polygon outside `side`; an untouched polygon comes back as is. */
const trim = (shape: THREE.Vector3[], { start, alongX, alongZ }: Side) => {
  const beyond = shape.map((point) => (point.z - start.z) * alongX - (point.x - start.x) * alongZ > 1e-4);
  if (!beyond.includes(true)) return shape;
  const kept: THREE.Vector3[] = [];
  shape.forEach((point, index) => {
    const next = shape[(index + 1) % shape.length];
    if (!beyond[index]) kept.push(point);
    if (beyond[index] === beyond[(index + 1) % shape.length]) return;
    const from = (point.z - start.z) * alongX - (point.x - start.x) * alongZ;
    const to = (next.z - start.z) * alongX - (next.x - start.x) * alongZ;
    kept.push(new THREE.Vector3().lerpVectors(point, next, from / (from - to)));
  });
  return kept;
};
/** A stable 0 to 1 number per member, so the same members fail at the same health every time. */
const chance = (index: number) => {
  const value = Math.sin(index * 12.9898 + 4.1414) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * Stands the kit on a convex ground outline, walked so that each side's outside is on its
 * right. Members are fitted to a side by scaling them along their own length only, so tubes
 * keep their thickness whatever the size of the site.
 */
const layOut = (corners: THREE.Vector3[], height: number, kit: KitSizes) => {
  const members: Member[] = [];
  const lifts = Math.max(1, Math.round(height / kit.lift));
  const lift = height / lifts;
  const climb = lift / kit.lift;
  /** Places a piece at `x, y, z` with its length along the ground direction (alongX, alongZ). */
  const add = (piece: PieceName, x: number, y: number, z: number, alongX: number, alongZ: number, stretch = 1, rise = 1) => {
    members.push({
      piece,
      matrix: new THREE.Matrix4().set(
        alongX * stretch, 0, -alongZ, x,
        0, rise, 0, y,
        alongZ * stretch, 0, alongX, z,
        0, 0, 0, 1,
      ),
    });
  };

  const sides = corners.map((start, index): Side => {
    const end = corners[(index + 1) % corners.length];
    const length = start.distanceTo(end);
    const alongX = (end.x - start.x) / length;
    const alongZ = (end.z - start.z) / length;
    const open = -alongZ * TOWARD_CAMERA.x + alongX * TOWARD_CAMERA.y > OPEN_FACING;
    return { start, length, alongX, alongZ, open };
  });

  // The pad: road plates on a grid square to the map, cut where a slanted side crosses them.
  const box = new THREE.Box3().setFromPoints(corners);
  const columns = Math.max(1, Math.round((box.max.x - box.min.x) / kit.bay));
  const rows = Math.max(1, Math.round((box.max.z - box.min.z) / kit.bay));
  const width = (box.max.x - box.min.x) / columns;
  const depth = (box.max.z - box.min.z) / rows;
  const middle = new THREE.Vector3();
  for (let cell = 0; cell < columns * rows; cell += 1) {
    const x = box.min.x + (cell % columns) * width;
    const z = box.min.z + Math.floor(cell / columns) * depth;
    const whole = [[x, z], [x + width, z], [x + width, z + depth], [x, z + depth]]
      .map(([cornerX, cornerZ]) => new THREE.Vector3(cornerX, box.min.y, cornerZ));
    const plate = sides.reduce(trim, whole);
    if (plate.length < 3) continue;
    if (plate === whole) {
      members.push({
        piece: "Pad",
        matrix: new THREE.Matrix4().makeScale((width - JOINT * 2) / kit.bay, 1, (depth - JOINT * 2) / kit.bay)
          .setPosition(x + JOINT, box.min.y, z + JOINT),
      });
      continue;
    }
    // A cut plate is a fan of sheared triangles, drawn in from its edges to leave the joint.
    middle.set(0, 0, 0);
    for (const corner of plate) middle.addScaledVector(corner, 1 / plate.length);
    for (const corner of plate) corner.lerp(middle, JOINT * 2 / Math.min(width, depth));
    const [hub, ...rim] = plate;
    for (let index = 1; index < rim.length; index += 1) {
      const from = rim[index - 1];
      const to = rim[index];
      members.push({
        piece: "PadCut",
        matrix: new THREE.Matrix4().set(
          (from.x - hub.x) / kit.bay, 0, (to.x - hub.x) / kit.bay, hub.x,
          0, 1, 0, hub.y,
          (from.z - hub.z) / kit.bay, 0, (to.z - hub.z) / kit.bay, hub.z,
          0, 0, 0, 1,
        ),
      });
    }
  }

  sides.forEach(({ start, length, alongX, alongZ, open }, index) => {
    const { x, y, z } = start;
    const bays = Math.max(1, Math.round(length / kit.bay));
    const bay = length / bays;
    const stretch = bay / kit.bay;
    // A corner post serves both sides that meet at it, so it stands if either is a wall.
    const cornerStands = !open || !sides[(index + sides.length - 1) % sides.length].open;
    add("Beacon", x, y + (cornerStands ? (lifts - 1) * lift + kit.post_top * climb : kit.jack_top), z, alongX, alongZ);
    for (let step = 0; step < bays; step += 1) {
      const nodeX = x + alongX * bay * step;
      const nodeZ = z + alongZ * bay * step;
      add("Foot", nodeX, y, nodeZ, alongX, alongZ);
      add("Curb", nodeX, y, nodeZ, alongX, alongZ, stretch);
      const braced = Math.min(step, bays - 1 - step) % 2 === 0;
      for (let level = 0; level < lifts; level += 1) {
        if (step ? !open : cornerStands) add("Post", nodeX, y + level * lift, nodeZ, alongX, alongZ, 1, climb);
        if (open) continue;
        add("Rail", nodeX, y + (level + 1) * lift, nodeZ, alongX, alongZ, stretch);
        if (!braced) continue;
        // Braces zigzag up the wall; a brace leaning the other way is the same part turned round.
        const leansBack = (level + (step < bays / 2 ? 0 : 1)) % 2 === 1;
        if (leansBack) add("Brace", nodeX + alongX * bay, y + level * lift, nodeZ + alongZ * bay, -alongX, -alongZ, stretch, climb);
        else add("Brace", nodeX, y + level * lift, nodeZ, alongX, alongZ, stretch, climb);
      }
    }
  });
  // Deep enough to take the lamps on the post tops under the ground when it drops.
  return { members, depth: (lifts - 1) * lift + (kit.post_top + 0.25) * climb };
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
    private readonly kit: KitSizes,
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
    this.batch.castShadow = true;
    for (const name of pieceNames) this.geometryIds.set(name, this.batch.addGeometry(pieces[name]));
    this.hitTester = new THREE.Mesh(pieces.Post, material);
    scene.add(this.batch);
  }

  static async load(scene: THREE.Scene) {
    const { scene: kit } = await new GLTFLoader().loadAsync(kitUrl.href);
    let material: THREE.Material | undefined;
    const pieces = Object.fromEntries(pieceNames.map((name) => {
      const mesh = kit.getObjectByName(`Scaffold${name}`) as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      material = mesh.material;
      return [name, mesh.geometry];
    })) as Record<PieceName, THREE.BufferGeometry>;
    // Only faces turned away from the sun go into the shadow map, or the pad shades itself in stripes.
    material!.shadowSide = THREE.BackSide;
    return new Scaffolding(scene, pieces, material!, kit.getObjectByName("ScaffoldKit")!.userData as KitSizes);
  }

  /**
   * `corners` is the site's ground outline in world space, convex and walked with the outside
   * on the right; walls stand `height` tall. `root` owns the scaffold's pick target.
   */
  createCage(root: THREE.Object3D, corners: THREE.Vector3[], height: number): Cage {
    const { batch, pieces, hitTester } = this;
    const { members, depth } = layOut(corners, height, this.kit);
    this.used += members.length;
    if (this.used > this.capacity) {
      this.capacity = Math.max(this.capacity * 2, this.used);
      batch.setInstanceCount(this.capacity);
    }
    // Members stay hidden until the first `set` places them.
    const ids = members.map(({ piece }) => {
      const id = batch.addInstance(this.geometryIds.get(piece)!);
      batch.setVisibleAt(id, false);
      return id;
    });
    const beacons = members.filter(({ piece }) => piece === "Beacon")
      .map(({ matrix }) => new THREE.Vector3(0, 0.14, 0).applyMatrix4(matrix));
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
          placed[index].elements[13] -= drop * (piece === "Beacon" ? depth + LAMP_RETRACT : depth);
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
