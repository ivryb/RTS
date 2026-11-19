import * as THREE from "three";
import { ARCING, Bursts, Dice } from "./death/bursts";
import { DebrisPool } from "./death/debris";
import { disposeWreckKit, loadWreckKit, type WreckKit, type WreckKitLoader, type WreckModelName } from "./death/wreckKit";
import { WreckPool, type WreckProfile } from "./death/wrecks";
import { sampleHeight, type GeneratedMap } from "./map";
import type { UnitKind } from "./sim/unitDefinitions";
import type { BuildingKind } from "./sim/units";

export type { WreckKitLoader };

/** A unit at the moment it dies. The caller may reuse one object for every death. */
export interface UnitCasualty {
  kind: UnitKind;
  /** Stands on the ground where the unit died, turned about the vertical only. */
  root: THREE.Object3D;
  /** The one child of `root` that carries everything drawn of the unit. */
  visual: THREE.Object3D;
  /** The loaded model inside `visual`; a wreck is laid in its frame. */
  model: THREE.Object3D;
  /** A unit with a skeleton hands over its mixer and its death clip, already made to play once. */
  mixer?: THREE.AnimationMixer;
  death?: THREE.AnimationAction;
  /** Metres per second over the ground; zero for a unit that died standing. */
  velocityX: number;
  velocityZ: number;
  /** Metres from the ground to the middle and to the top of the hull. */
  centreY: number;
  topY: number;
  /** Any whole number that stays the same for this unit: it picks the variant and the beat times. */
  seed: number;
}

/** A building at the moment it is destroyed. The caller may reuse one object for every one. */
export interface BuildingCasualty {
  kind: BuildingKind;
  /** Stands on the ground, turned about the vertical only. */
  root: THREE.Object3D;
  visual: THREE.Object3D;
  /** Metres from the ground to the top of what stands: the built part of a construction site. */
  height: number;
  /** 1 for a finished building; the construction progress of a site destroyed before completion. */
  built: number;
  /** A part of a finished building that the first blast throws clear: the Turret's head. */
  thrown?: THREE.Object3D;
  seed: number;
}

/**
 * How units die and buildings are destroyed: a short staged sequence sized to what died, which
 * leaves a wreck on a scorch mark. `docs/death_effects.md` describes the look and its cost.
 *
 * The effects take over a casualty's `root` and pose it until its wreck is laid. Then they hide
 * it and report it as released: the model has left the stage and is the caller's again. Until
 * the wreck kit has loaded, or if it failed to load, that happens at once.
 */
export interface DeathEffects {
  /** Loads the wreck kit once. */
  load(): Promise<void>;
  unitDied(casualty: UnitCasualty): void;
  buildingDestroyed(casualty: BuildingCasualty): void;
  update(deltaSeconds: number): void;
  /**
   * Shows one of everything far below the terrain, so that a render compiles every shader a
   * death needs before the first one. Call after `load`, render, then call the returned function.
   */
  prepareRendering(): () => void;
  dispose(): void;
}

const COLD: readonly [number, number, number] = [1, 1, 1];

type LeftoverName = Exclude<WreckModelName, "scrap-plate" | "scrap-beam">;

const WRECKS: Record<LeftoverName, WreckProfile> = {
  "scout-drone-wreck": {
    capacity: 24, castShadow: false,
    flameSeconds: 2.5, smokeSeconds: 12, restSeconds: 24, sinkSeconds: 3,
    smokeRate: 2.4, smokeSize: 0.95, smokeRise: 1.3, smokeLife: 1.5, flameSize: 0.3,
    emitters: [0, 0.35, 0], heat: [2.2, 1.35, 0.9], coolSeconds: 2.5,
  },
  "hornet-wreck": {
    capacity: 12, castShadow: true,
    flameSeconds: 7, smokeSeconds: 18, restSeconds: 30, sinkSeconds: 4,
    smokeRate: 2.2, smokeSize: 1.9, smokeRise: 1.8, smokeLife: 2.2, flameSize: 0.55,
    emitters: [0, 0.7, 0, 0.3, 0.6, -0.9], heat: [2.2, 1.35, 0.9], coolSeconds: 4,
  },
  "behemoth-wreck": {
    capacity: 10, castShadow: true,
    flameSeconds: 12, smokeSeconds: 28, restSeconds: 40, sinkSeconds: 5,
    smokeRate: 2, smokeSize: 2.7, smokeRise: 2.3, smokeLife: 3, flameSize: 0.8,
    // The source model's own frame: about 0.68 units tall, scaled 3.5 times in the game.
    emitters: [0, 0.16, 0, 0.1, 0.12, -0.18, -0.1, 0.12, 0.2], heat: [2.6, 1.45, 0.9], coolSeconds: 6,
  },
  "ghostrunner-wreck": {
    capacity: 24, castShadow: false,
    flameSeconds: 0, smokeSeconds: 7, restSeconds: 24, sinkSeconds: 3.5,
    smokeRate: 1.6, smokeSize: 0.8, smokeRise: 0.9, smokeLife: 1.6, flameSize: 0,
    // The husk appears as dark as the charred body it replaces, then settles to its own colours.
    emitters: [], heat: [0.45, 0.4, 0.38], coolSeconds: 2.5,
  },
  "command-center-ruin": {
    capacity: 4, castShadow: true,
    flameSeconds: 24, smokeSeconds: 58, restSeconds: 90, sinkSeconds: 10,
    smokeRate: 2, smokeSize: 6.5, smokeRise: 2.9, smokeLife: 5, flameSize: 1.5,
    // On top of the burnt-out machines the generator stands under each point.
    emitters: [0.4, 1.47, -0.6, -2.2, 1.18, 1.6, 2.3, 1.15, 1.9, -1.4, 1.62, -2.6], heat: [1.7, 1.25, 1], coolSeconds: 8,
  },
  "turret-ruin": {
    capacity: 8, castShadow: true,
    flameSeconds: 10, smokeSeconds: 30, restSeconds: 55, sinkSeconds: 6,
    smokeRate: 3, smokeSize: 2.3, smokeRise: 2.1, smokeLife: 3.2, flameSize: 0.6,
    emitters: [0, 0.5, 0], heat: [1.8, 1.3, 1], coolSeconds: 5,
  },
  "site-rubble": {
    capacity: 4, castShadow: true,
    flameSeconds: 0, smokeSeconds: 0, restSeconds: 60, sinkSeconds: 8,
    smokeRate: 0, smokeSize: 0, smokeRise: 0, smokeLife: 0, flameSize: 0,
    emitters: [], heat: COLD, coolSeconds: 0,
  },
  "site-rubble-small": {
    capacity: 8, castShadow: true,
    flameSeconds: 0, smokeSeconds: 0, restSeconds: 45, sinkSeconds: 6,
    smokeRate: 0, smokeSize: 0, smokeRise: 0, smokeLife: 0, flameSize: 0,
    emitters: [], heat: COLD, coolSeconds: 0,
  },
};
const LEFTOVER_NAMES = Object.keys(WRECKS) as LeftoverName[];

