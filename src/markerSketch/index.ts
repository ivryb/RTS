import type * as THREE from "three";
import type { BuildingKind } from "../sim/units";
import { optionA } from "./optionA";
import { optionB } from "./optionB";
import { optionC } from "./optionC";
import { optionD } from "./optionD";

/**
 * D77-16 design sketch: swaps every ground marker for one option, chosen with `?markers=a|b|c|d`.
 * Without the parameter the game keeps today's markers. Not for shipping.
 */
export type MarkerTarget = "unit" | "building" | "deposit";

export interface SelectionRequest {
  /** World radius of the thing selected: a unit's body, a building's or deposit's footprint. */
  radius: number;
  /** Today's colour: off-white for the local player and resources, red for the enemy. */
  color: number;
  target: MarkerTarget;
  /** Only for the local player's units and buildings. */
  friendly: boolean;
}

export interface PlacementState {
  kind: BuildingKind;
  /** Ground height under the cursor; the marker's group already sits at x, z. */
  groundY: number;
  /** The building's real footprint radius, the disc the placement rules test. */
  radius: number;
  valid: boolean;
}

export interface PlacementMarker {
  object: THREE.Group;
  show(state: PlacementState): void;
}

export interface MarkerOption {
  /**
   * A flat mesh around the origin at y = 0, hidden. The game re-anchors its geometry to the ground
   * with `placeGroundGeometry`, so keep every vertex at y = 0 and draw in the material.
   */
  selection(request: SelectionRequest): THREE.Mesh;
  /** `ghost` resolves to a fresh clone of the building's model whose materials the option may replace. */
  placement(ghost: (kind: BuildingKind) => Promise<THREE.Object3D>): PlacementMarker;
}

const options: Record<string, MarkerOption> = { a: optionA, b: optionB, c: optionC, d: optionD };

// Read at import: loading the map rewrites the URL to `?seed=N`.
const chosen = new URLSearchParams(globalThis.location?.search ?? "").get("markers") ?? "";

export const markerOption = (): MarkerOption | undefined => options[chosen];
