import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { placeGroundGeometry, prepareGroundOverlay } from "./groundOverlay";
import { sampleHeight } from "./map";
import type { TerrainSurface } from "./terrainWalkability";
import type { TitaniumDepositState } from "./sim/harvesting";
import { POSITION_SCALE } from "./sim/simulationConstants";
import { MINING_TRAIL_SECONDS, type MiningLasers } from "./miningLaser";
import { UI_SELECTION_COLOR } from "./uiColors";

const WORKFACE_SAMPLES = 32;
/** Neighbouring samples further apart than this lie on different rocks, not one face. */
const WORKFACE_MAX_STEP = 0.4;
/**
 * A drone may drift this far before its workface is traced again. It has to exceed the hover bob
 * (0.07 either way) plus the drift of the nose as the drone settles its facing, or every hovering
 * drone would trace again on each bob.
 */
const WORKFACE_REUSE_DISTANCE = 0.2;
/** The face reaches no further from the drone than this past the closest rock, which keeps the beam short. */
const WORKFACE_DEPTH = 0.9;
/** The face starts this far above the ground, clear of the sand the rock stands in. */
const WORKFACE_GROUND_CLEARANCE = 0.12;
/**
 * Where a beam aims, in footprint radii to the side of the deposit's centre. The centre comes
 * first; the others are tried when it shows a gap between rocks or only a sliver of face. They stay
 * close to the centre because the drone faces the centre, and a beam should leave its nose
 * nearly straight.
 */
const WORKFACE_AIMS = [0, 0.2, -0.2];
/** A face this tall is worth sweeping, so no other aim is tried. */
const WORKFACE_TALL_ENOUGH = 0.5;
/**
 * How steeply a beam may leave the nose, as rise over run. A beam aimed sharply down at the foot of
 * a near rock points along the camera's line of sight and shrinks to a dot on the drone.
 */
const WORKFACE_LOWEST_PITCH = -0.4;
const WORKFACE_HIGHEST_PITCH = 1.2;
/** A drone standing above a low rock may aim this far below the crest, however steep that is. */
const WORKFACE_LEAST_PITCH_RANGE = 0.35;
/** The sweep stops this fraction short of the rock's crest, so the glow stays on the face. */
const WORKFACE_CREST_INSET = 0.06;

const modelUrls = [
  new URL("../assets/models/titanium-three-knuckles.glb", import.meta.url),
  new URL("../assets/models/titanium-split-lens.glb", import.meta.url),
  new URL("../assets/models/titanium-eroded-window.glb", import.meta.url),
];

export type OreModelLoader = () => Promise<readonly THREE.Group[]>;

/** The strip of rock face that a beam from one spot can sweep, as points from bottom to top. */
export class Workface {
  count = 0;
  depositId = "";
  readonly origin = new THREE.Vector3();
  readonly points = new Float32Array(WORKFACE_SAMPLES * 3);

  /** Sets `point` to the place `sweep` of the way up the face: 0 is the bottom, 1 the top. */
  at(sweep: number, point: THREE.Vector3) {
    const points = this.points;
    const position = sweep * (this.count - 1);
    const lower = Math.max(0, Math.min(Math.floor(position), this.count - 2)) * 3;
    const upper = Math.min(lower + 3, (this.count - 1) * 3);
    const blend = position - lower / 3;
    return point.set(
      points[lower]! + (points[upper]! - points[lower]!) * blend,
      points[lower + 1]! + (points[upper + 1]! - points[lower + 1]!) * blend,
      points[lower + 2]! + (points[upper + 2]! - points[lower + 2]!) * blend,
    );
  }
}

const loadOreModels: OreModelLoader = async () => {
  const loader = new GLTFLoader();
  return Promise.all(modelUrls.map(async url => (await loader.loadAsync(url.href)).scene));
};

interface OreDeposit {
  root: THREE.Group;
  visual: THREE.Object3D;
  ring: THREE.Mesh;
  meshes: THREE.Mesh[];
  /** Footprint radius in world units; the model is scaled to fit inside it. */
  radius: number;
}