/** How a hovering unit comes down. The tilt is the one its wreck model was crushed at. */
const FALLS = {
  "scout-drone": { seconds: 0.5, drag: 2.6, pitch: 0.42, roll: 0.28, blast: 1.25, scrap: 3 },
  hornet: { seconds: 0.68, drag: 3.1, pitch: 0.26, roll: -0.33, blast: 2.3, scrap: 6 },
} as const;

interface Demolition {
  /** Half the width of the ground the building stands on, in metres. */
  footprint: number;
  ruin: LeftoverName;
  /** What a site of this kind leaves when it is destroyed before completion. */
  rubble: LeftoverName;
  /** Blasts of the opening cascade, the seconds they are spread over, and the beat before the fall. */
  blasts: number;
  cascade: readonly [number, number];
  beat: readonly [number, number];
  /** Seconds the structure takes to go down, and how far it leans by the end, in radians. */
  sinkSeconds: number;
  lean: number;
  scrapSize: number;
  scrapCount: number;
  dustCount: number;
  dustLinger: number;
  scorchMarks: number;
  scorchSeconds: number;
}

const DEMOLITIONS: Record<BuildingKind, Demolition> = {
  "command-center": {
    footprint: 4.8, ruin: "command-center-ruin", rubble: "site-rubble",
    blasts: 8, cascade: [1.05, 1.3], beat: [0.2, 0.4], sinkSeconds: 1.9, lean: 0.07,
    scrapSize: 0.5, scrapCount: 16, dustCount: 15, dustLinger: 1.9, scorchMarks: 4, scorchSeconds: 150,
  },
  turret: {
    footprint: 1.5, ruin: "turret-ruin", rubble: "site-rubble-small",
    blasts: 3, cascade: [0.5, 0.5], beat: [0.1, 0.1], sinkSeconds: 1.05, lean: 0.16,
    scrapSize: 0.25, scrapCount: 6, dustCount: 8, dustLinger: 1.3, scorchMarks: 2, scorchSeconds: 90,
  },
};

/** A wreck that lands moving keeps this share of its speed and slides for this long. */
const SKID_SPEED = 0.75;
const SKID_SECONDS = 0.42;

// The Ghostrunner's death clip staggers for 1.6 s, falls, and lies still from 2 s on. Starting a
// second in keeps one beat of stagger as the hit reaction and puts the body on the sand 0.8 s
// after the kill.
const DEAD_TIME_SCALE = 1.25;
const DEAD_START_SECONDS = 1;
const DEAD_LANDS_SECONDS = 2;
/** A body on the sand darkens in this many steps until it matches the husk that replaces it. */
const CHAR_STEPS = 8;
const CHARRED = new THREE.Color(0.1, 0.085, 0.075);

// Blasts sit on the half of a building that faces the camera, or on its roof; fire inside the
// hull would be hidden by it.
const CAMERA_BEARING = Math.PI / 4;

/** A thrown part's upward speed and half its gravity, in its model's own units. */
const HEAD_KICK = 5.2;
const HEAD_GRAVITY = 7.4;
/** The share of a building's fall after which its ruin starts to rise. */
const RUIN_RISES_AT = 0.4;

const Mode = { Free: 0, Fall: 1, CookOff: 2, Clip: 3, Collapse: 4 } as const;
type Mode = (typeof Mode)[keyof typeof Mode];
const MAX_POPS = 6;
/** Casualties that can be mid-death at once; one more cuts the longest-running death short. */
const MOST_DYING = 48;

