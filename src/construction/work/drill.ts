import * as THREE from "three";
import { Glow } from "../glowEffects";
import type { WorkStyle } from "./style";

/** Seconds one bore takes, from the push in to the end of the shift to the next spot. */
const BORE_SECONDS = 2.4;
/** The shares of a bore at which the bit is home, starts to back off, and is clear of the edge. */
const HOME = 0.1;
const DONE = 0.75;
const CLEAR = 0.85;
/** Metres to the side of straight ahead that a spot lies along the edge, at least and at most. */
const NEAREST = 0.12;
const FARTHEST = 0.45;
/** Metres from the nozzle to the spot: backed off, as the bit touches, and how much closer it creeps as it bites. */
const BACKED_OFF = 0.6;
const TOUCHING = 0.3;
const BITE = 0.14;
/** Metres the nozzle rides above the spot while it drills, and the most the drone dips to get there. */
const RIDE = 0.1;
const DEEPEST_DIP = 0.5;
/** Metres the drone leans in to its work, at most. */
const LONGEST_LEAN = 1.3;
/** Metres the body shakes to each side while the bit turns. */
const SHUDDER = 0.04;
const SPARKS = 16;
/** How fast the spray turns about the spot. */
const TURNS_PER_SECOND = 1.4;
/** Radians one of the spray's two lobes fans out over. */
const LOBE = 1.2;

const nozzle = new THREE.Vector3();
const toward = new THREE.Vector3();
const velocity = new THREE.Vector3();
const { clamp, lerp, smoothstep } = THREE.MathUtils;
/** A stable 0 to 1 number for a seed. */
const chance = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};
/** How far through its bore a drone is at `time`: the whole part counts the bores, the rest runs 0 to 1. */
const boreAt = (time: number, seed: number) => time / BORE_SECONDS + seed * 9;
/**
 * The seed of one spark of the spray. The glow shader gives a spark 0.34 to 0.64 s of flight from
 * `fract(seed * 7.13)`: these seeds all get the shortest, so the spray stays a flat wheel about the
 * spot instead of a falling shower, and their strides of 20 spread the sparks evenly through it.
 */
const sparkSeed = (spark: number, seed: number) => (spark * 20 + Math.floor(seed * 50) + 0.02 + 0.1 * chance(spark)) / 7.13;

/**
 * Drilling: the drone pushes its nozzle down onto the edge in front of it and holds it there,
 * shaking and creeping in as the bit bites, while a flat, two-lobed spray of sparks spins off the
 * spot. Then it backs off, shifts to another spot along the edge and drills again.
 */
export const drill: WorkStyle = {
  reach: 2.4,
  fadeSeconds: 0.2,
  aim(tool, site, time) {
    const bore = boreAt(time, tool.seed);
    const spot = Math.floor(bore);
    // Spots alternate sides, so every shift is far enough to see.
    const at = (index: number) => (index % 2 ? 1 : -1) * lerp(NEAREST, FARTHEST, chance(index * 3.7 + tool.seed * 31));
    // It shifts to the next spot once the bit is clear of the edge.
    const shift = smoothstep(bore - spot, CLEAR - 0.03, 1);
    site.workPoint(tool.from, drill.reach, lerp(at(spot), at(spot + 1), shift), tool.contact);
  },
  draw(tool, time, power) {
    const bore = boreAt(time, tool.seed);
    const phase = bore - Math.floor(bore);
    const pressed = smoothstep(phase, 0, HOME) * (1 - smoothstep(phase, DONE, CLEAR));
    const bitten = clamp((phase - HOME) / (DONE - HOME), 0, 1);
    const drilling = smoothstep(phase, HOME - 0.03, HOME) * (1 - smoothstep(phase, DONE, DONE + 0.02)) * power;
    // Lean in along the drone's forward and dip until the nozzle rides on the spot.
    tool.nozzle.getWorldPosition(nozzle);
    toward.set(tool.contact.x - nozzle.x, 0, tool.contact.z - nozzle.z);
    const gap = toward.length();
    toward.normalize();
    const depth = lerp(BACKED_OFF, TOUCHING - BITE * bitten, pressed);
    tool.body.position.z = clamp(gap - depth, -BACKED_OFF, LONGEST_LEAN) * power;
    tool.body.position.y = -clamp(nozzle.y - tool.contact.y - RIDE, 0, DEEPEST_DIP) * pressed * power;
    if (!drilling) return;
    tool.body.position.x = Math.sin(time * 71 + tool.seed * 20) * SHUDDER * drilling;
    tool.body.position.y += Math.sin(time * 89 + tool.seed * 7) * SHUDDER * 0.6 * drilling;
    tool.body.position.z += Math.sin(time * 113 + tool.seed * 3) * SHUDDER * 0.4 * drilling;
    tool.glows.add(Glow.Flare, tool.contact, 0.45, drilling, tool.seed * 10);
    // The spray lies flat about the spot, so the camera sees it turn from every side of the
    // building, and leaves in two opposite lobes, like swarf off a bit's two flutes: an even wheel
    // would only shimmer. Every spark's heading turns with the bit, also in flight: that is the spin.
    const turned = time * TURNS_PER_SECOND * Math.PI * 2 * (tool.seed < 0.5 ? 1 : -1) + tool.seed * 40;
    for (let spark = 0; spark < SPARKS; spark += 1) {
      const angle = turned + (spark % 2) * Math.PI + (chance(spark * 7.1) - 0.5) * LOBE;
      const inward = Math.cos(angle);
      const across = Math.sin(angle);
      // The upward share carries a spark against gravity for its short flight.
      velocity.set(toward.x * inward + toward.z * across, 0, toward.z * inward - toward.x * across)
        .multiplyScalar(1.8 + chance(spark * 9.3 + tool.seed * 50))
        .setY(1.4);
      // Sparks heading into the building are fainter: later in the build there is a wall there.
      const strength = drilling * (0.7 - 0.3 * inward) * (0.7 + 0.3 * chance(spark * 5.7));
      tool.glows.add(Glow.Spark, tool.contact, 0.26, strength, sparkSeed(spark, tool.seed), velocity);
    }
  },
};