/** Owns ore models and selection overlays; amounts always come from the simulation. */
export class OrePresentation {
  readonly selectables: THREE.Object3D[] = [];
  readonly ready: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly models: THREE.Group[] = [];
  private readonly deposits = new Map<string, OreDeposit>();
  // Scratch for tracing workfaces, reused from one trace to the next.
  private readonly candidate = new Workface();
  private readonly hits = new Float32Array(WORKFACE_SAMPLES);
  private readonly slice = new THREE.Plane();
  private readonly localSlice = new THREE.Plane();
  private readonly sliceNormal = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private readonly crossingPoint = new THREE.Vector3();
  private readonly crossingEnd = new THREE.Vector3();
  private sides = new Float32Array(0);
  private segments = new Float32Array(1024);
  private disposed = false;

  constructor(world: THREE.Group, private readonly map: TerrainSurface, deposits: readonly TitaniumDepositState[],
    loadModels: OreModelLoader = loadOreModels) {
    this.root.name = "Titanium deposits";
    world.add(this.root);
    this.ready = deposits.length ? this.load(map, deposits, loadModels) : Promise.resolve();
  }

  private async load(map: TerrainSurface, deposits: readonly TitaniumDepositState[], loadModels: OreModelLoader) {
    const sources = await loadModels();
    this.models.push(...sources);
    if (this.disposed) {
      this.disposeModels();
      return;
    }
    const normalizations = sources.map(source => {
      source.updateMatrixWorld(true);
      const point = new THREE.Vector3();
      let radius = 0;
      source.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
        const positions = object.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
          radius = Math.max(radius, Math.hypot(point.x, point.z));
        }
      });
      return radius;
    });
    deposits.forEach((deposit, index) => {
      const variant = index % sources.length;
      const visual = sources[variant]!.clone(true);
      const radius = deposit.radius / POSITION_SCALE;
      const scale = radius / normalizations[variant]!;
      visual.scale.setScalar(scale);
      visual.position.y = -0.05;
      const root = new THREE.Group();
      root.name = "Titanium deposit";
      root.userData.resourceId = deposit.id;
      const x = deposit.position.x / POSITION_SCALE;
      const z = deposit.position.z / POSITION_SCALE;
      const y = sampleHeight(map, x, z);
      root.position.set(x, y, z);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius + 0.15, radius + 0.24, 64).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: UI_SELECTION_COLOR, depthWrite: false, transparent: true, opacity: 0.85 }),
      );
      ring.userData.selectionOverlay = true;
      ring.visible = false;
      prepareGroundOverlay(ring);
      root.add(visual, ring);
      this.root.add(root);
      root.updateMatrixWorld(true);
      placeGroundGeometry(ring.geometry, 0);
      const meshes: THREE.Mesh[] = [];
      visual.traverse(object => {
        if (object instanceof THREE.Mesh) meshes.push(object);
      });
      this.deposits.set(deposit.id, { root, visual, ring, meshes, radius });
      this.selectables.push(root);
    });
  }

  update(deposits: readonly TitaniumDepositState[], selected: ReadonlySet<string>) {
    for (const deposit of deposits) {
      const presentation = this.deposits.get(deposit.id);
      if (!presentation) continue;
      presentation.ring.visible = selected.has(deposit.id);
    }
  }

  /**
   * Keeps `face` on the rock that a beam from `origin` reaches at this deposit, and says whether
   * there is any. It reads the model's real surface, whatever its shape, and only again once the
   * face belongs to another deposit or the origin has moved.
   */
  traceWorkface(id: string, origin: THREE.Vector3, face: Workface) {
    if (face.depositId === id && face.origin.distanceToSquared(origin) < WORKFACE_REUSE_DISTANCE ** 2) {
      return face.count > 0;
    }
    const deposit = this.deposits.get(id);
    face.count = 0;
    // An unloaded model leaves the face unclaimed, so the next frame asks again.
    face.depositId = deposit ? id : "";
    if (!deposit) return false;
    face.origin.copy(origin);
    deposit.root.updateWorldMatrix(true, true);
    const center = deposit.root.position;
    const acrossX = center.z - origin.z;
    const acrossZ = origin.x - center.x;
    const side = deposit.radius / (Math.hypot(acrossX, acrossZ) || 1);
    let tallest = -1;
    for (const aim of WORKFACE_AIMS) {
      const height = this.traceSlice(
        deposit, origin, center.x + acrossX * side * aim, center.z + acrossZ * side * aim, this.candidate);
      if (height > tallest) {
        tallest = height;
        face.points.set(this.candidate.points);
        face.count = this.candidate.count;
      }
      if (tallest >= WORKFACE_TALL_ENOUGH) break;
    }
    return face.count > 0;
  }

  // Every ray of a sweep lies in the vertical plane through the origin and the aim, so the rock is
  // cut by that plane once and the rays are then cast against the outline, in 2D. That costs a
  // fraction of one ray cast against every triangle of the model. Returns the height the face
  // spans, or -1 when the plane shows no rock.
  private traceSlice(deposit: OreDeposit, origin: THREE.Vector3, aimX: number, aimZ: number, face: Workface) {
    const reach = Math.hypot(aimX - origin.x, aimZ - origin.z);
    const forwardX = (aimX - origin.x) / reach;
    const forwardZ = (aimZ - origin.z) / reach;
    this.slice.setFromNormalAndCoplanarPoint(this.sliceNormal.set(-forwardZ, 0, forwardX), origin);
    let segmentCount = 0;
    for (const mesh of deposit.meshes) segmentCount = this.cutMesh(mesh, origin, forwardX, forwardZ, segmentCount);

    // Rays fan between the lowest and highest rock the plane shows above the ground.
    const far = reach + deposit.radius;
    const ground = deposit.root.position.y + WORKFACE_GROUND_CLEARANCE - origin.y;
    const segments = this.segments;
    let lowest = Infinity;
    let highest = -Infinity;
    for (let offset = 0; offset < segmentCount * 4; offset += 4) {
      let startX = segments[offset]!;
      let startY = segments[offset + 1]!;
      let endX = segments[offset + 2]!;
      let endY = segments[offset + 3]!;
      if (startY < ground && endY < ground) continue;
      // A segment that dips into the ground counts down to the ground line, however coarse the model.
      if (startY < ground) {
        startX += (endX - startX) * (ground - startY) / (endY - startY);
        startY = ground;
      } else if (endY < ground) {
        endX += (startX - endX) * (ground - endY) / (startY - endY);
        endY = ground;
      }
      if (startX > 0.05 && startX < far) {
        lowest = Math.min(lowest, startY / startX);
        highest = Math.max(highest, startY / startX);
      }
      if (endX > 0.05 && endX < far) {
        lowest = Math.min(lowest, endY / endX);
        highest = Math.max(highest, endY / endX);
      }
    }
    highest = Math.min(highest, WORKFACE_HIGHEST_PITCH);
    lowest = Math.max(lowest, Math.min(WORKFACE_LOWEST_PITCH, highest - WORKFACE_LEAST_PITCH_RANGE));
    highest -= (highest - lowest) * WORKFACE_CREST_INSET;
    const hits = this.hits;
    let closest = far;
    for (let sample = 0; sample < WORKFACE_SAMPLES; sample += 1) {
      hits[sample] = far;
      if (lowest > highest) continue;
      const pitch = lowest + (highest - lowest) * (sample + 0.5) / WORKFACE_SAMPLES;
      const directionX = 1 / Math.hypot(1, pitch);
      const directionY = pitch * directionX;
      let nearest = far;
      for (let offset = 0; offset < segmentCount * 4; offset += 4) {
        const startX = segments[offset]!;
        const startY = segments[offset + 1]!;
        const edgeX = segments[offset + 2]! - startX;
        const edgeY = segments[offset + 3]! - startY;
        const denominator = directionX * edgeY - directionY * edgeX;
        if (denominator === 0) continue;
        const along = (startX * edgeY - startY * edgeX) / denominator;
        if (along <= 0 || along >= nearest) continue;
        const across = (startX * directionY - startY * directionX) / denominator;
        if (across >= 0 && across <= 1) nearest = along;
      }
      const x = origin.x + forwardX * directionX * nearest;
      const y = origin.y + directionY * nearest;
      const z = origin.z + forwardZ * directionX * nearest;
      // Deposits stand on uneven ground: on the uphill side the rock's foot is under the sand.
      if (nearest >= far || y < sampleHeight(this.map, x, z) + WORKFACE_GROUND_CLEARANCE) continue;
      hits[sample] = nearest;
      closest = Math.min(closest, nearest);
      face.points[sample * 3] = x;
      face.points[sample * 3 + 1] = y;
      face.points[sample * 3 + 2] = z;
    }
    // The face is the longest unbroken run of hits on the rock nearest the drone. Rock much
    // further off than the closest hit is another boulder seen past it, and a beam reaching
    // over there grows long.
    let bestStart = 0;
    let bestLength = 0;
    let runLength = 0;
    for (let sample = 0; sample < WORKFACE_SAMPLES; sample += 1) {
      const near = hits[sample]! <= closest + WORKFACE_DEPTH && closest < far;
      const joined = near && runLength > 0 && Math.abs(hits[sample]! - hits[sample - 1]!) <= WORKFACE_MAX_STEP;
      runLength = near ? (joined ? runLength + 1 : 1) : 0;
      if (runLength > bestLength) {
        bestStart = sample - runLength + 1;
        bestLength = runLength;
      }
    }
    face.points.copyWithin(0, bestStart * 3, (bestStart + bestLength) * 3);
    face.count = bestLength;
    return bestLength ? face.points[bestLength * 3 - 2]! - face.points[1]! : -1;
  }

  /** Appends the segments where `mesh` crosses the slice plane, as (distance along the aim, height above the origin) pairs. */
  private cutMesh(mesh: THREE.Mesh, origin: THREE.Vector3, forwardX: number, forwardZ: number, segmentCount: number) {
    const positions = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.getIndex();
    const local = this.localSlice.copy(this.slice).applyMatrix4(this.inverse.copy(mesh.matrixWorld).invert());
    if (this.sides.length < positions.count) this.sides = new Float32Array(positions.count);
    const sides = this.sides;
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      sides[vertex] = local.normal.x * positions.getX(vertex) + local.normal.y * positions.getY(vertex)
        + local.normal.z * positions.getZ(vertex) + local.constant;
    }
    const write = (from: number, to: number, offset: number) => {
      const point = this.crossingPoint.fromBufferAttribute(positions, from)
        .lerp(this.crossingEnd.fromBufferAttribute(positions, to), sides[from]! / (sides[from]! - sides[to]!))
        .applyMatrix4(mesh.matrixWorld);
      this.segments[offset] = (point.x - origin.x) * forwardX + (point.z - origin.z) * forwardZ;
      this.segments[offset + 1] = point.y - origin.y;
    };
    const corners = index ? index.count : positions.count;
    for (let corner = 0; corner < corners; corner += 3) {
      const a = index ? index.getX(corner) : corner;
      const b = index ? index.getX(corner + 1) : corner + 1;
      const c = index ? index.getX(corner + 2) : corner + 2;
      const aSide = sides[a]! > 0;
      const bSide = sides[b]! > 0;
      const cSide = sides[c]! > 0;
      if (aSide === bSide && bSide === cSide) continue;
      if ((segmentCount + 1) * 4 > this.segments.length) {
        const grown = new Float32Array(this.segments.length * 2);
        grown.set(this.segments);
        this.segments = grown;
      }
      // One vertex stands alone on its side of the plane; the two edges from it cross.
      const lone = aSide === bSide ? c : aSide === cSide ? b : a;
      write(lone, lone === a ? b : a, segmentCount * 4);
      write(lone, lone === c ? b : c, segmentCount * 4 + 2);
      segmentCount += 1;
    }
    return segmentCount;
  }

  has(id: string) {
    return this.deposits.has(id);
  }

  dispose() {
    this.disposed = true;
    this.root.removeFromParent();
    for (const { ring } of this.deposits.values()) {
      ring.geometry.dispose();
      if (ring.material instanceof THREE.Material) ring.material.dispose();
    }
    this.disposeModels();
    this.deposits.clear();
    this.selectables.length = 0;
  }

  private disposeModels() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    for (const source of this.models) source.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    this.models.length = 0;
  }
}

