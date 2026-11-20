import * as THREE from "three";
import { Decks } from "./construction/deck";
import { Glow, GlowEffects } from "./construction/glowEffects";
import { DIRECTIONS, measureOutline, SLICES, type Outline } from "./construction/outline";
import { createReveal, type Reveal } from "./construction/reveal";
import { loadScaffoldKit, MOST_BREAKS, Scaffolding, type Cage, type ScaffoldKitLoader } from "./construction/scaffold";
import { BUILDING_DEFINITIONS } from "./sim/construction";
import type { BuildingKind } from "./sim/units";

export type { ScaffoldKitLoader };

/** Seconds the scaffold takes to drop into its pad once the building is complete. */
const RETRACT_SECONDS = 0.5;
/** Seconds it takes to drop when the site is destroyed before completion. */
const COLLAPSE_SECONDS = 0.24;
const DUST_SECONDS = 0.62;
/** Seconds after completion by which the scaffold and the last of its dust are gone. */
const COMPLETION_SECONDS = 1;
const SPARKS_PER_ARC = 7;
/** Puffs of smoke in the air at once above each place a damaged scaffold has broken. */
const SMOKE_WISPS = 3;
/** Metres of air between the hull and the scaffold around it. */
const CLEARANCE = 0.15;
/** A side of the scaffold shorter than this is left out, and its two corners share a post. */
const SHORTEST_SIDE = 0.5;
/** Seconds of work in which the first layer spreads from the drone's beam out to the hull. */
const FIRST_LAYER_SECONDS = 0.9;
/** Metres above the ground below which the deck never lies, to stay clear of the pad's plates. */
const DECK_FLOOR = 0.07;
/** A reach that cuts nothing off: the first layer has spread out to the hull. */
const WHOLE_HULL = 1e6;
/** Seconds the welding arcs take to strike once a drone starts work, and to die once it stops. */
const ARC_SECONDS = 0.2;
/** Seconds the steel takes to glow behind the arcs. */
const HEAT_SECONDS = 0.4;
/** Seconds it takes to cool once the drone stops: hot steel goes dark more slowly than it lights. */
const COOL_SECONDS = 0.8;
/**
 * A Scout Drone's laser works the edge of the deck on the drone's own side: its line sweeps a
 * band this many metres deep, in from the rim. Ivan asked for this after seeing the lines reach
 * across the whole deck: "they should work on the outside edge of building".
 */
const EDGE_DEPTH = 1.5;
/** The band starts at this share of the way from the middle to the rim, where a round deck is still wide enough to hold a line. */
const BAND_START = 0.88;
/** Metres the line reaches to each side for every metre it lies from the drone: the fan opens about 75 degrees at the nozzle. */
const FAN_SPREAD = 0.75;
/** Metres the line reaches to each side, at most. */
const WIDEST_SCAN = 1.5;
/** Seconds the line takes to cross the band once. */
const PASS_SECONDS = 1;
/** Metres along the ground the line keeps from the drone: nearer, and the fan of light closes to a sliver. */
const NEAREST_SCAN = 1.2;
/**
 * Metres from the building's axis that the scan covers at least, and the same as a share of the
 * drone's distance from that axis, which keeps the fan about 25 degrees wide as the drone sees
 * it. Where the deck is smaller, as on a Command Center's upper tiers and dish, the line reaches
 * past it, or the fan would close to a single beam that hardly moves.
 */
const SMALLEST_SCAN = 0.9;
const NARROWEST_FAN = 0.22;
/** How round the sweep turns at the end of a pass: at 1 it would reverse on the spot. */
const SCAN_TURN = 0.985;
/** The scan stays inside this share of the way from the middle to the rim. */
const SCAN_REACH = 0.94;
/** Radians the line rocks to each side as it sweeps, so the deck is scanned from a different angle on every pass. */
const SCAN_ROCK = 0.45;
/** Passes one rock to and fro takes. Not a whole number, so the scan never repeats. */
const SCAN_ROCK_PASSES = 3.3;

