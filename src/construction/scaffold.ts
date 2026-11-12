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
/** Metres the pad and its kerbs sink to clear the ground. */
const PAD_DEPTH = 0.34;
/** Share of the drop by which the walls have gone into the pad, and after which the pad itself sinks. */
const WALLS_DOWN = 0.72;
const PAD_STARTS = 0.45;
/** Most places one damaged scaffold smokes from. */
export const MOST_BREAKS = 6;

const pieceNames = ["Post", "Rail", "Brace", "Foot", "Pad", "PadCut", "Curb", "Beacon"] as const;
type PieceName = typeof pieceNames[number];
/** Members a hit can knock loose; posts, feet and the pad always stand. */
const loose: Partial<Record<PieceName, "hangs" | "falls">> = { Rail: "hangs", Brace: "falls" };
/**
 * The pad and its kerbs. Everything else is a wall, feet included, and drops into the pad
 * first: a dark foot left on the pad after its post had gone read as a stray dot.
 */
const onTheGround: ReadonlySet<PieceName> = new Set(["Pad", "PadCut", "Curb"]);

export interface Cage {
  /** World positions of the lamp lenses, one on every corner. */
  lamps: readonly THREE.Vector3[];
  /** World positions where members have been knocked loose, for the health last set. */
  breaks: readonly THREE.Vector3[];
  /**
   * `drop` lowers the scaffold into the ground, from 0 (standing) to 1 (gone, and no longer
   * drawn): the walls go down into the pad, then the pad sinks. `health` (0 to 1) decides
   * which loose members hang or are missing.
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
  /** Places the piece in the site's own frame: its ground centre, not turned. */
  matrix: THREE.Matrix4;
}

/** Loads the kit model: one mesh per piece under a `ScaffoldKit` root that carries `KitSizes`. */
export type ScaffoldKitLoader = () => Promise<THREE.Object3D>;

const kitUrl = new URL("../../assets/models/scaffold-kit.glb", import.meta.url);
export const loadScaffoldKit: ScaffoldKitLoader = async () => (await new GLTFLoader().loadAsync(kitUrl.href)).scene;

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
    const next = shape[(index + 1) % shape.length]!;
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
    const end = corners[(index + 1) % corners.length]!;
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
      .map(([cornerX, cornerZ]) => new THREE.Vector3(cornerX, 0, cornerZ));
    const plate = sides.reduce(trim, whole);
    if (plate.length < 3) continue;
    if (plate === whole) {
      members.push({
        piece: "Pad",
        matrix: new THREE.Matrix4().makeScale((width - JOINT * 2) / kit.bay, 1, (depth - JOINT * 2) / kit.bay)
          .setPosition(x + JOINT, 0, z + JOINT),
      });
      continue;
    }
    // A cut plate is a fan of sheared triangles, drawn in from its edges to leave the joint.
    middle.set(0, 0, 0);
    for (const corner of plate) middle.addScaledVector(corner, 1 / plate.length);
    for (const corner of plate) corner.lerp(middle, JOINT * 2 / Math.min(width, depth));
    const [hub, ...rim] = plate as [THREE.Vector3, ...THREE.Vector3[]];
    for (let index = 1; index < rim.length; index += 1) {
      const from = rim[index - 1]!;
      const to = rim[index]!;
      members.push({
        piece: "PadCut",
        matrix: new THREE.Matrix4().set(
          (from.x - hub.x) / kit.bay, 0, (to.x - hub.x) / kit.bay, hub.x,
          0, 1, 0, 0,
          (from.z - hub.z) / kit.bay, 0, (to.z - hub.z) / kit.bay, hub.z,
          0, 0, 0, 1,
        ),
      });
    }
  }

  sides.forEach(({ start, length, alongX, alongZ, open }, index) => {
    const { x, z } = start;
    const bays = Math.max(1, Math.round(length / kit.bay));
    const bay = length / bays;
    const stretch = bay / kit.bay;
    // A corner post serves both sides that meet at it, so it stands if either is a wall.
    const cornerStands = !open || !sides[(index + sides.length - 1) % sides.length]!.open;
    add("Beacon", x, cornerStands ? (lifts - 1) * lift + kit.post_top * climb : kit.jack_top, z, alongX, alongZ);
    for (let step = 0; step < bays; step += 1) {
      const nodeX = x + alongX * bay * step;
      const nodeZ = z + alongZ * bay * step;
      add("Foot", nodeX, 0, nodeZ, alongX, alongZ);
      add("Curb", nodeX, 0, nodeZ, alongX, alongZ, stretch);
      const braced = Math.min(step, bays - 1 - step) % 2 === 0;
      for (let level = 0; level < lifts; level += 1) {
        if (step ? !open : cornerStands) add("Post", nodeX, level * lift, nodeZ, alongX, alongZ, 1, climb);
        if (open) continue;
        add("Rail", nodeX, (level + 1) * lift, nodeZ, alongX, alongZ, stretch);
        if (!braced) continue;
        // Braces zigzag up the wall; a brace leaning the other way is the same part turned round.
        const leansBack = (level + (step < bays / 2 ? 0 : 1)) % 2 === 1;
        if (leansBack) add("Brace", nodeX + alongX * bay, level * lift, nodeZ + alongZ * bay, -alongX, -alongZ, stretch, climb);
        else add("Brace", nodeX, level * lift, nodeZ, alongX, alongZ, stretch, climb);
      }
    }
  });
  // Deep enough to take the lamps on the post tops under the pad when the walls drop.
  return { members, wallDepth: (lifts - 1) * lift + (kit.post_top + 0.3) * climb };
};