/** One casualty whose own model is still being posed before its wreck takes over. */
interface Dying {
  mode: Mode;
  age: number;
  duration: number;
  seed: number;
  root: THREE.Object3D | null;
  visual: THREE.Object3D | null;
  model: THREE.Object3D | null;
  /** A part thrown clear before the rest falls (the Turret's head), where it sat, and how fast it tumbles. */
  part: THREE.Object3D | null;
  partX: number;
  partHeight: number;
  partZ: number;
  partSpin: number;
  partLands: number;
  mixer: THREE.AnimationMixer | null;
  wreck: WreckPool | null;
  x: number; y: number; z: number;
  vx: number; vz: number; drag: number;
  yaw: number; spin: number; pitch: number; roll: number;
  /** A fall: upward kick, gravity, and the height of the hull's middle at the start and at rest. */
  kick: number; gravity: number; startHeight: number; restHeight: number;
  /** A collapse: when the structure starts to go down, how far, its lean about x and z at the end, and the heap's height. */
  fallsAt: number; depth: number; leanX: number; leanZ: number; heapShare: number;
  /** Half the width of the ground a collapsing building stands on. */
  footprint: number;
  pops: Float32Array;
  popCount: number;
  laid: boolean;
  /** A body that chars: its mesh, the mesh's own material, when the charring starts, and the step shown. */
  charred: THREE.Mesh | null;
  charSource: THREE.MeshStandardMaterial | null;
  charFrom: number;
  charStep: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const FAR_BELOW = -10_000;
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const turn = new THREE.Quaternion();
const unit = new THREE.Vector3(1, 1, 1);
const forward = new THREE.Vector3();
const side = new THREE.Vector3();
const lift = new THREE.Vector3();

/** Metres travelled after `time` by something launched at 1 m/s that loses `drag` of its speed per second. */
const coast = (time: number, drag: number) => (1 - Math.exp(-drag * time)) / drag;

/** The effects with the wreck kit loaded: every pool exists. */
const stageDeaths = (
  parent: THREE.Object3D,
  map: GeneratedMap,
  kit: WreckKit,
  released: (root: THREE.Object3D) => void,
) => {
  const groundHeight = (x: number, z: number) => sampleHeight(map, x, z);
  const dice = new Dice();
  const random = () => dice.random();
  const between = (low: number, high: number) => dice.between(low, high);
  const bursts = new Bursts(parent, map, groundHeight, dice);
  const wrecks = Object.fromEntries(LEFTOVER_NAMES.map((name) =>
    [name, new WreckPool(name, kit[name], WRECKS[name], bursts, groundHeight)])) as Record<LeftoverName, WreckPool>;
  const pools = LEFTOVER_NAMES.map((name) => wrecks[name]);
  /** Charred scrap thrown by blasts, and the paler beams of something still being built. */
  const scrap = new DebrisPool({
    name: "Death scrap", capacity: 192, ...kit["scrap-plate"], castShadow: false,
    groundHeight, restSeconds: 16, sinkSeconds: 3,
  });
  const beams = new DebrisPool({
    name: "Site debris", capacity: 64, ...kit["scrap-beam"], castShadow: true,
    groundHeight, restSeconds: 20, sinkSeconds: 4,
  });
  parent.add(scrap.mesh, beams.mesh, ...pools.map((pool) => pool.mesh));
  const charRamps = new Map<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial[]>();

  const dying: Dying[] = Array.from({ length: MOST_DYING }, () => ({
    mode: Mode.Free, age: 0, duration: 0, seed: 0,
    root: null, visual: null, model: null, part: null, partX: 0, partHeight: 0, partZ: 0, partSpin: 0, partLands: 0,
    mixer: null, wreck: null, footprint: 0,
    x: 0, y: 0, z: 0, vx: 0, vz: 0, drag: 1, yaw: 0, spin: 0, pitch: 0, roll: 0,
    kick: 0, gravity: 0, startHeight: 0, restHeight: 0, fallsAt: 0, depth: 0, leanX: 0, leanZ: 0, heapShare: 1,
    pops: new Float32Array(MAX_POPS), popCount: 0, laid: false,
    charred: null, charSource: null, charFrom: 0, charStep: 0,
  }));

  const claim = (mode: Mode, root: THREE.Object3D, visual: THREE.Object3D, wreck: WreckPool, seed: number) => {
    let entry = dying[0]!;
    for (let index = 0; index < dying.length; index += 1) {
      const candidate = dying[index]!;
      if (candidate.mode === Mode.Free) {
        entry = candidate;
        break;
      }
      if (candidate.age > entry.age) entry = candidate;
    }
    if (entry.mode !== Mode.Free) finish(entry);
    entry.mode = mode; entry.age = 0; entry.seed = seed;
    entry.root = root; entry.visual = visual; entry.wreck = wreck;
    entry.model = null; entry.part = null; entry.mixer = null;
    entry.x = root.position.x; entry.y = root.position.y; entry.z = root.position.z;
    entry.vx = 0; entry.vz = 0; entry.drag = 1;
    entry.yaw = root.rotation.y; entry.spin = 0; entry.pitch = 0; entry.roll = 0;
    entry.popCount = 0; entry.laid = false; entry.heapShare = 1;
    entry.charred = null; entry.charStep = 0;
    root.rotation.order = "YXZ";
    return entry;
  };

  const throwScrap = (
    pool: DebrisPool, x: number, y: number, z: number,
    reach: number, height: number, size: number, count: number, delay: number,
  ) => {
    const next = pool.next;
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const speed = reach * between(0.35, 1);
      next.x = x; next.y = y; next.z = z;
      next.vx = Math.cos(angle) * speed; next.vy = height * between(0.5, 1); next.vz = Math.sin(angle) * speed;
      next.spinX = between(-9, 9); next.spinY = between(-6, 6); next.spinZ = between(-9, 9);
      next.scale = size * between(0.6, 1.3);
      pool.emit(delay);
    }
  };

  /** The ground blast every machine ends on: flash, fireball, sand ring, sparks, scrap and a scorch. */
  const groundBlast = (x: number, z: number, size: number, scrapCount: number, delay: number, scorchSeconds: number) => {
    const ground = groundHeight(x, z);
    bursts.flash(x, ground + size * 0.5, z, size * 1.7, delay);
    bursts.fireball(x, ground + size * 0.5, z, size, delay);
    bursts.dust(x, z, size * 0.9, size > 2 ? 9 : 6, delay + 0.03);
    bursts.sparks(x, ground + size * 0.4, z, 3 + size * 2.2, size > 2 ? 12 : 7, delay);
    throwScrap(scrap, x, ground + size * 0.3, z, 2 + size * 1.6, 3 + size * 2, 0.18 + size * 0.08, scrapCount, delay);
    bursts.mark(x, z, size * 2.3, 0.62, scorchSeconds, delay);
  };