/** Everything the presentation knows about one site on one frame. */
export interface SiteState {
  /** Construction progress from the simulation, 0 to 1. */
  progress: number;
  /** True while a Scout Drone is beaming the site. */
  working: boolean;
  /** Health as a fraction of what the part built so far should have, 0 to 1. */
  health: number;
  lifecycle: "constructing" | "active" | "destroyed";
  /** Seconds since the lifecycle became `active` or `destroyed`; 0 while constructing. */
  sinceLifecycleChange: number;
}

export interface ConstructionSite {
  /**
   * Sets `start` and `end` to the ends of the line that the scanning laser of a Scout Drone
   * standing at `from` draws on the site at `time`: a line across the deck that closes the cut,
   * sweeping to and fro over it. `seed`, from 0 to 1, keeps drones on one site from scanning in
   * step. All in world space.
   */
  scanLine(from: THREE.Vector3, time: number, seed: number, start: THREE.Vector3, end: THREE.Vector3): void;
  /**
   * Sets `out` to the point on the building's outside edge that a Scout Drone standing at `from`
   * works on. Where the deck that closes the cut comes within `reach` metres of the drone along
   * the ground, that is the deck's rim on the drone's side. Where the building has grown narrower
   * than that, it is the top edge of the highest tier below that the drone does reach. `along`
   * moves the point that many metres to the drone's left along the edge. All in world space.
   */
  workPoint(from: THREE.Vector3, reach: number, along: number, out: THREE.Vector3): THREE.Vector3;
  /**
   * Sets every visual from `state` and `time`. Only the weld is carried over from the last
   * call: its arcs and glow come up and die down over the time that passed since then, so
   * call this with a later `time` each frame. The first call shows the weld settled, and an
   * earlier `time` counts as no time passed. Returns false once the building is complete
   * and nothing of its construction is left to show, so the site can be disposed.
   */
  update(state: SiteState, time: number): boolean;
  /**
   * Lowers the cut and its deck by `metres`, for the next `update`. The death effects sink what a
   * destroyed site leaves standing into the ground; this keeps the cut level with the building.
   */
  sinkStump(metres: number): void;
  dispose(): void;
}

const point = new THREE.Vector3();
const neighbour = new THREE.Vector3();
const outward = new THREE.Vector3();
const velocity = new THREE.Vector3();
const { clamp, smoothstep } = THREE.MathUtils;
/** A stable 0 to 1 number for a seed. */
const chance = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * The ground outline of a site's scaffold, in world space: the eight-sided shape that hugs the
 * main hull, four sides square to the map and four diagonal, walked with the outside on the
 * right. It is square to the map rather than to the building, so every site stands the same
 * way to the fixed camera, however its building is turned.
 */
const hugHull = (root: THREE.Object3D, outline: Outline, ground: number) => {
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const sides = Array.from({ length: 8 }, (_, side) => {
    const x = Math.cos(-side * Math.PI / 4);
    const z = Math.sin(-side * Math.PI / 4);
    outward.set(x, 0, z).transformDirection(toRoot);
    return { x, z, reach: outline.reach(outward.x, outward.z) + CLEARANCE };
  });
  // Each corner is where a side's line meets the next side's.
  const corners = sides.map((side, index) => {
    const next = sides[(index + 1) % sides.length]!;
    const turn = side.x * next.z - side.z * next.x;
    return new THREE.Vector3(
      root.position.x + (side.reach * next.z - next.reach * side.z) / turn,
      ground,
      root.position.z + (next.reach * side.x - side.reach * next.x) / turn,
    );
  });
  return corners.filter((corner, index) => corner.distanceTo(corners[(index + 1) % corners.length]!) >= SHORTEST_SIDE);
};

/**
 * How buildings look while Scout Drones construct them: a scaffold stands around the site, the
 * real building rises inside it behind a capped cut, and the scaffold drops at completion.
 * `docs/construction_animation.md` describes the look. Nothing is authored per building: the
 * scaffold, the cut and the deck that closes it are all fitted to the loaded model.
 *
 * Every site shares four draw calls: the scaffolds, their shadow, the decks and the glows.
 */