type Piece = Record<"position" | "normal" | "uv", Float32Array> & { index: Uint16Array | Uint32Array };

/**
 * Members of one site welded into a single geometry, in the site's own frame. One geometry
 * is one draw wherever the browser cannot draw a whole batch at once (Firefox has no
 * `WEBGL_multi_draw`), so a site costs two draws there instead of one per member.
 */
class Weld {
  readonly geometry = new THREE.BufferGeometry();
  private readonly position: THREE.BufferAttribute;
  private readonly normal: THREE.BufferAttribute;

  constructor(private readonly members: readonly Member[], private readonly pieces: Record<PieceName, Piece>) {
    let vertices = 0;
    let indices = 0;
    for (const { piece } of members) {
      vertices += pieces[piece].position.length / 3;
      indices += pieces[piece].index.length;
    }
    this.position = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3);
    this.normal = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3);
    const uv = new Float32Array(vertices * 2);
    const index = new Uint32Array(indices);
    let vertex = 0;
    let corner = 0;
    for (const { piece } of members) {
      const source = pieces[piece];
      uv.set(source.uv, vertex * 2);
      for (const value of source.index) index[corner++] = value + vertex;
      vertex += source.position.length / 3;
    }
    this.geometry.setAttribute("position", this.position);
    this.geometry.setAttribute("normal", this.normal);
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
  }

  /** Writes every member where `place` puts it; a member it returns nothing for is left out. */
  write(place: (member: Member, index: number) => THREE.Matrix4 | undefined) {
    const positions = this.position.array;
    const normals = this.normal.array;
    const turn = new THREE.Matrix3();
    const point = new THREE.Vector3();
    let at = 0;
    this.members.forEach((member, index) => {
      const source = this.pieces[member.piece];
      const matrix = place(member, index);
      if (!matrix) {
        // Its triangles collapse to a point, so the geometry keeps its size.
        positions.fill(0, at, at + source.position.length);
        at += source.position.length;
        return;
      }
      turn.getNormalMatrix(matrix);
      for (let offset = 0; offset < source.position.length; offset += 3, at += 3) {
        point.fromArray(source.position, offset).applyMatrix4(matrix).toArray(positions, at);
        point.fromArray(source.normal, offset).applyMatrix3(turn).normalize().toArray(normals, at);
      }
    });
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
    this.geometry.boundingBox = null;
    this.geometry.boundingSphere = null;
  }
}

/**
 * Every site's scaffold, drawn in one call: a single BatchedMesh holds two welded geometries
 * per site, its walls and its pad, each with one transform.
 */
export class Scaffolding {
  private readonly batch: THREE.BatchedMesh;
  private readonly hitTester: THREE.Mesh;
  private vertexRoom = 1 << 16;
  private indexRoom = 1 << 17;