  // -------------------------------------------------------------------------------------------
  // Scout Drone and Hornet: lose lift, fall along the momentum, burst on the ground, skid.

  const crash = (casualty: UnitCasualty, fall: (typeof FALLS)[keyof typeof FALLS], wreck: WreckPool) => {
    const { root, visual } = casualty;
    const entry = claim(Mode.Fall, root, visual, wreck, casualty.seed);
    const centre = casualty.centreY;
    // Pivot about the hull's middle, so it tumbles in the air instead of swinging around the ground.
    root.position.y += centre;
    visual.position.y -= centre;
    const moving = casualty.velocityX !== 0 || casualty.velocityZ !== 0;
    const drift = random() * Math.PI * 2;
    const seconds = fall.seconds * between(0.84, 1.16);
    const rest = wreck.height * 0.42;
    entry.duration = seconds;
    entry.drag = fall.drag;
    entry.vx = moving ? casualty.velocityX : Math.cos(drift) * between(0.5, 1.2);
    entry.vz = moving ? casualty.velocityZ : Math.sin(drift) * between(0.5, 1.2);
    entry.spin = (random() < 0.5 ? -1 : 1) * (moving ? between(1.5, 3.2) : between(5, 9));
    entry.pitch = fall.pitch;
    entry.roll = fall.roll;
    entry.kick = between(0.8, 1.8);
    // Gravity is whatever lands the hull exactly when the fall's time is up.
    entry.gravity = 2 * (centre - rest + entry.kick * seconds) / (seconds * seconds);
    entry.startHeight = centre;
    entry.restHeight = rest;

    const size = fall.blast;
    bursts.flash(entry.x, entry.y + centre, entry.z, size * 1.2);
    bursts.sparks(entry.x, entry.y + centre, entry.z, 4, 7);
    const steps = 9;
    for (let step = 1; step <= steps; step += 1) {
      const time = seconds * step / (steps + 1);
      const travel = coast(time, fall.drag);
      const height = centre + entry.kick * time - 0.5 * entry.gravity * time * time;
      const x = entry.x + entry.vx * travel;
      const z = entry.z + entry.vz * travel;
      bursts.smokePuff(x, groundHeight(x, z) + height, z, size * 0.9, 0.5, between(0.7, 1.1), 1, time);
      if (step % 2 === 1) bursts.flame(x, groundHeight(x, z) + height, z, size * 0.32, time);
    }
    const travel = coast(seconds, fall.drag);
    const impactX = entry.x + entry.vx * travel;
    const impactZ = entry.z + entry.vz * travel;
    groundBlast(impactX, impactZ, size, fall.scrap, seconds, 45);
    if (!moving) return;
    const slowed = Math.exp(-fall.drag * seconds) * SKID_SPEED * SKID_SECONDS / 2;
    for (let step = 1; step <= 3; step += 1) {
      bursts.dust(
        impactX + entry.vx * slowed * step / 3, impactZ + entry.vz * slowed * step / 3,
        size * 0.45, 3, seconds + step * 0.07,
      );
    }
  };

  const poseFall = (entry: Dying) => {
    const root = entry.root!;
    const time = Math.min(entry.age, entry.duration);
    const travel = coast(time, entry.drag);
    const x = entry.x + entry.vx * travel;
    const z = entry.z + entry.vz * travel;
    const share = time / entry.duration;
    const tipped = share * share;
    const height = Math.max(
      entry.restHeight, entry.startHeight + entry.kick * time - 0.5 * entry.gravity * time * time,
    );
    root.position.set(x, groundHeight(x, z) + height, z);
    root.rotation.set(
      entry.pitch * tipped,
      entry.yaw + entry.spin * time,
      entry.roll * tipped + Math.sin(time * 19) * 0.12 * (1 - share),
    );
    if (entry.age < entry.duration) return;
    const slowed = Math.exp(-entry.drag * entry.duration) * SKID_SPEED;
    const yaw = entry.yaw + entry.spin * entry.duration;
    position.set(x, groundHeight(x, z), z);
    matrix.compose(position, quaternion.setFromAxisAngle(UP, yaw), unit);
    const skids = Math.hypot(entry.vx, entry.vz) * slowed > 0.6;
    entry.wreck!.spawn(
      matrix, entry.seed, entry.vx * slowed, entry.vz * slowed,
      skids ? SKID_SECONDS : 0, yaw, skids ? entry.spin * 0.5 : 0,
    );
    release(entry);
  };

  // -------------------------------------------------------------------------------------------
  // Behemoth: lurches to a stop burning, the rocket pods cook off, then the hull blows and burns out.

  /** A rocket that fires itself out of a burning pod and corkscrews away to burst in the air. */
  const strayRocket = (x: number, y: number, z: number, delay: number) => {
    const heading = random() * Math.PI * 2;
    forward.set(Math.cos(heading) * 0.75, 1, Math.sin(heading) * 0.75).normalize();
    side.crossVectors(forward, UP).normalize();
    lift.crossVectors(side, forward);
    const seconds = between(0.5, 0.75);
    const turns = between(11, 16) * (random() < 0.5 ? -1 : 1);
    const steps = 20;
    let tipX = x;
    let tipY = y;
    let tipZ = z;
    for (let step = 0; step <= steps; step += 1) {
      const time = seconds * step / steps;
      const along = 20 * coast(time, 1.4);
      const radius = 0.12 + time * 0.75;
      const swing = Math.cos(turns * time) * radius;
      const sway = Math.sin(turns * time) * radius;
      tipX = x + forward.x * along + side.x * swing + lift.x * sway;
      tipY = y + forward.y * along + side.y * swing + lift.y * sway - 2.2 * time * time;
      tipZ = z + forward.z * along + side.z * swing + lift.z * sway;
      bursts.flash(tipX, tipY, tipZ, 0.5, delay + time, 0.16);
      bursts.smokePuff(tipX, tipY, tipZ, 0.85, 0.2, between(0.5, 0.8), 0.35, delay + time);
    }
    // It ends in a flash and sparks only: a fireball's smoke would hang where nothing is.
    bursts.flash(tipX, tipY, tipZ, 1.8, delay + seconds);
    bursts.sparks(tipX, tipY, tipZ, 6, 8, delay + seconds);
  };