export class ConstructionSites {
  /** Arcs, sparks, dust and smoke. Other world effects may add their own lists to it. */
  readonly effects: GlowEffects;
  private readonly decks: Decks;
  private readonly hulls = new Map<BuildingKind, { outline: Outline; table: number }>();
  /** Cut materials kept from startup, so the shader programs they compiled stay in the renderer. */
  private readonly preparedReveals: Reveal[] = [];
  private scaffolding?: Scaffolding;
  private loading?: Promise<void>;
  private disposed = false;

  /** `parent` is the world group the shared meshes are drawn under. */
  constructor(private readonly parent: THREE.Object3D, private readonly loadKit: ScaffoldKitLoader = loadScaffoldKit) {
    this.effects = new GlowEffects(parent);
    this.decks = new Decks(parent, Object.keys(BUILDING_DEFINITIONS).length);
  }

  /** Loads the scaffold kit once. A site created before it arrives gets its scaffold then. */
  load() {
    this.loading ??= this.loadKit()
      .then((kit) => {
        if (!this.disposed) this.scaffolding = Scaffolding.create(this.parent, kit);
      })
      // A site still shows its building rising without the kit, so play goes on.
      .catch((error: unknown) => console.error("Scaffold kit failed to load", error));
    return this.loading;
  }

  /**
   * Measures a building kind's hull from its loaded model, once. Call it when a model loads,
   * so the first site of that kind does not pay for it. `root` is the building's root and
   * `visualRoot` holds its model. A model with no meshes has no hull.
   */
  measure(kind: BuildingKind, root: THREE.Object3D, visualRoot: THREE.Object3D) {
    this.hull(kind, root, visualRoot);
  }

  private hull(kind: BuildingKind, root: THREE.Object3D, visualRoot: THREE.Object3D) {
    const known = this.hulls.get(kind);
    if (known) return known;
    root.updateWorldMatrix(true, true);
    const outline = measureOutline(root, visualRoot);
    if (!outline) return;
    const hull = { outline, table: this.decks.addHull(outline.decks) };
    this.hulls.set(kind, hull);
    return hull;
  }

  /**
   * `root` is placed on the terrain and turned only about its vertical axis. A model with no
   * meshes has nothing to build, so it gets no site.
   */
  createSite(kind: BuildingKind, root: THREE.Object3D, visualRoot: THREE.Object3D) {
    return this.stand(kind, root, visualRoot, (reveal) => reveal.dispose());
  }

