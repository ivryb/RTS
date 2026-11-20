import * as THREE from "three";
import { Glow } from "../glowEffects";
import type { WorkStyle } from "./style";

/** Seconds an arm spends on one spot, and the share of that it spends swinging over to the next with its arc out. */
const SPOT_SECONDS = 1.5;
const MOVING = 0.28;
/** Metres from straight ahead to the nearest and the farthest spot an arm welds, on its own side. */
const NEAREST_SPOT = 0.2;
const FARTHEST_SPOT = 0.5;
/** Metres an arm draws its arc along the edge while it burns. */
const BEAD = 0.16;
/** Metres the tool's tip lifts off the edge on its way to the next spot. */
const HOP = 0.3;
/** Metres the drone's nose stays from the edge: it works at arm's length. */
const STANDOFF = 0.7;
/**
 * Metres the drone leans in to get that near, and backs off to get that far, at most. Beside the
 * foot of a wide hull the simulation stands it with its nose over the edge: without room to back
 * off, its arms would splay out sideways to reach spots that lie beside it.
 */
const LONGEST_LEAN = 1.2;
const LONGEST_BACK_OFF = 0.8;
/** How briskly the lean follows the edge, which jumps when the drone's reach moves to another tier of the building. */
const LEAN_RESPONSIVENESS = 6;
/** Where an arm leaves the hull, in metres from the nose: back, out to its side, and down. */
const SHOULDER_BACK = 0.2;
const SHOULDER_OUT = 0.22;
const SHOULDER_DROP = 0.05;
/** Where the tool's tip rests while the arm is folded, in metres from its shoulder: ahead and down. */
const STOWED_AHEAD = 0.1;
const STOWED_DOWN = 0.14;
/**
 * The shares of coming on by which the folded arms have grown out of the hull, by which they have
 * unfolded, and from which the arcs strike. Going out runs the same way back.
 */
const ARMS_GROWN = 0.45;
const ARMS_OUT = 0.75;
const ARCS_LIT = 0.88;
const SPARKS = 6;

const { clamp, lerp, smoothstep } = THREE.MathUtils;
const nose = new THREE.Vector3();
const forward = new THREE.Vector3();
const up = new THREE.Vector3();
const left = new THREE.Vector3();
const shoulder = new THREE.Vector3();
const tip = new THREE.Vector3();
const stowed = new THREE.Vector3();
const spot = new THREE.Vector3();
const pole = new THREE.Vector3();
const velocity = new THREE.Vector3();
/** A stable 0 to 1 number for a seed. */
const chance = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};
/** How far through its current spot arm `arm` (0 the left, 1 the right) is, as a whole number of spots plus a share. */
const turnOf = (time: number, seed: number, arm: number) => time / SPOT_SECONDS + seed * 9 + arm * 0.5;
/** 0 while an arm works its spot, rising to 1 as it swings over to the next. */
const swingOf = (turn: number) => smoothstep(turn - Math.floor(turn), 1 - MOVING, 1);
/**
 * Metres from straight ahead at which an arm starts its spot number `spot`. Near and far spots
 * take turns, so every swing to the next one is a move the player sees.
 */
const startOf = (spot: number, seed: number, arm: number) =>
  lerp(NEAREST_SPOT, FARTHEST_SPOT, (spot & 1) * 0.6 + 0.4 * chance(spot * 3.7 + seed * 31 + arm * 17));
/** The drone itself, which its model group hangs in: it turns and flies, and does not lean. */
const droneOf = (body: THREE.Object3D) => body.parent ?? body;

/**
 * Welding: the drone holds off the edge in front of it and two small arms come out of its hull.
 * Each welds a spot on its own side with a torch, sparks falling, then lifts off and swings over
 * to the next. The arms take turns, so one arc is always burning.
 *
 * `ends` are the two tools' spots as the drone sees them, in its own space and not the world's:
 * a drone sent away takes them along while its arms fold, or the arms would stretch back to the
 * site it is leaving and its lean would grow with the distance.
 */