  const cookOff = (casualty: UnitCasualty) => {
    const { root, visual, topY } = casualty;
    const entry = claim(Mode.CookOff, root, visual, wrecks["behemoth-wreck"], casualty.seed);
    entry.model = casualty.model;
    const moving = casualty.velocityX !== 0 || casualty.velocityZ !== 0;
    // Half the hulls go up quickly, half burn through a longer string of pops.
    const slow = random() < 0.5;
    entry.duration = slow ? between(1.45, 1.85) : between(0.95, 1.2);
    entry.vx = casualty.velocityX * 0.9;
    entry.vz = casualty.velocityZ * 0.9;
    entry.drag = 3.2;
    entry.pitch = moving ? 0.09 : -0.045;
    entry.popCount = slow ? 5 : 3;
    const x = entry.x;
    const z = entry.z;
    const top = entry.y + topY * 0.82;
    bursts.flash(x, top, z, 2.2);
    bursts.fireball(x, top, z, 0.9, 0, 0.5);
    bursts.sparks(x, top, z, 7, 10);
    const slide = coast(entry.duration, entry.drag);
    const endX = x + entry.vx * slide;
    const endZ = z + entry.vz * slide;
    if (moving) bursts.dust(x + entry.vx * 0.12, z + entry.vz * 0.12, 1.5, 6, 0.05);
    // The pods burn from the first frame, so a dead hull never passes for a living one while it cooks.
    for (let time = 0.06; time < entry.duration; time += 0.08) {
      const done = coast(time, entry.drag);
      const fireX = x + entry.vx * done + between(-0.6, 0.6);
      const fireZ = z + entry.vz * done + between(-0.6, 0.6);
      bursts.flame(fireX, top, fireZ, between(0.45, 0.75), time);
      bursts.smokePuff(fireX, top + 0.4, fireZ, between(1.1, 1.7), 2.2, between(0.8, 1.2), 1, time + 0.03);
    }
    let rockets = slow ? 2 : 1;
    for (let pop = 0; pop < entry.popCount; pop += 1) {
      // Each pop lands anywhere in its own slice of the burn, so no two hulls keep the same beat.
      const time = 0.16 + (entry.duration - 0.36) * (pop + between(0.15, 0.85)) / entry.popCount;
      entry.pops[pop] = time;
      const done = coast(time, entry.drag);
      const popX = x + entry.vx * done + between(-0.7, 0.7);
      const popZ = z + entry.vz * done + between(-0.7, 0.7);
      const popY = entry.y + topY * between(0.7, 0.95);
      bursts.flash(popX, popY, popZ, 1.5, time);
      bursts.fireball(popX, popY, popZ, between(0.7, 1.1), time, 0.7);
      bursts.sparks(popX, popY, popZ, 6, 6, time);
      throwScrap(scrap, popX, popY, popZ, 4, 6, 0.2, 1, time);
      if (rockets > 0 && pop % 2 === 0) {
        rockets -= 1;
        strayRocket(popX, popY, popZ, time + 0.03);
      }
    }
    groundBlast(endX, endZ, 3.3, 9, entry.duration, 50);
    bursts.fireball(endX, entry.y + topY * 0.9, endZ, 2.4, entry.duration + 0.04);
    bursts.flash(endX, entry.y + topY * 0.6, endZ, 7.5, entry.duration, 0.22);
  };

  const poseCookOff = (entry: Dying) => {
    const root = entry.root!;
    const time = Math.min(entry.age, entry.duration);
    const travel = coast(time, entry.drag);
    const x = entry.x + entry.vx * travel;
    const z = entry.z + entry.vz * travel;
    let nod = entry.pitch * Math.sin(time * 11) * Math.exp(-time * 3.5);
    let rock = 0;
    for (let pop = 0; pop < entry.popCount; pop += 1) {
      const since = time - entry.pops[pop]!;
      if (since < 0) continue;
      const jolt = Math.sin(since * 30) * Math.exp(-since * 9) * 0.035;
      if (pop % 2 === 0) nod -= jolt; else rock += jolt;
    }
    root.position.set(x, groundHeight(x, z), z);
    root.rotation.set(nod, entry.yaw, rock);
    if (entry.age < entry.duration) return;
    root.rotation.set(0, entry.yaw, 0);
    layWreckOver(entry);
    release(entry);
  };

  /** Swaps the casualty's model for its wreck in exactly the same place. */
  const layWreckOver = (entry: Dying) => {
    const model = entry.model!;
    model.updateWorldMatrix(true, false);
    entry.wreck!.spawn(model.matrixWorld, entry.seed);
  };

  // -------------------------------------------------------------------------------------------
  // Ghostrunner: sparks, the death clip carried forward by its momentum, then a husk.

  /** The darker copies of a material that a charring body steps through; made once per material. */
  const charRamp = (source: THREE.MeshStandardMaterial) => {
    let ramp = charRamps.get(source);
    if (!ramp) {
      ramp = Array.from({ length: CHAR_STEPS }, (_, step) => {
        const copy = source.clone();
        const shade = new THREE.Color(1, 1, 1).lerp(CHARRED, (step + 1) / CHAR_STEPS);
        copy.color.multiply(shade);
        // The Ghostrunner's armor is lit mostly by its emissive map.
        copy.emissive.multiply(shade);
        return copy;
      });
      charRamps.set(source, ramp);
    }
    return ramp;
  };