  private constructor(
    parent: THREE.Object3D,
    private readonly pieces: Record<PieceName, Piece>,
    private readonly material: THREE.Material,
    private readonly kit: KitSizes,
  ) {
    this.batch = new THREE.BatchedMesh(32, this.vertexRoom, this.indexRoom, material);
    this.batch.name = "Construction scaffolds";
    // The batch as a whole is never culled: each site's two parts are, on their own.
    this.batch.frustumCulled = false;
    this.batch.sortObjects = false;
    this.batch.receiveShadow = true;
    this.batch.castShadow = true;
    this.hitTester = new THREE.Mesh(undefined, material);
    parent.add(this.batch);
  }

  /** `kit` is the loaded kit model; its geometry is copied, so the model can be let go. */
  static create(parent: THREE.Object3D, kit: THREE.Object3D) {
    let material: THREE.Material | undefined;
    const pieces = Object.fromEntries(pieceNames.map((name) => {
      const mesh = kit.getObjectByName(`Scaffold${name}`);
      if (!(mesh instanceof THREE.Mesh) || Array.isArray(mesh.material)) throw new Error(`Scaffold kit has no ${name}`);
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const index = geometry.getIndex();
      const uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
      const count = geometry.getAttribute("position").count;
      if (!index) throw new Error(`Scaffold kit piece ${name} is not indexed`);
      material = mesh.material;
      const piece: Piece = {
        position: Float32Array.from(geometry.getAttribute("position").array),
        normal: Float32Array.from(geometry.getAttribute("normal").array),
        uv: uv ? Float32Array.from(uv.array) : new Float32Array(count * 2),
        index: index.array as Uint16Array | Uint32Array,
      };
      return [name, piece];
    })) as Record<PieceName, Piece>;
    const root = kit.getObjectByName("ScaffoldKit");
    if (!material || !root) throw new Error("Scaffold kit has no root");
    // Only faces turned away from the sun go into the shadow map, or the pad shades itself in stripes.
    material.shadowSide = THREE.BackSide;
    material.name = "Construction scaffold";
    return new Scaffolding(parent, pieces, material, root.userData as KitSizes);
  }

  /** Adds a welded geometry and its one instance, growing the batch when it is full. */
  private add(geometry: THREE.BufferGeometry) {
    const { batch } = this;
    const vertices = geometry.getAttribute("position").count;
    const indices = geometry.getIndex()!.count;
    const short = () => batch.unusedVertexCount < vertices || batch.unusedIndexCount < indices;
    // Room left by scaffolds that have gone is only reclaimed by repacking.
    if (short()) batch.optimize();
    if (short()) {
      this.vertexRoom = Math.max(this.vertexRoom * 2, this.vertexRoom - batch.unusedVertexCount + vertices);
      this.indexRoom = Math.max(this.indexRoom * 2, this.indexRoom - batch.unusedIndexCount + indices);
      batch.setGeometrySize(this.vertexRoom, this.indexRoom);
    }
    if (batch.instanceCount === batch.maxInstanceCount) batch.setInstanceCount(batch.maxInstanceCount * 2);
    const geometryId = batch.addGeometry(geometry);
    const instanceId = batch.addInstance(geometryId);
    batch.setVisibleAt(instanceId, false);
    return { geometryId, instanceId };
  }