  /** `releaseReveal` decides what becomes of the site's cut materials when the site is disposed. */
  private stand(
    kind: BuildingKind,
    root: THREE.Object3D,
    visualRoot: THREE.Object3D,
    releaseReveal: (reveal: Reveal) => void,
  ): ConstructionSite | undefined {
    const hull = this.hull(kind, root, visualRoot);
    if (!hull) return;
    const { outline, table } = hull;
    root.updateWorldMatrix(true, true);
    const { height } = outline;
    const ground = root.position.y + outline.floor;
    const corners = hugHull(root, outline, ground);
    const reveal = createReveal(root, visualRoot);
    const deck = this.decks.createDeck(root, table);
    let cage: Cage | undefined;
    let disposed = false;
    // The scaffold stops at the main roofline; a dish or a mast stands proud of it.
    const scaffold = () => {
      if (!disposed) cage = this.scaffolding?.createCage(root, corners, height * outline.roofline);
    };
    if (this.scaffolding) scaffold();
    else void this.load().then(scaffold);

    const perimeter = corners.reduce((total, corner, index) => total + corner.distanceTo(corners[(index + 1) % corners.length]!), 0);
    const center = corners.reduce((sum, corner) => sum.add(corner), new THREE.Vector3()).divideScalar(corners.length);
    const arcs = clamp(Math.round(perimeter / 9), 2, 5);
    const puffs = clamp(Math.round(perimeter / 1.3), 12, 56);
    const glows = this.effects.createList(Math.max(arcs * (1 + SPARKS_PER_ARC), puffs) + MOST_BREAKS * SMOKE_WISPS);
    const seed = chance(root.position.x * 0.731 + root.position.z * 1.137);
    const fullBand = clamp(height * 0.06, 0.14, 0.32);
    const firstLayer = FIRST_LAYER_SECONDS / BUILDING_DEFINITIONS[kind].constructionSeconds;
    const widest = outline.radius * 1.05;
    // A plume sized for a Turret is lost against a Command Center.
    const smokeScale = clamp(perimeter / 14, 1, 2);

    /** Welding arcs hop between points of the deck's rim, no farther out than `reach`, at `power` (0 to 1). */
    const addArcs = (progress: number, reach: number, time: number, power: number) => {
      for (let arc = 0; arc < arcs; arc += 1) {
        const turn = time / (0.85 + 0.22 * arc) + arc * 0.37 + seed;
        const spot = Math.floor(turn);
        // Each arc fades out before it hops, so it never jumps while lit.
        const strength = power * Math.sin(Math.PI * (turn - spot)) ** 0.6;
        outline.surface(progress, chance(spot * 7.3 + arc * 31.7 + seed * 100) * Math.PI * 2, point);
        point.y = 0;
        outward.copy(point).normalize().transformDirection(root.matrixWorld);
        point.clampLength(0, reach).setY(outline.floor + height * progress).applyMatrix4(root.matrixWorld);
        glows.add(Glow.Flare, point, 0.55, strength, seed * 10 + arc);
        for (let spark = 0; spark < SPARKS_PER_ARC; spark += 1) {
          const index = arc * SPARKS_PER_ARC + spark + seed;
          const sideways = (chance(index * 3.1) - 0.5) * 2.4;
          velocity.set(-outward.z * sideways, 1.3 + 2.3 * chance(index * 5.7), outward.x * sideways)
            .addScaledVector(outward, 0.5 + 1.9 * chance(index * 9.3));
          glows.add(Glow.Spark, point, 0.24, strength, chance(index) * 10, velocity);
        }
      }
    };

    /** Sand kicked out around the pad while the scaffold drops, starting `delay` seconds in. */
    const addDust = (since: number, delay: number) => {
      for (let puff = 0; puff < puffs; puff += 1) {
        const age = (since - delay - chance(puff + seed) * 0.15) / DUST_SECONDS;
        if (age <= 0 || age >= 1) continue;
        const along = (puff + chance(puff * 1.7 + seed) * 0.8) / puffs * corners.length % corners.length;
        const side = Math.floor(along);
        point.lerpVectors(corners[side]!, corners[(side + 1) % corners.length]!, along - side);
        outward.subVectors(point, center).setY(0).normalize();
        velocity.copy(outward).multiplyScalar(0.25 + 0.7 * chance(puff * 3.3 + seed))
          .setY(0.25 + 0.5 * chance(puff * 5.9));
        glows.add(Glow.Dust, point.setY(ground + 0.2), 0.95 + 0.75 * chance(puff * 7.7), 1, 0, velocity, age);
      }
    };

    /** Smoke where the scaffold has been knocked loose, so damage reads from any zoom. */
    const addSmoke = () => {
      cage?.breaks.forEach((spot, index) => {
        for (let wisp = 0; wisp < SMOKE_WISPS; wisp += 1) {
          velocity.set(0.3 * (chance(index + wisp * 3.3) - 0.5), 1.2 + 0.3 * wisp, 0.3 * (chance(index * 2.1 + wisp) - 0.5))
            .multiplyScalar(smokeScale);
          glows.add(Glow.Smoke, spot, (0.75 + 0.25 * wisp) * smokeScale, 1, seed * 4 + index * 1.7 + wisp * 0.53, velocity);
        }
      });
    };

    let builtY = ground;
    let sunk = 0;
    // The weld, from 0 (out, cold) to 1: how strongly its arcs burn and how hot its steel is,
    // and when both were last moved. The first update finds it settled, lit or cold.
    let arcing = 0;
    let heat = 0;
    let weldedAt = -Infinity;
    const toSite = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const step = Math.PI * 2 / DIRECTIONS;
    /** The rim of the cut toward `angle`, in the building's frame, blended between the outline's directions. */
    const rimAt = (angle: number, out: THREE.Vector3, built = (builtY - ground) / height) => {
      const turn = angle / step;
      const before = Math.floor(turn);
      outline.surface(built, before * step, out);
      outline.surface(built, (before + 1) * step, neighbour);
      return out.lerp(neighbour, turn - before).setY(0);
    };
    /**
     * Sets `out` to the world point on the deck `off` metres from the building's axis along the
     * unit direction (x, z) and `across` metres to its left, pulled inside the rim where the hull
     * is narrower than a circle, but no nearer the axis than `least`.
     */
    const onDeck = (x: number, z: number, off: number, across: number, least: number, out: THREE.Vector3) => {
      const pointX = x * off - z * across;
      const pointZ = z * off + x * across;
      const rim = Math.max(least, rimAt(Math.atan2(pointZ, pointX), out).length() * SCAN_REACH);
      out.set(pointX, 0, pointZ)
        .clampLength(0, rim)
        .setY(Math.max(builtY, ground + DECK_FLOOR) - root.position.y)
        .applyMatrix4(root.matrixWorld);
    };
    return {
      scanLine(from, time, drone, start, end) {
        start.copy(from).applyMatrix4(toSite);
        const toward = Math.atan2(start.z, start.x);
        const distance = Math.hypot(start.x, start.z);
        const least = Math.max(SMALLEST_SCAN, distance * NARROWEST_FAN);
        const radius = Math.max(least, rimAt(toward, start).length() * SCAN_REACH);
        // Steady passes with soft turns, as a scanner's bar moves: a pendulum's swing reads as idling.
        const pass = time / PASS_SECONDS * (0.85 + 0.3 * ((drone * 7919.13) % 1)) + drone * 16;
        const sweep = Math.asin(SCAN_TURN * Math.sin(pass * Math.PI)) / Math.asin(SCAN_TURN);
        // The band of deck the line sweeps, along the drone's line of sight. On a deck too small
        // for the whole band it ends seven tenths of the way to the rim beyond the middle.
        const nearest = Math.min(radius * BAND_START, distance - NEAREST_SCAN);
        const depth = clamp(nearest + radius * 0.7, 0, EDGE_DEPTH);
        const middle = nearest - depth / 2;
        // The line lies across the direction it sweeps in, and that direction rocks about the
        // drone's line of sight.
        const turned = SCAN_ROCK * Math.sin(pass * Math.PI * 2 / SCAN_ROCK_PASSES + drone * 40);
        const x = Math.cos(toward + turned);
        const z = Math.sin(toward + turned);
        const limit = radius * 0.97;
        const off = clamp(middle * Math.cos(turned) + sweep * depth / 2, -limit, limit);
        // The line is as long as the fan is wide where it meets the deck, and no longer than a
        // round deck is wide there; `onDeck` trims it for other shapes.
        const reach = Math.min(
          WIDEST_SCAN, FAN_SPREAD * (distance * Math.cos(turned) - off), Math.sqrt(radius * radius - off * off),
        );
        const side = -middle * Math.sin(turned);
        onDeck(x, z, off, side - reach, least, start);
        onDeck(x, z, off, side + reach, least, end);
      },
      workPoint(from, reach, along, out) {
        out.copy(from).applyMatrix4(toSite);
        const toward = Math.atan2(out.z, out.x);
        const within = Math.hypot(out.x, out.z) - reach;
        // From the slice being built down to the first whose hull the drone reaches.
        const top = Math.min(SLICES - 1, Math.floor((builtY - ground) / height * SLICES));
        let slice = top;
        while (slice > 0 && rimAt(toward, out, (slice + 0.5) / SLICES).length() < within) slice -= 1;
        const radius = rimAt(toward, out, (slice + 0.5) / SLICES).length();
        const edge = slice === top ? Math.max(builtY, ground + DECK_FLOOR) : ground + height * (slice + 1) / SLICES;
        return rimAt(toward + along / Math.max(radius, 0.5), out, (slice + 0.5) / SLICES)
          .setY(edge - root.position.y)
          .applyMatrix4(root.matrixWorld);
      },
      update({ progress, working, health, lifecycle, sinceLifecycleChange: since }, time) {
        glows.clear();
        const cut = ground + height * progress;
        builtY = cut;
        if (lifecycle === "active") {
          // The finished building is the untouched model from the first frame; only the
          // scaffold and its dust are still leaving.
          reveal.finish();
          deck.hide();
          cage?.set(Math.min(1, since / RETRACT_SECONDS) ** 2, health);
          // The dust is thickest as the pad and its kerbs go under.
          addDust(since, 0.2);
          return since < COMPLETION_SECONDS;
        }
        const constructing = lifecycle === "constructing";
        const welding = constructing && working;
        // The weld comes up and dies down instead of switching: the arcs follow the drone
        // quickly, and the steel's glow follows the arcs. Both move at a steady rate, so a
        // drone that stops and resumes in quick succession turns each fade round from where
        // it is, and nothing pops.
        const elapsed = Math.max(0, time - weldedAt);
        weldedAt = time;
        arcing = clamp(arcing + elapsed / (welding ? ARC_SECONDS : -ARC_SECONDS), 0, 1);
        heat = clamp(heat + elapsed / (welding ? HEAT_SECONDS : -COOL_SECONDS), 0, 1);
        // Squared, because the seam is far brighter than white: an even fade would hold it white
        // for half its time and then drop. A destroyed site goes dark at once.
        const glow = constructing ? heat * heat : 0;
        // The last courses have no bare band left, so completion does not repaint the roof.
        const band = fullBand * (1 - smoothstep(progress, 0.86, 1));
        const flicker = 0.82 + 0.18 * Math.sin(time * 23 + seed * 40) * Math.sin(time * 17.3);
        // Nothing is welded at 0%. The first layer then spreads out from under the beam.
        const spread = 1 - (1 - Math.min(1, progress / firstLayer)) ** 2;
        const reach = spread < 1 ? widest * spread : WHOLE_HULL;
        reveal.set(cut - sunk, band, glow * flicker, reach);
        if (spread) deck.set(progress, Math.max(cut, ground + DECK_FLOOR) - sunk, glow * flicker, reach);
        else deck.hide();
        cage?.set(constructing ? 0 : Math.min(1, since / COLLAPSE_SECONDS) ** 2, health);
        if (!constructing) {
          addDust(since, 0);
          return true;
        }
        if (arcing && spread) addArcs(progress, reach, time, smoothstep(arcing, 0, 1));
        addSmoke();
        return true;
      },
      sinkStump(metres) {
        sunk = metres;
      },
      dispose() {
        disposed = true;
        releaseReveal(reveal);
        deck.hide();
        cage?.dispose();
        glows.dispose();
      },
    };
  }

