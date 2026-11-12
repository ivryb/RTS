import type * as THREE from "three";
import type { GeneratedMap } from "../../src/map";
import type { BuildingKind } from "../../src/sim/units";

/** Everything the presentation knows about one site on one frame. */
export interface SiteState {
  /** Construction progress from the simulation, 0 to 1. */
  progress: number;
  /** True while at least one Scout Drone is beaming the site. */
  working: boolean;
  /** Remaining health as a fraction, 0 to 1. A site can be shot before it completes. */
  health: number;
  lifecycle: "constructing" | "active" | "destroyed";
  /** Seconds since the lifecycle became `active` or `destroyed`; 0 while constructing. */
  sinceLifecycleChange: number;
}

export interface SiteModel {
  kind: BuildingKind;
  /** Placed on the terrain and rotated like `UnitSystem`'s building root. */
  root: THREE.Group;
  /** Holds the loaded production model, like `UnitSystem`'s "Building visual" group. */
  visualRoot: THREE.Group;
}

export interface SketchContext {
  scene: THREE.Scene;
  map: GeneratedMap;
  renderer: THREE.WebGLRenderer;
}

export interface ConstructionSite {
  /**
   * Sets every visual from `state` and `time` alone. The harness calls it several times per
   * rendered image with different states (one per panel), so it must not accumulate anything
   * between calls: derive sparks, pulses and flicker from `time`, not from a running total.
   */
  update(state: SiteState, time: number): void;
  /** World height the Scout Drone beam should end at; the harness uses ground + 0.8 without it. */
  beamTargetY?: number;
  /** World point the beam should end at instead, for looks whose work moves around the site. */
  beamTarget?: THREE.Vector3;
  dispose(): void;
}

export interface ConstructionSketch {
  /** Shown in capture labels. */
  title: string;
  /** One-time shared setup: load a kit model, build shared materials. */
  prepare?(context: SketchContext): Promise<void> | void;
  createSite(model: SiteModel, context: SketchContext): ConstructionSite;
  /** Runs once after every site's `update` and before the render, for shared instanced buffers. */
  flush?(time: number): void;
}
