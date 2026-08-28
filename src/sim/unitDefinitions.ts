export type UnitKind = "ghostrunner" | "scout-drone" | "behemoth" | "hornet";

export interface UnitDefinition {
  maxHealth: number;
  radius: number;
  speed: number;
  movement: "ground" | "air";
  attack: "none" | "direct" | "ground";
  attackMinRange?: number;
  attackRange?: number;
  attackGroundRadius?: number;
  attackDamage?: number;
  attackInterval?: number;
}

export const UNIT_DEFINITIONS: Record<UnitKind, UnitDefinition> = {
  ghostrunner: {
    maxHealth: 140,
    radius: 0.45,
    speed: 9,
    movement: "ground",
    attack: "direct",
    attackDamage: 20,
    attackInterval: 1.1,
  },
  "scout-drone": {
    maxHealth: 45,
    radius: 0.306,
    speed: 10,
    movement: "air",
    attack: "none",
  },
  behemoth: {
    maxHealth: 900,
    radius: 1.5243228,
    speed: 5,
    movement: "ground",
    attack: "ground",
    attackMinRange: 7,
    attackRange: 22,
    attackGroundRadius: 4,
    attackDamage: 140,
    attackInterval: 2,
  },
  hornet: {
    maxHealth: 180,
    radius: 1.309,
    speed: 8.5,
    movement: "air",
    attack: "direct",
    attackRange: 14,
    attackDamage: 30,
    attackInterval: 0.8,
  },
};
