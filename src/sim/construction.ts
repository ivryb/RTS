import { sampleHeight, type TerrainSurface } from "../map";
import { CellFlag, intersects, type PlacementGrid } from "../placement";
import type { BuildingKind, BuildingState, SimPoint, UnitState } from "./units";
import { POSITION_SCALE, SIMULATION_TICK_SECONDS } from "./simulationConstants";

export interface BuildingDefinition {
  maxHealth: number;
  radius: number;
  attackRadius: number;
  constructionSeconds: number;
  weapon?: {
    range: number;
    damage: number;
    intervalSeconds: number;
  };
}

export const BUILDING_DEFINITIONS: Record<BuildingKind, BuildingDefinition> = {
  "command-center": {
    maxHealth: 2_500,
    radius: 5.58,
    attackRadius: 5,
    constructionSeconds: 60,
  },
  turret: {
    maxHealth: 900,
    radius: 1.8,
    attackRadius: 1.5,
    constructionSeconds: 10,
    weapon: {
      range: 12,
      damage: 25,
      intervalSeconds: 1,
    },
  },
};

export interface ConstructionTerrain extends TerrainSurface {
  placement?: PlacementGrid;
}

export const constructionTicks = (kind: BuildingKind) => Math.round(
  BUILDING_DEFINITIONS[kind].constructionSeconds / SIMULATION_TICK_SECONDS,
);

const distance = (first: SimPoint, second: SimPoint) => Math.hypot(
  first.x - second.x,
  first.z - second.z,
);

const terrainVariation = (terrain: TerrainSurface, position: SimPoint, radius: number) => {
  const x = position.x / POSITION_SCALE;
  const z = position.z / POSITION_SCALE;
  const heights = [sampleHeight(terrain, x, z)];
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2;
    heights.push(sampleHeight(
      terrain,
      x + Math.cos(angle) * radius,
      z + Math.sin(angle) * radius,
    ));
  }
  return Math.max(...heights) - Math.min(...heights);
};

/** Shared preview rule; the simulation remains authoritative and repeats this validation. */
export const constructionPlacementIsValid = (
  terrain: ConstructionTerrain | undefined,
  kind: BuildingKind,
  position: SimPoint,
  buildings: readonly Pick<BuildingState, "position" | "radius" | "health">[],
  units: readonly Pick<UnitState, "position" | "radius" | "health">[],
) => {
  const definition: BuildingDefinition | undefined = (
    BUILDING_DEFINITIONS as Partial<Record<string, BuildingDefinition>>
  )[kind];
  if (!definition || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return false;
  const radius = definition.radius * POSITION_SCALE;
  if (terrain) {
    const x = position.x / POSITION_SCALE;
    const z = position.z / POSITION_SCALE;
    if (Math.abs(x) + definition.radius > terrain.size / 2
      || Math.abs(z) + definition.radius > terrain.size / 2
      || terrainVariation(terrain, position, definition.radius) > 0.75) return false;
    if (terrain.placement && intersects(
      terrain.placement,
      x,
      z,
      definition.radius,
      CellFlag.Palm | CellFlag.Reserved,
    )) return false;
  }
  if (buildings.some((building) => building.health > 0
    && distance(building.position, position) < building.radius + radius)) return false;
  return !units.some((unit) => unit.health > 0
    && distance(unit.position, position) < unit.radius + radius);
};