  /**
   * Stands two throwaway sites of `kind` far below the terrain, one being welded and one
   * just destroyed, so that a render compiles every shader a site ever needs
   * before the first one is placed. `model` is a loaded building's visual root. Call `flush`,
   * render, then call the returned function. The sites' cut materials are kept until `dispose`:
   * the renderer drops a shader program as soon as the last material using it is disposed.
   */
  prepareRendering(kind: BuildingKind, model: THREE.Object3D) {
    const states: SiteState[] = [
      { progress: 0.5, working: true, health: 0.5, lifecycle: "constructing", sinceLifecycleChange: 0 },
      { progress: 0.5, working: false, health: 0, lifecycle: "destroyed", sinceLifecycleChange: 0.05 },
    ];
    const stand = states.map((state) => {
      const root = new THREE.Group();
      root.position.y = -10_000;
      const visual = model.clone(true);
      visual.traverse((object) => {
        object.frustumCulled = false;
      });
      root.add(visual);
      this.parent.add(root);
      const site = this.stand(kind, root, visual, (reveal) => {
        reveal.finish();
        this.preparedReveals.push(reveal);
      });
      site?.update(state, 0);
      return { root, site };
    });
    this.scaffolding?.cull(false);
    return () => {
      this.scaffolding?.cull(true);
      for (const { root, site } of stand) {
        site?.dispose();
        root.removeFromParent();
      }
    };
  }

  /** Gathers every site's decks and glows for drawing; call once per rendered frame, after the updates. */
  flush(time: number) {
    this.effects.flush(time);
    this.decks.flush();
  }

  dispose() {
    this.disposed = true;
    for (const reveal of this.preparedReveals) reveal.dispose();
    this.effects.dispose();
    this.decks.dispose();
    this.scaffolding?.dispose();
  }
}