  /**
   * `corners` is the site's ground outline in world space, level, convex and walked with the
   * outside on the right; walls stand `height` tall. `root` owns the scaffold's pick target.
   */
  createCage(root: THREE.Object3D, corners: readonly THREE.Vector3[], height: number): Cage {
    const { batch, hitTester } = this;
    const origin = new THREE.Vector3(root.position.x, corners[0]!.y, root.position.z);
    const { members, wallDepth } = layOut(corners.map((corner) => corner.clone().sub(origin)), height, this.kit);
    const wallMembers = members.filter(({ piece }) => !onTheGround.has(piece));
    const walls = new Weld(wallMembers, this.pieces);
    const pad = new Weld(members.filter(({ piece }) => onTheGround.has(piece)), this.pieces);
    pad.write(({ matrix }) => matrix);
    const wallPart = { weld: walls, depth: wallDepth, placed: new THREE.Matrix4(), shown: false, ...this.add(walls.geometry) };
    const parts = [
      wallPart,
      { weld: pad, depth: PAD_DEPTH, placed: new THREE.Matrix4(), shown: false, ...this.add(pad.geometry) },
    ];
    const lamps = members.filter(({ piece }) => piece === "Beacon")
      .map(({ matrix }) => new THREE.Vector3(0, 0.14, 0).applyMatrix4(matrix).add(origin));
    const breaks: THREE.Vector3[] = [];

    // What the player sees is what a click hits: both parts as they currently stand. The
    // geometry is drawn by the shared batch, so this object only answers click rays.
    const pick = new THREE.Object3D();
    pick.name = "Scaffold pick";
    pick.userData.pickSurface = true;
    pick.raycast = (raycaster, hits) => {
      const first = hits.length;
      for (const part of parts) {
        if (!part.shown) continue;
        hitTester.geometry = part.weld.geometry;
        hitTester.matrixWorld.copy(part.placed);
        hitTester.raycast(raycaster, hits);
      }
      for (let index = first; index < hits.length; index += 1) hits[index]!.object = pick;
    };
    root.add(pick);

    /** The loose members in the order they fail, the same at every site of this shape. */
    const weakest = wallMembers.flatMap(({ piece }, index) => loose[piece] ? [index] : [])
      .sort((first, second) => chance(first) - chance(second));
    const failOrder = new Map(weakest.map((index, order) => [index, order]));
    const hung = new THREE.Matrix4();
    let appliedDrop = -1;
    let appliedDamage = -1;
    return {
      lamps,
      breaks,
      set: (drop, health) => {
        // Twenty damage steps: members fail one at a time without rewelding every frame.
        const damage = Math.round((1 - health) * 20) / 20;
        if (damage !== appliedDamage) {
          appliedDamage = damage;
          const failed: THREE.Matrix4[] = [];
          // At least one member is down whenever the site is damaged at all.
          const down = damage ? Math.max(1, Math.round(damage * BATTERED * weakest.length)) : 0;
          walls.write(({ piece, matrix }, index) => {
            const failure = loose[piece];
            if (!failure || failOrder.get(index)! >= down) return matrix;
            failed.push(matrix);
            return failure === "falls" || chance(index + 0.5) < 0.5 ? undefined : hung.multiplyMatrices(matrix, hang);
          });
          batch.setGeometryAt(wallPart.geometryId, walls.geometry);
          // More places smoke as health falls, spread around the scaffold rather than bunched.
          breaks.length = 0;
          const smoking = Math.min(failed.length, 1 + Math.ceil(damage * (MOST_BREAKS - 1)));
          for (let index = 0; index < smoking; index += 1) {
            const matrix = failed[Math.floor(index * failed.length / smoking)]!;
            breaks.push(new THREE.Vector3(0.5, 0, 0).applyMatrix4(matrix).add(origin));
          }
        }
        if (drop === appliedDrop) return;
        appliedDrop = drop;
        const sunk = [Math.min(1, drop / WALLS_DOWN), Math.max(0, (drop - PAD_STARTS) / (1 - PAD_STARTS))];
        parts.forEach((part, index) => {
          const shown = sunk[index]! < 1;
          if (shown !== part.shown) batch.setVisibleAt(part.instanceId, shown);
          part.shown = shown;
          if (!shown) return;
          part.placed.makeTranslation(origin.x, origin.y - sunk[index]! * part.depth, origin.z);
          batch.setMatrixAt(part.instanceId, part.placed);
        });
      },
      dispose: () => {
        for (const part of parts) {
          batch.deleteGeometry(part.geometryId);
          part.weld.geometry.dispose();
        }
        root.remove(pick);
      },
    };
  }

  /** Whether a site's parts are skipped when off screen; off only to compile shaders at startup. */
  cull(offScreen: boolean) {
    this.batch.perObjectFrustumCulled = offScreen;
  }

  dispose() {
    this.batch.removeFromParent();
    this.batch.dispose();
    this.material.dispose();
    for (const value of Object.values(this.material)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
  }
}
