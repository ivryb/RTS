import type { BuildingKind } from "./sim/units";

export interface BuildingPresentationDefinition {
  name: string;
  portrait: string;
  defaultRotation: number;
}

export const BUILDING_CATALOG: Record<BuildingKind, BuildingPresentationDefinition> = {
  "command-center": { name: "Command Center", portrait: new URL("../assets/ui/command-center-portrait.webp", import.meta.url).href, defaultRotation: Math.PI / 4 },
  turret: { name: "Turret", portrait: new URL("../assets/ui/turret-portrait.webp", import.meta.url).href, defaultRotation: 0 },
};