  const drop = (casualty: UnitCasualty) => {
    const { root, visual, mixer, death, topY } = casualty;
    const entry = claim(Mode.Clip, root, visual, wrecks["ghostrunner-wreck"], casualty.seed);
    entry.model = casualty.model;
    entry.mixer = mixer ?? null;
    entry.duration = 0.2;
    let lands = 0;
    if (death) {
      death.timeScale = DEAD_TIME_SCALE;
      death.reset().fadeIn(0.12).play();
      death.time = DEAD_START_SECONDS;
      entry.duration = (death.getClip().duration - DEAD_START_SECONDS) / DEAD_TIME_SCALE + 0.35;
      lands = (DEAD_LANDS_SECONDS - DEAD_START_SECONDS) / DEAD_TIME_SCALE;
    }
    entry.charFrom = lands;
    const body = visual.getObjectByProperty("isMesh", true) as THREE.Mesh | undefined;
    if (body?.material instanceof THREE.MeshStandardMaterial) {
      entry.charred = body;
      entry.charSource = body.material;
    }
    entry.vx = casualty.velocityX * 0.55;
    entry.vz = casualty.velocityZ * 0.55;
    entry.drag = 4.5;
    const chest = entry.y + topY * 0.6;
    bursts.flash(entry.x, chest, entry.z, 0.9, 0, 0.16, ARCING);
    bursts.sparks(entry.x, chest, entry.z, 5, 14, 0, 0.2, ARCING);
    bursts.smokePuff(entry.x, chest, entry.z, 0.9, 0.8, 0.9, 1, 0.05);
    // Where the body comes to rest: the clip throws it clear of where it stood, and its husk
    // is modelled lying there.
    const slide = coast(entry.duration, entry.drag);
    casualty.model.updateWorldMatrix(true, false);
    position.copy(entry.wreck!.centre).applyMatrix4(casualty.model.matrixWorld);
    const restX = position.x + entry.vx * slide;
    const restZ = position.z + entry.vz * slide;
    const low = groundHeight(restX, restZ) + 0.4;
    bursts.dust(restX, restZ, 0.7, 4, lands, false, 0.3);
    bursts.sparks(restX, low, restZ, 3, 5, lands + 0.1, 0.16, ARCING);
    // The body smoulders while it darkens.
    for (let time = lands + 0.1; time < entry.duration; time += 0.16) {
      bursts.smokePuff(restX, low, restZ, 0.9, 0.8, 1.1, 1, time);
    }
    // Its power cell gives out as the husk takes the body's place, behind a last burst of smoke.
    const gone = entry.duration - 0.08;
    bursts.flash(restX, low, restZ, 0.7, gone, 0.16, ARCING);
    bursts.sparks(restX, low, restZ, 4, 8, gone, 0.18, ARCING);
    // The puffs lie along the whole body, blade included.
    for (let puff = 0; puff < 7; puff += 1) {
      bursts.smokePuff(restX + between(-1.1, 1.1), low, restZ + between(-1.1, 1.1), 1.7, 0.7, 0.9, 1, gone - 0.04 + puff * 0.02);
    }
    bursts.mark(restX, restZ, 2.6, 0.55, 40, lands + 0.2);
  };

  const poseClip = (entry: Dying, deltaSeconds: number) => {
    const root = entry.root!;
    entry.mixer?.update(deltaSeconds);
    const travel = coast(entry.age, entry.drag);
    const x = entry.x + entry.vx * travel;
    const z = entry.z + entry.vz * travel;
    root.position.set(x, groundHeight(x, z), z);
    const share = THREE.MathUtils.clamp((entry.age - entry.charFrom) / (entry.duration - entry.charFrom), 0, 1);
    // Most of the darkening comes early, so the body reads as dead while it still lies pale.
    const step = Math.ceil(Math.sqrt(share) * CHAR_STEPS);
    if (step !== entry.charStep && entry.charred && entry.charSource) {
      entry.charStep = step;
      entry.charred.material = charRamp(entry.charSource)[step - 1]!;
    }
    if (entry.age < entry.duration) return;
    layWreckOver(entry);
    release(entry);
  };

  // -------------------------------------------------------------------------------------------
  // Buildings: a cascade of blasts, a beat, then the structure sinks into its own dust.