export const weld: WorkStyle = {
  reach: 2.4,
  fadeSeconds: 0.7,
  aim(tool, site, time) {
    const drone = droneOf(tool.body);
    tool.contact.set(0, 0, 0);
    for (let arm = 0; arm < 2; arm += 1) {
      const turn = turnOf(time, tool.seed, arm);
      const index = Math.floor(turn);
      // The arc is drawn outward along the edge, then the arm swings on to where the next one starts.
      const drawn = startOf(index, tool.seed, arm) + BEAD * Math.min(1, (turn - index) / (1 - MOVING));
      const along = lerp(drawn, startOf(index + 1, tool.seed, arm), swingOf(turn)) * (arm ? -1 : 1);
      tool.contact.addScaledVector(site.workPoint(tool.from, weld.reach, along, tool.ends[arm]!), 0.5);
      drone.worldToLocal(tool.ends[arm]!);
    }
  },
  draw(tool, time, power) {
    const drone = droneOf(tool.body);
    tool.nozzle.getWorldPosition(nose);
    // The model's nose points along its own -x, and its left is its +z.
    const { elements } = tool.nozzle.matrixWorld;
    forward.set(-elements[0]!, -elements[1]!, -elements[2]!).normalize();
    up.set(elements[4]!, elements[5]!, elements[6]!).normalize();
    left.set(elements[8]!, elements[9]!, elements[10]!).normalize();
    // Lean in along the drone's forward until its nose stands off the edge, or back off to
    // there. The lean is eased before it is scaled, so it is back at nothing when the work is.
    spot.lerpVectors(tool.ends[0], tool.ends[1], 0.5).applyMatrix4(drone.matrixWorld).sub(nose);
    const ahead = (spot.x * forward.x + spot.z * forward.z) / (Math.hypot(forward.x, forward.z) || 1);
    const lean = clamp(ahead - STANDOFF, -LONGEST_BACK_OFF, LONGEST_LEAN);
    tool.lean += (lean - tool.lean) * (1 - Math.exp(-LEAN_RESPONSIVENESS * tool.deltaSeconds));
    tool.body.position.z = tool.lean * power;
    tool.nozzle.getWorldPosition(nose);
    // The arms grow out of the hull folded, then unfold onto the edge.
    const size = smoothstep(power, 0, ARMS_GROWN);
    const unfolded = smoothstep(power, ARMS_GROWN * 0.5, ARMS_OUT);
    const lit = smoothstep(power, ARCS_LIT, 1);
    let burning = 0;
    for (let arm = 0; arm < 2; arm += 1) {
      const side = arm ? -1 : 1;
      const turn = turnOf(time, tool.seed, arm);
      const phase = turn - Math.floor(turn);
      shoulder.copy(nose).addScaledVector(forward, -SHOULDER_BACK).addScaledVector(left, side * SHOULDER_OUT)
        .addScaledVector(up, -SHOULDER_DROP);
      spot.copy(tool.ends[arm]!).applyMatrix4(drone.matrixWorld);
      tip.copy(spot);
      tip.y += HOP * Math.sin(Math.PI * swingOf(turn));
      tip.lerpVectors(stowed.copy(shoulder).addScaledVector(forward, STOWED_AHEAD).addScaledVector(up, -STOWED_DOWN), tip, unfolded);
      // Elbows out to the sides and a little up, like a crab's: the camera looks down on the
      // drone, and from behind it an elbow bent straight up would hide the forearm and the torch.
      pole.copy(left).multiplyScalar(side).addScaledVector(up, 0.45);
      tool.arms.reach(shoulder, tip, pole, size);
      // A pilot flame on the torch once it is out, so the tool shows at the default zoom between two arcs.
      tool.glows.add(Glow.Flare, tip, 0.17, 0.7 * smoothstep(power, ARMS_OUT - 0.15, ARMS_OUT), tool.seed * 7 + arm);
      // The arc strikes once the tool is down, burns, and goes out before it lifts. A tool that
      // cannot reach its spot strikes no arc in the air.
      const reached = 1 - smoothstep(tip.distanceTo(spot), 0.03, 0.12);
      const arc = smoothstep(phase, 0.03, 0.09) * (1 - smoothstep(phase, 1 - MOVING - 0.08, 1 - MOVING - 0.02)) * lit * reached;
      if (!arc) continue;
      burning = Math.max(burning, arc);
      tool.glows.add(Glow.Flare, tip, 0.5, arc, tool.seed * 10 + arm * 3);
      for (let spark = 0; spark < SPARKS; spark += 1) {
        const index = spark + arm * 23 + tool.seed * 50;
        // Thrown back toward the drone and to the sides, then they fall.
        velocity.copy(forward).setY(0).normalize().multiplyScalar(-0.4 - 1.4 * chance(index * 9.3));
        velocity.x += (chance(index * 3.1) - 0.5) * 2.2;
        velocity.z += (chance(index * 4.3) - 0.5) * 2.2;
        velocity.y = 1 + 2 * chance(index * 5.7);
        tool.glows.add(Glow.Spark, tip, 0.24, arc, chance(index) * 10, velocity);
      }
    }
    // The hull trembles a little while an arc burns: millimetres, so the arms placed above still meet it.
    tool.body.position.y = Math.sin(time * 43 + tool.seed * 20) * 0.006 * burning;
  },
};
