import * as THREE from "three";
import { Decks } from "./construction/deck";
import { Glow, GlowEffects } from "./construction/glowEffects";
import { measureOutline, type Outline } from "./construction/outline";
import { createReveal } from "./construction/reveal";
import { loadScaffoldKit, MOST_BREAKS, Scaffolding, type Cage, type ScaffoldKitLoader } from "./construction/scaffold";
import { BUILDING_DEFINITIONS } from "./sim/construction";
import type { BuildingKind } from "./sim/units";

/** Seconds the scaffold takes to drop into its pad once the building is complete. */
const RETRACT_SECONDS = 0.5;
/** Seconds it takes to drop when the site is destroyed before completion. */
const COLLAPSE_SECONDS = 0.24;
const DUST_SECONDS = 0.62;
/** Seconds after completion by which the scaffold and the last of its dust are gone. */
const COMPLETION_SECONDS = 0.95;
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
  /** World height at which the building is being built: where a Scout Drone's beam ends. */
  readonly beamTargetY: number;
  /**
   * Sets every visual from `state` and `time` alone, with nothing carried over from the last
   * call. Returns false once the building is complete and nothing of its construction is
   * left to show, so the site can be disposed.
   */
  update(state: SiteState, time: number): boolean;
  /**
   * Fades what a destroyed site leaves standing, the cut building and its deck, from 1 to 0.
   * D77-6 replaces this with its own treatment of that stump.
   */
  fadeStump(opacity: number): void;
  dispose(): void;
}

const point = new THREE.Vector3();
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
  /** Sparks, lamps, dust and smoke. Other world effects may add their own lists to it. */
  readonly effects: GlowEffects;
  private readonly decks: Decks;
  private readonly hulls = new Map<BuildingKind, { outline: Outline; table: number }>();
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
    this.loading ??= this.loadKit().then(
      (kit) => {
        if (!this.disposed) this.scaffolding = Scaffolding.create(this.parent, kit);
      },
      // A site still shows its building rising without the kit, so play goes on.
      (error: unknown) => console.error("Scaffold kit failed to load", error),
    );
    return this.loading;
  }

  /**
   * Measures a building kind's hull from its loaded model, once. Call it when a model loads,
   * so the first site of that kind does not pay for it. `root` is the building's root and
   * `visualRoot` holds its model. A model with no meshes has no hull.
   */
  measure(kind: BuildingKind, root: THREE.Object3D, visualRoot: THREE.Object3D) {
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
  createSite(kind: BuildingKind, root: THREE.Object3D, visualRoot: THREE.Object3D): ConstructionSite | undefined {
    const hull = this.measure(kind, root, visualRoot);
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
    const stand = () => {
      if (!disposed) cage = this.scaffolding?.createCage(root, corners, height * outline.roofline);
    };
    if (this.scaffolding) stand();
    else void this.load().then(stand);

    const perimeter = corners.reduce((total, corner, index) => total + corner.distanceTo(corners[(index + 1) % corners.length]!), 0);
    const center = corners.reduce((sum, corner) => sum.add(corner), new THREE.Vector3()).divideScalar(corners.length);
    const arcs = clamp(Math.round(perimeter / 9), 2, 5);
    const puffs = clamp(Math.round(perimeter / 1.3), 12, 56);
    const glows = this.effects.createList(
      Math.max(arcs * (1 + SPARKS_PER_ARC), puffs, corners.length) + MOST_BREAKS * SMOKE_WISPS,
    );
    const seed = chance(root.position.x * 0.731 + root.position.z * 1.137);
    const fullBand = clamp(height * 0.06, 0.14, 0.32);
    const fullFraming = clamp(height * 0.1, 0.4, 0.7);
    const framePitch = clamp(height * 0.085, 0.22, 0.5);
    const firstLayer = FIRST_LAYER_SECONDS / BUILDING_DEFINITIONS[kind].constructionSeconds;
    const widest = outline.radius * 1.05;

    /** Welding arcs hop between points of the deck's rim, no farther out than `reach`. */
    const addArcs = (progress: number, reach: number, time: number) => {
      for (let arc = 0; arc < arcs; arc += 1) {
        const turn = time / (0.85 + 0.22 * arc) + arc * 0.37 + seed;
        const spot = Math.floor(turn);
        // Each arc fades out before it hops, so it never jumps while lit.
        const strength = Math.sin(Math.PI * (turn - spot)) ** 0.6;
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
          velocity.set(0.3 * (chance(index + wisp * 3.3) - 0.5), 1.2 + 0.3 * wisp, 0.3 * (chance(index * 2.1 + wisp) - 0.5));
          glows.add(Glow.Smoke, spot, 0.75 + 0.25 * wisp, 1, seed * 4 + index * 1.7 + wisp * 0.53, velocity);
        }
      });
    };

    let beamTargetY = ground;
    return {
      get beamTargetY() {
        return beamTargetY;
      },
      update({ progress, working, health, lifecycle, sinceLifecycleChange: since }, time) {
        glows.clear();
        const cut = ground + height * progress;
        beamTargetY = cut;
        if (lifecycle === "active") {
          // The finished building is the untouched model from the first frame; only the
          // scaffold and its dust are still leaving.
          reveal.finish();
          deck.hide();
          cage?.set(Math.min(1, since / RETRACT_SECONDS) ** 2, health);
          addDust(since, 0.12);
          return since < COMPLETION_SECONDS;
        }
        const constructing = lifecycle === "constructing";
        const welding = constructing && working;
        // The last courses have no bare band left, so completion does not repaint the roof.
        const band = fullBand * (1 - smoothstep(progress, 0.86, 1));
        const flicker = 0.82 + 0.18 * Math.sin(time * 23 + seed * 40) * Math.sin(time * 17.3);
        // Nothing is welded at 0%. The first layer then spreads out from under the beam.
        const spread = 1 - (1 - Math.min(1, progress / firstLayer)) ** 2;
        const reach = spread < 1 ? widest * spread : WHOLE_HULL;
        reveal.set(cut, band, fullFraming * spread, framePitch, welding ? flicker : 0, reach);
        if (spread) deck.set(progress, Math.max(cut, ground + DECK_FLOOR), welding ? flicker : 0, reach);
        else deck.hide();
        cage?.set(constructing ? 0 : Math.min(1, since / COLLAPSE_SECONDS) ** 2, health);
        if (!constructing) {
          addDust(since, 0);
          return true;
        }
        if (welding && spread) addArcs(progress, reach, time);
        else for (const lamp of cage?.lamps ?? []) glows.add(Glow.Lamp, lamp, 0.34, 0.85, seed * 6.28);
        addSmoke();
        return true;
      },
      fadeStump(opacity) {
        reveal.setOpacity(opacity);
        deck.setOpacity(opacity);
      },
      dispose() {
        disposed = true;
        reveal.dispose();
        deck.hide();
        cage?.dispose();
        glows.dispose();
      },
    };
  }

  /**
   * Stands two throwaway sites of `kind` far below the terrain, one being welded and one
   * fading after its destruction, so that a render compiles every shader a site ever needs
   * before the first one is placed. `model` is a loaded building's visual root. Call `flush`,
   * render, then call the returned function.
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
      const site = this.createSite(kind, root, visual);
      site?.update(state, 0);
      if (state.lifecycle === "destroyed") site?.fadeStump(0.5);
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
    this.effects.dispose();
    this.decks.dispose();
    this.scaffolding?.dispose();
  }
}