  const demolish = (casualty: BuildingCasualty) => {
    const { root, visual, height, built } = casualty;
    const plan = DEMOLITIONS[casualty.kind];
    const unfinished = built < 1;
    const { footprint } = plan;
    const entry = claim(Mode.Collapse, root, visual, wrecks[unfinished ? plan.rubble : plan.ruin], casualty.seed);
    // Nothing in a half-built shell burns, so a site comes down sooner, drier and smaller.
    const cascade = unfinished ? 0.15 : between(plan.cascade[0], plan.cascade[1]);
    const sink = unfinished ? 1 : plan.sinkSeconds;
    // The fall starts a beat after the last blast of the cascade.
    entry.fallsAt = cascade + (unfinished ? 0.05 : between(plan.beat[0], plan.beat[1]));
    entry.footprint = plan.footprint;
    entry.depth = height + 0.6;
    entry.duration = entry.fallsAt + sink;
    entry.heapShare = unfinished ? 0.35 + 0.65 * built : 1;
    const lean = random() * Math.PI * 2;
    // A site sinks straight down: its cut stays level.
    const leanAngle = unfinished ? 0 : plan.lean;
    entry.leanX = Math.cos(lean) * leanAngle;
    entry.leanZ = Math.sin(lean) * leanAngle;
    const { x, y, z } = entry;
    if (casualty.thrown && !unfinished) {
      // The first blast is under the gun: it throws the gun off its bearing, and the gun comes
      // down across the base, where the ruin has it lying.
      const part = casualty.thrown;
      entry.part = part;
      entry.partX = part.position.x; entry.partHeight = part.position.y; entry.partZ = part.position.z;
      entry.partSpin = between(5, 8) * (random() < 0.5 ? -1 : 1);
      entry.vx = Math.cos(lean) * between(0.7, 1.1);
      entry.vz = Math.sin(lean) * between(0.7, 1.1);
      // It lands when it is back down to 0.55 of the height it sat at.
      entry.partLands = (HEAD_KICK + Math.sqrt(HEAD_KICK ** 2 + 4 * HEAD_GRAVITY * 0.45 * entry.partHeight)) / (2 * HEAD_GRAVITY);
      bursts.flash(x, y + height * 0.8, z, footprint * 1.6);
      bursts.fireball(x, y + height * 0.8, z, footprint * 0.7);
      bursts.sparks(x, y + height * 0.8, z, 7, 10);
    }

    const blasts = unfinished ? 4 : plan.blasts;
    for (let blast = 0; blast < blasts; blast += 1) {
      const time = cascade * (blast + between(0, 0.7)) / blasts;
      const onRoof = random() < 0.35;
      const bearing = CAMERA_BEARING + between(-1.5, 1.5);
      const reach = footprint * (onRoof ? between(0, 0.45) : 0.95);
      const blastX = x + Math.sin(bearing) * reach;
      const blastZ = z + Math.cos(bearing) * reach;
      const blastY = y + height * (onRoof ? 1 : between(0.3, 0.75));
      const size = footprint * between(0.45, 0.7);
      if (unfinished) {
        // Struts snap, sand and loose beams come down.
        bursts.dust(blastX, blastZ, size * 0.8, 4, time, true);
        bursts.sparks(blastX, blastY, blastZ, 4, 4, time);
        throwScrap(beams, blastX, blastY + 0.5, blastZ, 2.5, 3, footprint * 0.19, 3, time);
      } else {
        bursts.flash(blastX, blastY, blastZ, size * 1.8, time);
        bursts.fireball(blastX, blastY, blastZ, size, time);
        bursts.sparks(blastX, blastY, blastZ, 7, 8, time);
        throwScrap(scrap, blastX, blastY, blastZ, footprint * 0.6, 5, plan.scrapSize, 2, time);
      }
    }

    const falls = entry.fallsAt;
    if (unfinished) {
      throwScrap(beams, x, y + height * 0.7 + 0.5, z, footprint * 0.6, 4, footprint * 0.21, plan.scrapCount, falls);
    } else {
      bursts.flash(x, y + height * 0.6, z, footprint * 1.9, falls, 0.25);
      bursts.fireball(x, y + height * 0.8, z, footprint * 0.95, falls);
      bursts.fireball(x + footprint * 0.5, y + height * 0.5, z + footprint * 0.5, footprint * 0.6, falls + 0.08);
      throwScrap(scrap, x, y + height * 0.8, z, footprint * 0.7, 8, plan.scrapSize * 1.2, plan.scrapCount, falls);
    }
    // The dust curtain rolls out from the walls in waves while the structure goes down.
    const waves = unfinished ? 2 : 3;
    for (let wave = 0; wave < waves; wave += 1) {
      const share = wave / waves;
      bursts.dust(
        x, z, footprint * (unfinished ? 0.85 : 1.3 - share * 0.25), unfinished ? Math.round(plan.dustCount * 0.6) : plan.dustCount,
        falls + 0.1 + share * sink * 0.8, unfinished, unfinished ? 0.42 : 0.55, unfinished ? 1.2 : plan.dustLinger,
      );
    }
    bursts.dust(x, z, footprint * 0.5, 6, falls + sink * 0.75, unfinished, 0.4, 1.6);
    if (unfinished) {
      bursts.mark(x, z, footprint * 2.6, 0.3, 70, falls + sink * 0.5, true);
      return;
    }
    for (let mark = 0; mark < plan.scorchMarks; mark += 1) {
      const bearing = mark / plan.scorchMarks * Math.PI * 2 + random();
      bursts.mark(
        x + Math.cos(bearing) * footprint * 0.9, z + Math.sin(bearing) * footprint * 0.9,
        footprint * between(1.9, 2.6), 0.4, plan.scorchSeconds, falls + 0.3 + mark * 0.1,
      );
    }
    bursts.mark(x, z, footprint * 3, 0.5, plan.scorchSeconds, falls + 0.2);
  };

  const poseCollapse = (entry: Dying) => {
    const root = entry.root!;
    const time = entry.age;
    const part = entry.part;
    if (part) {
      const flight = Math.min(time, entry.partLands);
      part.position.set(
        entry.partX + entry.vx * flight,
        entry.partHeight + HEAD_KICK * flight - HEAD_GRAVITY * flight * flight,
        entry.partZ + entry.vz * flight,
      );
      part.rotation.z = entry.partSpin * flight * 0.55;
      part.rotation.x = entry.partSpin * flight * 0.3;
    }
    const share = Math.max(0, (time - entry.fallsAt) / (entry.duration - entry.fallsAt));
    const fallen = share * share * (1.4 - 0.4 * share);
    const shake = (1 - share) * (0.02 + 0.03 * Math.min(1, time / entry.fallsAt));
    root.position.set(
      entry.x + Math.sin(time * 61) * shake,
      entry.y - entry.depth * fallen,
      entry.z + Math.cos(time * 53) * shake,
    );
    root.rotation.set(entry.leanX * fallen, entry.yaw, entry.leanZ * fallen);
    // The ruin starts to rise once the walls are well down and the dust is up; sooner, it showed
    // through a building that still stood.
    if (!entry.laid && share >= RUIN_RISES_AT) {
      entry.laid = true;
      // The ruin lies along the slope under the footprint, so its apron does not jut out of a hillside.
      const reach = entry.footprint;
      forward.set(
        groundHeight(entry.x - reach, entry.z) - groundHeight(entry.x + reach, entry.z),
        2 * reach,
        groundHeight(entry.x, entry.z - reach) - groundHeight(entry.x, entry.z + reach),
      ).normalize();
      quaternion.setFromUnitVectors(UP, forward).multiply(turn.setFromAxisAngle(UP, entry.yaw));
      position.set(entry.x, entry.y, entry.z);
      matrix.compose(position, quaternion, unit);
      entry.wreck!.spawn(matrix, entry.seed, 0, 0, 0, 0, 0, (entry.duration - time) * 0.95, entry.heapShare);
    }
    if (share >= 1) release(entry);
  };