const SWEEP_SECONDS = 1.9;

/** A stable random number from 0 to 1 per unit. */
const unitSeed = (id: string) => {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  // Ids that differ only in their last digit hash next to each other until the bits are mixed.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
};

/** A Scout's two work phases made visible: a cutting laser while it extracts, a cargo bin while it hauls. */
export class ScoutHarvestPresentation {
  readonly cargo = new THREE.Group();
  /** Whether the laser was drawn in the latest update. */
  firing = false;
  /** Where the beam leaves the drone and where it meets the rock; current while `firing`. */
  readonly emitter = new THREE.Vector3();
  readonly contact = new THREE.Vector3();
  private readonly face = new Workface();
  private readonly trail = new THREE.Vector3();
  private readonly seed: number;
  private readonly sweepSeconds: number;
  private readonly wander: number;

  /** `nozzle` sits on the drone's model where the beam leaves it. */
  constructor(
    root: THREE.Group,
    private readonly nozzle: THREE.Object3D,
    private readonly ore: OrePresentation,
    private readonly lasers: MiningLasers,
    unitId: string,
  ) {
    const ivory = new THREE.MeshStandardMaterial({ color: 0xc9baa0, roughness: 0.72, metalness: 0.08 });
    const graphite = new THREE.MeshStandardMaterial({ color: 0x323a3c, roughness: 0.7, metalness: 0.2 });
    const bin = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.24, 0.36, 2, 0.045), ivory);
    const contents = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.13, 0.27, 2, 0.025), graphite);
    contents.position.y = 0.15;
    this.cargo.add(bin, contents);
    this.cargo.position.set(0, 0.75, -0.57);
    this.cargo.visible = false;
    this.cargo.name = "Titanium cargo";
    root.add(this.cargo);
    // Drones on one deposit must not sweep in step, so each gets its own phase, tempo and wander.
    // The three come from different bits of the seed: two drones whose phases happen to match
    // still drift apart.
    this.seed = unitSeed(unitId);
    this.sweepSeconds = SWEEP_SECONDS * (0.7 + 0.6 * ((this.seed * 7919.13) % 1));
    this.wander = 0.37 + 0.3 * ((this.seed * 131.7) % 1);
  }

  /**
   * Shows `amount` of carried ore, and fires the laser at `depositId` for this frame when one is
   * given. Call it after the drone's model has been posed for the frame.
   */
  update(amount: number, depositId: string | undefined) {
    this.cargo.visible = amount > 0;
    this.firing = false;
    if (depositId === undefined) return;
    // Read from the model, not worked out from the drone's position: the nozzle bobs and sways
    // with the hovering body, and a beam that starts beside it looks detached.
    this.nozzle.getWorldPosition(this.emitter);
    if (!this.ore.traceWorkface(depositId, this.emitter, this.face)) return;
    this.lasers.fire(
      this.emitter,
      this.face.at(this.sweep(this.lasers.time), this.contact),
      this.face.at(this.sweep(this.lasers.time - MINING_TRAIL_SECONDS), this.trail),
      this.seed,
    );
    this.firing = true;
  }

  /**
   * How far up the face the contact is at `time`, from 0 (bottom) to 1 (top). It swings up and
   * down, and a slower second swing moves where each stroke turns, so a drone does not repeat
   * itself and no two drones move alike for long.
   */
  private sweep(time: number) {
    const turn = (time / this.sweepSeconds + this.seed) * Math.PI * 2;
    return 0.5 - 0.36 * Math.cos(turn) - 0.14 * Math.cos(turn * this.wander + this.seed * 40);
  }

  /** For a Scout that is no longer drawn, and so no longer updated. */
  hide() {
    this.firing = false;
  }

  dispose() {
    this.cargo.removeFromParent();
    const materials = new Set<THREE.Material>();
    this.cargo.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const material of materials) material.dispose();
  }
}
