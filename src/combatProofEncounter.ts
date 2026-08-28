import type { GeneratedMap } from "./map";
import { BUILDING_CATALOG } from "./buildingCatalog";
import { BUILDING_DEFINITIONS } from "./sim/construction";
import { UNIT_DEFINITIONS, type UnitKind } from "./sim/unitDefinitions";
import type { UnitSpawn, WorldBuilding } from "./unitSystem";

export interface CombatProofEncounter {
  focus: { x: number; z: number };
  units: UnitSpawn[];
  buildings: WorldBuilding[];
}

const pointAt = (
  origin: { x: number; z: number },
  forward: { x: number; z: number },
  side: number,
  distance: number,
) => ({
  x: origin.x + forward.x * distance - forward.z * side,
  z: origin.z + forward.z * distance + forward.x * side,
});

const buildingAt = (
  id: string,
  kind: WorldBuilding["kind"],
  ownerId: string,
  position: { x: number; z: number },
  rotation: number,
): WorldBuilding => {
  const definition = BUILDING_DEFINITIONS[kind];
  return {
    id,
    kind,
    ownerId,
    ...position,
    rotation,
    radius: definition.radius,
    attackRadius: definition.attackRadius,
    health: definition.maxHealth,
  };
};

const unitAt = (
  id: string,
  kind: UnitKind,
  ownerId: string,
  position: { x: number; z: number },
  facing: number,
  guardMode?: UnitSpawn["guardMode"],
): UnitSpawn => ({
  id,
  kind,
  ownerId,
  ...position,
  facing,
  guardMode,
  pushable: guardMode ? false : kind !== "behemoth",
  health: UNIT_DEFINITIONS[kind].maxHealth,
  ...UNIT_DEFINITIONS[kind],
});

/** Deterministic local proof: a small player opening faces one fortified, non-producing base. */
export const createCombatProofEncounter = (map: GeneratedMap): CombatProofEncounter => {
  const player = map.startingLocations[0]!;
  const enemy = map.startingLocations[1]!;
  const deltaX = enemy.x - player.x;
  const deltaZ = enemy.z - player.z;
  const length = Math.hypot(deltaX, deltaZ) || 1;
  const towardEnemy = { x: deltaX / length, z: deltaZ / length };
  const towardPlayer = { x: -towardEnemy.x, z: -towardEnemy.z };
  const playerFacing = Math.atan2(towardEnemy.x, towardEnemy.z);
  const enemyFacing = Math.atan2(towardPlayer.x, towardPlayer.z);
  const commandCenterRotation = BUILDING_CATALOG["command-center"].defaultRotation;

  return {
    focus: { ...player },
    buildings: [
      buildingAt(
        "local-command-center",
        "command-center",
        "local-player",
        player,
        commandCenterRotation,
      ),
      buildingAt(
        "enemy-command-center",
        "command-center",
        "enemy-player",
        enemy,
        commandCenterRotation,
      ),
      buildingAt(
        "enemy-turret-left",
        "turret",
        "enemy-player",
        pointAt(enemy, towardPlayer, -5, 9),
        enemyFacing,
      ),
      buildingAt(
        "enemy-turret-right",
        "turret",
        "enemy-player",
        pointAt(enemy, towardPlayer, 5, 9),
        enemyFacing,
      ),
    ],
    units: [
      ...[-1.2, 0, 1.2].map((side, index) => unitAt(
        `ghostrunner-${index + 1}`,
        "ghostrunner",
        "local-player",
        pointAt(player, towardEnemy, side, 7),
        playerFacing,
      )),
      ...[-2, 2].map((side, index) => unitAt(
        `enemy-ghostrunner-${index + 1}`,
        "ghostrunner",
        "enemy-player",
        pointAt(enemy, towardPlayer, side, 14),
        enemyFacing,
        "hold-position",
      )),
      unitAt(
        "enemy-hornet-1",
        "hornet",
        "enemy-player",
        pointAt(enemy, towardPlayer, 0, 8.5),
        enemyFacing,
        "hold-position",
      ),
    ],
  };
};
