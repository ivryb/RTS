import {
  UNIT_DEFINITIONS,
  type UnitDefinition,
  type UnitKind,
} from "./sim/unitDefinitions";

export type { UnitKind } from "./sim/unitDefinitions";

export interface UnitPresentationDefinition extends UnitDefinition {
  name: string;
  portrait: string;
}

export const UNIT_CATALOG: Record<UnitKind, UnitPresentationDefinition> = {
  ghostrunner: {
    ...UNIT_DEFINITIONS.ghostrunner,
    name: "Ghostrunner",
    portrait: new URL("../assets/ui/ghostrunner-portrait.webp", import.meta.url).href,
  },
  "scout-drone": {
    ...UNIT_DEFINITIONS["scout-drone"],
    name: "Scout Drone",
    portrait: new URL("../assets/ui/scout-drone-portrait.webp", import.meta.url).href,
  },
  behemoth: {
    ...UNIT_DEFINITIONS.behemoth,
    name: "Behemoth",
    portrait: new URL("../assets/ui/behemoth-portrait.webp", import.meta.url).href,
  },
  hornet: {
    ...UNIT_DEFINITIONS.hornet,
    name: "Hornet",
    portrait: new URL("../assets/ui/hornet-portrait.webp", import.meta.url).href,
  },
};
