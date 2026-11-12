import * as THREE from "three";
import type { BuildingKind } from "../../../src/sim/units";
import type { ConstructionSite, ConstructionSketch } from "../sketch";
import { Scaffolding } from "./scaffold/cage";
import { Glow, WorkEffects } from "./scaffold/effects";
import { measureOutline, type Outline } from "./scaffold/outline";
import { createReveal } from "./scaffold/reveal";

/** Seconds the scaffold takes to drop into its pad once the building is complete. */
const RETRACT_SECONDS = 0.5;
/** Seconds it takes to drop when the site is destroyed before completion. */
const COLLAPSE_SECONDS = 0.24;
const DUST_SECONDS = 0.62;
const SPARKS_PER_ARC = 7;

let scaffolding: Scaffolding;
let effects: WorkEffects;
/** The hull outline is a property of the model, so each kind is measured once. */
const outlines = new Map<BuildingKind, Outline>();

const point = new THREE.Vector3();
const outward = new THREE.Vector3();
const velocity = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
/** A stable 0 to 1 number for a seed. */
const chance = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};

/** The model's box in its root's frame, so the scaffold turns with a rotated building. */
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

export const sketch: ConstructionSketch = {
  title: "Scaffold: built inside a scaffold",

  async prepare({ scene }) {
    scaffolding = await Scaffolding.load(scene);
    effects = new WorkEffects(scene);
  },

  createSite({ kind, root, visualRoot }) {
    root.updateWorldMatrix(true, true);
    const bounds = measureBounds(root, visualRoot);
    const height = bounds.max.y - bounds.min.y;
    const ground = root.position.y + bounds.min.y;
    const cage = scaffolding.createCage(root, bounds);
    const reveal = createReveal(root, visualRoot);
    let outline = outlines.get(kind);
    if (!outline) {
      outline = measureOutline(root, visualRoot, bounds);
      outlines.set(kind, outline);
    }

    const [first, second, third] = cage.corners;
    const perimeter = (first.distanceTo(second) + second.distanceTo(third)) * 2;
    const center = new THREE.Vector3().addVectors(first, third).multiplyScalar(0.5);
    const arcs = clamp(Math.round(perimeter / 9), 2, 5);
    const puffs = clamp(Math.round(perimeter / 1.3), 12, 56);
    const glows = effects.createList(Math.max(arcs * (1 + SPARKS_PER_ARC), puffs));
    const seed = chance(root.position.x * 0.731 + root.position.z * 1.137);
    const fullBand = clamp(height * 0.06, 0.14, 0.32);

    /** Welding arcs hop between points of the hull at the height being built. */
    const addArcs = (progress: number, time: number) => {
      for (let arc = 0; arc < arcs; arc += 1) {
        const turn = time / (0.85 + 0.22 * arc) + arc * 0.37 + seed;
        const spot = Math.floor(turn);
        // Each arc fades out before it hops, so it never jumps while lit.
        const strength = Math.sin(Math.PI * (turn - spot)) ** 0.6;
        const angle = chance(spot * 7.3 + arc * 31.7 + seed * 100) * Math.PI * 2;
        const radius = outline.radius(progress, angle);
        outward.set(Math.cos(angle), 0, Math.sin(angle));
        point.copy(outward).multiplyScalar(radius).setY(bounds.min.y + height * progress)
          .applyMatrix4(root.matrixWorld);
        outward.transformDirection(root.matrixWorld);
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
        const along = (puff + chance(puff * 1.7 + seed) * 0.8) / puffs * 4 % 4;
        const side = Math.floor(along);
        point.lerpVectors(cage.corners[side], cage.corners[(side + 1) % 4], along - side);
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
          cage.set(Math.min(1, since / RETRACT_SECONDS) ** 2, health);
          addDust(since, 0.12);
          return;
        }
        const constructing = lifecycle === "constructing";
        const welding = constructing && working;
        // The last courses have no bare band left, so completion does not repaint the roof.
        const band = fullBand * (1 - THREE.MathUtils.smoothstep(progress, 0.86, 1));
        const flicker = 0.82 + 0.18 * Math.sin(time * 23 + seed * 40) * Math.sin(time * 17.3);
        reveal.set(cut, band, welding ? flicker : 0);
        cage.set(constructing ? 0 : Math.min(1, since / COLLAPSE_SECONDS) ** 2, health);
        if (welding) addArcs(progress, time);
        else if (constructing) {
          for (const beacon of cage.beacons) glows.add(Glow.Beacon, beacon, 0.34, 0.85, seed * 6.28);
        } else addDust(since, 0);
      },
      dispose() {
        reveal.dispose();
        cage.dispose();
        glows.dispose();
      },
    };
    return site;
  },

  flush: (time) => effects.flush(time),
};