  // -------------------------------------------------------------------------------------------

  const release = (entry: Dying) => {
    const root = entry.root!;
    entry.mode = Mode.Free;
    entry.root = null; entry.visual = null; entry.model = null; entry.part = null;
    entry.mixer = null; entry.wreck = null; entry.charred = null; entry.charSource = null;
    root.visible = false;
    released(root);
  };

  const pose = (entry: Dying, deltaSeconds: number) => {
    switch (entry.mode) {
      case Mode.Free: return;
      case Mode.Fall: return poseFall(entry);
      case Mode.CookOff: return poseCookOff(entry);
      case Mode.Clip: return poseClip(entry, deltaSeconds);
      case Mode.Collapse: return poseCollapse(entry);
    }
  };

  /** Ends a death at once, leaving its wreck. */
  const finish = (entry: Dying) => {
    entry.age = entry.duration;
    pose(entry, 0);
  };

  /** Listed per kind, so a new unit kind does not compile until it has a death of its own. */
  const unitDeaths: Record<UnitKind, (casualty: UnitCasualty) => void> = {
    "scout-drone": (casualty) => crash(casualty, FALLS["scout-drone"], wrecks["scout-drone-wreck"]),
    hornet: (casualty) => crash(casualty, FALLS.hornet, wrecks["hornet-wreck"]),
    behemoth: cookOff,
    ghostrunner: drop,
  };

  const clear = () => {
    for (const entry of dying) {
      if (entry.mode !== Mode.Free) release(entry);
    }
    for (const pool of pools) pool.clear();
    scrap.clear();
    beams.clear();
    bursts.clear();
  };

  return {
    unitDied(casualty: UnitCasualty) {
      dice.reseed(casualty.seed);
      unitDeaths[casualty.kind](casualty);
    },
    buildingDestroyed(casualty: BuildingCasualty) {
      dice.reseed(casualty.seed);
      demolish(casualty);
    },
    update(deltaSeconds: number) {
      for (let index = 0; index < dying.length; index += 1) {
        const entry = dying[index]!;
        if (entry.mode === Mode.Free) continue;
        entry.age += deltaSeconds;
        pose(entry, deltaSeconds);
      }
      for (let index = 0; index < pools.length; index += 1) pools[index]!.update(deltaSeconds);
      scrap.update(deltaSeconds);
      beams.update(deltaSeconds);
      bursts.update(deltaSeconds);
    },
    prepareRendering() {
      dice.reseed(1);
      matrix.makeTranslation(0, FAR_BELOW, 0);
      for (const pool of pools) pool.spawn(matrix, 1);
      bursts.flash(0, FAR_BELOW, 0, 1);
      bursts.fireball(0, FAR_BELOW, 0, 1);
      // One mark in each of the two pools; at no opacity they compile their shader and show nothing.
      bursts.mark(0, 0, 2, 0, 0.01);
      bursts.mark(0, 0, 10, 0, 0.01);
      throwScrap(scrap, 0, FAR_BELOW, 0, 1, 1, 0.2, 1, 0);
      throwScrap(beams, 0, FAR_BELOW, 0, 1, 1, 0.2, 1, 0);
      return clear;
    },
    dispose() {
      clear();
      for (const pool of pools) pool.dispose();
      scrap.dispose();
      beams.dispose();
      bursts.dispose();
      disposeWreckKit(kit);
      for (const ramp of charRamps.values()) {
        for (const material of ramp) material.dispose();
      }
    },
  };
};

/**
 * `parent` is the world group the shared meshes are drawn under. `released` is called with a
 * casualty's root once the effects have hidden it and no longer touch it.
 */
export const createDeathEffects = (
  parent: THREE.Object3D,
  map: GeneratedMap,
  released: (root: THREE.Object3D) => void,
  loadKit: WreckKitLoader = loadWreckKit,
): DeathEffects => {
  let stage: ReturnType<typeof stageDeaths> | undefined;
  let loading: Promise<void> | undefined;
  let disposed = false;
  /** Without the wreck kit a casualty vanishes as it dies, so play goes on. */
  const vanish = (root: THREE.Object3D) => {
    root.visible = false;
    released(root);
  };
  return {
    load() {
      loading ??= loadKit()
        .then((kit) => {
          if (disposed) disposeWreckKit(kit);
          else stage = stageDeaths(parent, map, kit, released);
        })
        .catch((error: unknown) => console.error("Wreck kit failed to load", error));
      return loading;
    },
    unitDied(casualty) {
      if (stage) stage.unitDied(casualty);
      else vanish(casualty.root);
    },
    buildingDestroyed(casualty) {
      if (stage) stage.buildingDestroyed(casualty);
      else vanish(casualty.root);
    },
    update: (deltaSeconds) => stage?.update(deltaSeconds),
    prepareRendering: () => stage?.prepareRendering() ?? (() => {}),
    dispose() {
      disposed = true;
      stage?.dispose();
      stage = undefined;
    },
  };
};
