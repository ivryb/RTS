import * as THREE from "three";
import { BUILDING_DEFINITIONS } from "../../../src/sim/construction";
import type { BuildingKind } from "../../../src/sim/units";
import type { ConstructionSite, ConstructionSketch } from "../sketch";
import { Scaffolding } from "./scaffold/cage";
import { Decks } from "./scaffold/deck";
import { Glow, WorkEffects } from "./scaffold/effects";
import { measureOutline, type Outline } from "./scaffold/outline";
import { createReveal } from "./scaffold/reveal";

/** Seconds the scaffold takes to drop into its pad once the building is complete. */
const RETRACT_SECONDS = 0.5;
/** Seconds it takes to drop when the site is destroyed before completion. */
const COLLAPSE_SECONDS = 0.24;
const DUST_SECONDS = 0.62;
const SPARKS_PER_ARC = 7;
/** Metres of air between the hull and the scaffold around it. */
const CLEARANCE = 0.15;
/** A side of the scaffold shorter than this is left out, and its two corners share a post. */
const SHORTEST_SIDE = 0.5;
/** Progress by which the first layer has spread from the drone's beam out to the hull. */
const FIRST_LAYER = 0.02;
/** Metres above the ground below which the deck never lies, to stay clear of the pad's plates. */
const DECK_FLOOR = 0.07;

let scaffolding: Scaffolding;
let effects: WorkEffects;
let decks: Decks;
/** The hull outline is a property of the model, so each kind is measured once. */
const hulls = new Map<BuildingKind, { outline: Outline; table: number }>();

const point = new THREE.Vector3();
const outward = new THREE.Vector3();
const velocity = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
/** A stable 0 to 1 number for a seed. */
const chance = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};

