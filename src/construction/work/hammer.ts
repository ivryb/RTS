import * as THREE from "three";
import { Glow } from "../glowEffects";
import type { WorkStyle } from "./style";

/** Seconds from one blow to the next, and from the start of one burst of blows to the start of the next. */
const BLOW_SECONDS = 0.3;
const BURST_SECONDS = 2.3;
/** The blows of the longest burst; others are one or two shorter, and rest that much longer. */
const MOST_BLOWS = 6;
/** Seconds at the end of a burst's time in which the drone moves on to its next spot. */
const SHIFT_SECONDS = 0.4;
/** Metres to each side of straight ahead that the spots lie along the edge. */
const SPREAD = 0.6;
/** Metres the tool head stops short of the spot it strikes, and above it. */
const STANDOFF = 0.08;
/** Metres the drone leans in to its work, at most: its tool head can start this far from the edge it reaches. */
const LONGEST_LEAN = 1.8;
/** Metres the tool head stays above the ground, so a drone hammering a building's first course does not dig in. */
const LOWEST = 0.4;
/**
 * Metres the drone swings back between two blows. It swings level: the camera looks down at 42
 * degrees, so a swing back and up runs along its line of sight for a drone on its side of a building.
 */
const SWING = 0.65;
const FLASH_SECONDS = 0.12;
const SPARKS = 9;

const nozzle = new THREE.Vector3();
const velocity = new THREE.Vector3();
const { clamp, lerp, smoothstep } = THREE.MathUtils;
/** A stable 0 to 1 number for a seed. */
const chance = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * Metres to the left of straight ahead that a drone hammers in its `burst`. Bursts take sides
 * in turn, so every move to the next spot is far enough to show.
 */
const spotOf = (burst: number, seed: number) =>
  (burst % 2 ? 1 : -1) * SPREAD * (0.35 + 0.65 * chance(burst * 3.7 + seed * 31));

/** Seconds a `Glow.Spark` flies for a `span` of 0 to 1: the life its shader gives it. */
const flight = (span: number) => 0.34 + 0.3 * span;
/**
 * The seed that has a `Glow.Spark` leave its origin at `born`, or up to 4% of its flight sooner,
 * and fly for `flight(span)`. A spark loops on its own from the glows' clock, which runs in step
 * with the `time` a style is given; this solves its shader's `life = 0.34 + 0.3 fract(7.13 seed)`
 * and `age = fract(time / life + 3.7 seed)` for the seed. Keep `span` clear of 0 and 1.
 */
const bornAt = (born: number, span: number) => {
  const wanted = -born / flight(span) - span * (3.7 / 7.13);
  // Raising the seed by 2 / 7.13 leaves the life as it is and moves the age on by 0.0379: some
  // count of such steps brings the age at `born` to within that of 0.
  const steps = Math.ceil((wanted - Math.floor(wanted)) / (7.4 / 7.13 - 1));
  return (2 * steps + span) / 7.13;
};

/**
 * Hammering: the drone drives its tool head into the edge in front of it in a burst of quick
 * blows, each landing with a flash and a shower of sparks and throwing the drone back, then
 * hangs back for a beat while it moves on to the next spot. `ends[0]` is the spot the burst lands on.
 */
export const hammer: WorkStyle = {
  reach: 2.4,
  fadeSeconds: 0.2,
  aim(tool, site, time) {
    const turn = time / BURST_SECONDS + tool.seed * 9;
    const burst = Math.floor(turn);
    const spot = spotOf(burst, tool.seed);
    // The sparks of the last blow stay where it landed while the drone looks on to the next spot.
    site.workPoint(tool.from, hammer.reach, spot, tool.ends[0]);
    const shift = smoothstep((turn - burst) * BURST_SECONDS, BURST_SECONDS - SHIFT_SECONDS, BURST_SECONDS);
    if (shift) site.workPoint(tool.from, hammer.reach, lerp(spot, spotOf(burst + 1, tool.seed), shift), tool.contact);
    else tool.contact.copy(tool.ends[0]);
  },
  draw(tool, time, power) {
    const struck = tool.ends[0];
    tool.nozzle.getWorldPosition(nozzle);
    const turn = time / BURST_SECONDS + tool.seed * 9;
    const burst = Math.floor(turn);
    const blows = MOST_BLOWS - Math.floor(chance(burst * 1.7 + tool.seed * 13) * 3);
    // A blow lands on every whole beat from 1 to `blows`. Between two blows the drone swings back
    // and in again like a bouncing ball, fastest as it strikes. Before the first and after the
    // last it waits at the top of the swing.
    const beat = (turn - burst) * BURST_SECONDS / BLOW_SECONDS;
    const phase = beat % 1;
    const swing = beat > 0.5 && beat < blows + 0.5 ? 4 * phase * (1 - phase) : 1;
    const gap = Math.hypot(tool.contact.x - nozzle.x, tool.contact.z - nozzle.z);
    const drop = Math.max(tool.contact.y + STANDOFF, tool.from.y + LOWEST) - nozzle.y;
    tool.body.position.set(0, drop * power, (clamp(gap - STANDOFF, 0, LONGEST_LEAN) - swing * SWING) * power);
    const latest = Math.min(Math.floor(beat), blows);
    // Sparks fly for up to two beats, so the blow before the latest still has some in the air.
    for (let blow = latest; blow > Math.max(0, latest - 2); blow -= 1) {
      const since = (beat - blow) * BLOW_SECONDS;
      const flash = 1 - since / FLASH_SECONDS;
      if (flash > 0) tool.glows.add(Glow.Flare, struck, 1, flash * flash * power, tool.seed * 10);
      for (let spark = 0; spark < SPARKS; spark += 1) {
        const index = spark + blow * 17 + burst * 131 + tool.seed * 50;
        const span = 0.05 + 0.65 * chance(index * 2.3);
        // Past its flight a spark would loop and leave the spot again.
        if (since > flight(span) * 0.96) continue;
        // Thrown out toward the drone and to the sides, then they fall.
        velocity.set(nozzle.x - struck.x, 0, nozzle.z - struck.z).normalize()
          .multiplyScalar(0.5 + 2 * chance(index * 9.3));
        velocity.x += (chance(index * 3.1) - 0.5) * 5;
        velocity.z += (chance(index * 4.3) - 0.5) * 5;
        velocity.y = 1.5 + 3 * chance(index * 5.7);
        tool.glows.add(Glow.Spark, struck, 0.24, power, bornAt(time - since, span), velocity);
      }
    }
  },
};
