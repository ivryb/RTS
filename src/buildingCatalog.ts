import type { BuildingKind } from "./sim/units";

export interface BuildingPresentationDefinition {
  name: string;
  defaultRotation: number;
}

export const BUILDING_CATALOG: Record<BuildingKind, BuildingPresentationDefinition> = {
  "command-center": { name: "Command Center", defaultRotation: Math.PI / 4 },
  turret: { name: "Turret", defaultRotation: 0 },
};