/** The model's box in its root's frame: where its floor is and how tall it stands. */
const measureBounds = (root: THREE.Object3D, visual: THREE.Object3D) => {
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const toRoot = new THREE.Matrix4();
  const box = new THREE.Box3();
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
 * The ground outline of a site's scaffold, in world space: the eight-sided shape that hugs the
 * main hull, four sides square to the map and four diagonal, walked with the outside on the
 * right. It is square to the map rather than to the building, so every site stands the same
 * way to the fixed camera, however its building is turned.
 */
const hugHull = (root: THREE.Object3D, outline: Outline, floor: number) => {
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const sides = Array.from({ length: 8 }, (_, side) => {
    const x = Math.cos(-side * Math.PI / 4);
    const z = Math.sin(-side * Math.PI / 4);
    outward.set(x, 0, z).transformDirection(toRoot);
    return { x, z, reach: outline.reach(outward.x, outward.z) + CLEARANCE };
  });
  // Each corner is where a side's line meets the next side's.
  const corners = sides.map((side, index) => {
    const next = sides[(index + 1) % sides.length];
    const turn = side.x * next.z - side.z * next.x;
    return new THREE.Vector3(
      root.position.x + (side.reach * next.z - next.reach * side.z) / turn,
      floor,
      root.position.z + (next.reach * side.x - side.reach * next.x) / turn,
    );
  });
  return corners.filter((corner, index) => corner.distanceTo(corners[(index + 1) % corners.length]) >= SHORTEST_SIDE);
};

export const sketch: ConstructionSketch = {
  title: "Scaffold: built inside a scaffold",

  async prepare({ scene }) {
    scaffolding = await Scaffolding.load(scene);
    effects = new WorkEffects(scene);
    decks = new Decks(scene, Object.keys(BUILDING_DEFINITIONS).length);
  },

  createSite({ kind, root, visualRoot }) {
    root.updateWorldMatrix(true, true);
    const bounds = measureBounds(root, visualRoot);
    const height = bounds.max.y - bounds.min.y;
    const ground = root.position.y + bounds.min.y;
    let hull = hulls.get(kind);
    if (!hull) {
      const outline = measureOutline(root, visualRoot, bounds);
      hull = { outline, table: decks.addHull(outline.decks) };
      hulls.set(kind, hull);
    }
    const { outline } = hull;
    const corners = hugHull(root, outline, ground);
    // The scaffold stops at the main roofline; a dish or a mast stands proud of it.
    const cage = scaffolding.createCage(root, corners, height * outline.roofline);
    const reveal = createReveal(root, visualRoot);
    const deck = decks.createDeck(root, hull.table);

    const perimeter = corners.reduce((total, corner, index) => total + corner.distanceTo(corners[(index + 1) % corners.length]), 0);
    const center = corners.reduce((sum, corner) => sum.add(corner), new THREE.Vector3()).divideScalar(corners.length);
    const arcs = clamp(Math.round(perimeter / 9), 2, 5);
    const puffs = clamp(Math.round(perimeter / 1.3), 12, 56);
    const glows = effects.createList(Math.max(arcs * (1 + SPARKS_PER_ARC), puffs));
    const seed = chance(root.position.x * 0.731 + root.position.z * 1.137);
    const fullBand = clamp(height * 0.06, 0.14, 0.32);

    /**
     * Welding arcs hop between points of the deck's rim, which is the hull at the height being
     * built once the first layer has spread out to it (`spread` 1).
     */
    const addArcs = (progress: number, spread: number, time: number) => {
      for (let arc = 0; arc < arcs; arc += 1) {
        const turn = time / (0.85 + 0.22 * arc) + arc * 0.37 + seed;
        const spot = Math.floor(turn);
        // Each arc fades out before it hops, so it never jumps while lit.
        const strength = Math.sin(Math.PI * (turn - spot)) ** 0.6;
        outline.surface(progress, chance(spot * 7.3 + arc * 31.7 + seed * 100) * Math.PI * 2, point);
        outward.set(point.x, 0, point.z).normalize().transformDirection(root.matrixWorld);
        point.multiplyScalar(spread).setY(bounds.min.y + height * progress).applyMatrix4(root.matrixWorld);
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
        point.lerpVectors(corners[side], corners[(side + 1) % corners.length], along - side);
        outward.subVectors(point, center).setY(0).normalize();
        velocity.copy(outward).multiplyScalar(0.25 + 0.7 * chance(puff * 3.3 + seed))
          .setY(0.25 + 0.5 * chance(puff * 5.9));
        glows.add(Glow.Dust, point.setY(ground + 0.2), 0.95 + 0.75 * chance(puff * 7.7), 1, 0, velocity, age);
      }
    };

    const site: ConstructionSite = {
      beamTargetY: ground,
      update({ progress, working, health, lifecycle, sinceLifecycleChange: since }, time) {
        glows.clear();
        const cut = ground + height * progress;
        site.beamTargetY = cut;
        if (lifecycle === "active") {
          // The finished building is the untouched model from the first frame; only the
          // scaffold and its dust are still leaving.
          reveal.finish();
          deck.hide();
          cage.set(Math.min(1, since / RETRACT_SECONDS) ** 2, health);
          addDust(since, 0.12);
          return;
        }
        const constructing = lifecycle === "constructing";
        const welding = constructing && working;
        // The last courses have no bare band left, so completion does not repaint the roof.
        const band = fullBand * (1 - THREE.MathUtils.smoothstep(progress, 0.86, 1));
        const flicker = 0.82 + 0.18 * Math.sin(time * 23 + seed * 40) * Math.sin(time * 17.3);
        // Nothing is welded at 0%. The first layer then spreads out from under the beam.
        const spread = THREE.MathUtils.smoothstep(progress, 0, FIRST_LAYER);
        reveal.set(cut, band, welding ? flicker : 0);
        if (spread) deck.set(progress, Math.max(cut, ground + DECK_FLOOR), welding ? flicker : 0, spread);
        else deck.hide();
        cage.set(constructing ? 0 : Math.min(1, since / COLLAPSE_SECONDS) ** 2, health);
        if (welding && spread) addArcs(progress, spread, time);
        else if (constructing) {
          for (const beacon of cage.beacons) glows.add(Glow.Beacon, beacon, 0.34, 0.85, seed * 6.28);
        } else addDust(since, 0);
      },
      dispose() {
        reveal.dispose();
        deck.hide();
        cage.dispose();
        glows.dispose();
      },
    };
    return site;
  },

  flush(time) {
    effects.flush(time);
    decks.flush();
  },
};
