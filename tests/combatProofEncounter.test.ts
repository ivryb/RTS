import { describe, expect, test } from "bun:test";
import { createCombatProofEncounter } from "../src/combatProofEncounter";
import { generateMap } from "../src/map";
import { constructionPlacementIsValid } from "../src/sim/construction";
import { toSimPoint } from "../src/sim/units";

describe("combat proof encounter", () => {
  test("places the enemy on the nearby expansion in the six-player map", () => {
    const map = generateMap(77, 6);
    const encounter = createCombatProofEncounter(map);

    expect(map.layout.playerCount).toBe(6);

    expect(encounter.buildings.map(({ id, kind, ownerId }) => ({ id, kind, ownerId }))).toEqual([
      { id: "local-command-center", kind: "command-center", ownerId: "local-player" },
      { id: "enemy-command-center", kind: "command-center", ownerId: "enemy-player" },
      { id: "enemy-turret-left", kind: "turret", ownerId: "enemy-player" },
      { id: "enemy-turret-right", kind: "turret", ownerId: "enemy-player" },
    ]);
    expect(encounter.units.map(({ kind, ownerId, guardMode }) => ({
      kind,
      ownerId,
      guardMode,
    }))).toEqual([
      { kind: "ghostrunner", ownerId: "local-player", guardMode: undefined },
      { kind: "ghostrunner", ownerId: "local-player", guardMode: undefined },
      { kind: "ghostrunner", ownerId: "local-player", guardMode: undefined },
      { kind: "ghostrunner", ownerId: "enemy-player", guardMode: "hold-position" },
      { kind: "ghostrunner", ownerId: "enemy-player", guardMode: "hold-position" },
      { kind: "hornet", ownerId: "enemy-player", guardMode: "hold-position" },
    ]);
    expect(encounter.focus).toEqual(map.startingLocations[0]);
    const playerCenter = encounter.buildings.find(({ id }) => id === "local-command-center")!;
    const enemyCenter = encounter.buildings.find(({ id }) => id === "enemy-command-center")!;
    expect(playerCenter.rotation).toBe(Math.PI / 4);
    expect(enemyCenter.rotation).toBe(Math.PI / 4);
    const nearestExpansion=map.layout.sites.filter(site=>site.role==='expansion')
      .sort((a,b)=>Math.hypot(a.x-playerCenter.x,a.z-playerCenter.z)-Math.hypot(b.x-playerCenter.x,b.z-playerCenter.z))[0];
    expect({x:enemyCenter.x,z:enemyCenter.z}).toEqual({x:nearestExpansion.x,z:nearestExpansion.z});
    expect(map.startingLocations).not.toContainEqual({ x: enemyCenter.x, z: enemyCenter.z });

    for (const entity of [...encounter.buildings, ...encounter.units]) {
      expect(Math.abs(entity.x) + entity.radius).toBeLessThan(map.size / 2);
      expect(Math.abs(entity.z) + entity.radius).toBeLessThan(map.size / 2);
    }
    for (const unit of encounter.units) {
      for (const building of encounter.buildings) {
        expect(Math.hypot(unit.x - building.x, unit.z - building.z))
          .toBeGreaterThanOrEqual(unit.radius + building.radius);
      }
    }
  }, 30000);

  test("keeps both initial bases on valid terrain across deterministic maps", () => {
    for (const seed of [1, 7, 77, 777]) {
      const map = generateMap(seed, 6);
      const encounter = createCombatProofEncounter(map);
      const buildings = encounter.buildings.map((building) => ({
        position: toSimPoint(building.x, building.z),
        radius: building.radius * 1_000,
        health: building.health,
      }));
      const units = encounter.units.map((unit) => ({
        position: toSimPoint(unit.x, unit.z),
        radius: unit.radius * 1_000,
        health: unit.health,
      }));

      encounter.buildings.forEach((building, index) => {
        expect(constructionPlacementIsValid(
          map,
          building.kind,
          toSimPoint(building.x, building.z),
          buildings.filter((_, otherIndex) => otherIndex !== index),
          units,
        )).toBe(true);
      });
    }
  }, 30_000);
});
