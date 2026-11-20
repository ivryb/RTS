import type * as THREE from "three";
import type { ConstructionSite } from "../../constructionSites";
import type { GlowList } from "../glowEffects";
import type { ScoutArms } from "../scoutArms";

/** What a way of working has to work with: one building drone, for one frame. */
export interface Tool {
  /** Where the drone stands on the ground. */
  from: THREE.Vector3;
  /** The drone's model group, for a lunge or a tremble: its own +z is the drone's forward, +y is up. */
  body: THREE.Object3D;
  /** Where the tool head ends, in the world, read after `body` was moved. */
  nozzle: THREE.Object3D;
  /** The point on the site the drone works at and looks at, in the world. `aim` sets it. */
  contact: THREE.Vector3;
  /** Two spare points for a style to keep between `aim` and `draw`, in whatever space it likes. */
  ends: readonly [THREE.Vector3, THREE.Vector3];
  /** Metres the style wants `body` leant in. It is 0 when the work starts, and the style's to ease. */
  lean: number;
  /** Seconds since the drone's last frame. */
  deltaSeconds: number;
  /** A number from 0 to 1 that differs from drone to drone. */
  seed: number;
  /** Sparks, arcs, dust and smoke: cleared before every `draw`. */
  glows: GlowList;
  /** The small jointed arms a drone can work with: `reach` draws one for this frame. */
  arms: ScoutArms;
}

/**
 * One way a Scout Drone can look while it works on a site. The game builds with `weld`. The
 * other styles in this folder are kept for other uses (Ivan, D77-13: the scanner for something
 * else, the hammering perhaps for an attack). Nothing in the game uses them, and the
 * construction preview shows each with `?work=`.
 */
export interface WorkStyle {
  /**
   * Metres along the ground from which the drone reaches the edge it works on. The drone hovers
   * level with the highest edge it reaches. A laser reaches the whole deck: Infinity.
   */
  reach: number;
  /** Seconds the work takes to come on and to go out. */
  fadeSeconds: number;
  /** Sets `tool.contact`, and `tool.ends` if the style uses them, for `time`. */
  aim(tool: Tool, site: ConstructionSite, time: number): void;
  /**
   * Poses `tool.body` and draws one frame of work at `power`, 0 to 1, from what `aim` last set.
   * It runs without `aim` while the work fades out after the drone stops.
   */
  draw(tool: Tool, time: number, power: number): void;
}
