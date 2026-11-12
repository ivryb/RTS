import { beforeAll, expect, test } from "bun:test";
import { generateMap } from "../src/map";
import { createCombatProofEncounter } from "../src/combatProofEncounter";
import { initializeNavigation } from "../src/sim/navigation";
import { createTrainedUnitState } from "../src/sim/production";
import { LocalUnitSimulation, toSimPoint, type BuildingState } from "../src/sim/units";

beforeAll(() => initializeNavigation());

test("the opening Scout can mine and deliver on the real six-player map", () => {
  const map = generateMap(77, 6);
  const encounter = createCombatProofEncounter(map);
  const spawn = encounter.units.find(unit => unit.kind === "scout-drone")!;
  const scout = createTrainedUnitState({
    id: spawn.id, kind: spawn.kind, ownerId: spawn.ownerId,
    position: toSimPoint(spawn.x, spawn.z), facing: spawn.facing ?? 0,
  });
  const buildings: BuildingState[] = encounter.buildings.map(building => ({
    id: building.id, kind: building.kind, ownerId: building.ownerId,
    position: toSimPoint(building.x, building.z), radius: building.radius * 1000,
    rotation: building.rotation, health: building.health, maxHealth: building.health,
    lifecycle: "active", constructionProgress: 1,
  }));
  const home = buildings.find(building => building.ownerId === spawn.ownerId)!;
  const ore = [...map.titaniumDeposits].sort((a, b) =>
    Math.hypot(a.position.x - home.position.x, a.position.z - home.position.z)
    - Math.hypot(b.position.x - home.position.x, b.position.z - home.position.z))[0]!;
  expect(Math.hypot(ore.position.x - home.position.x, ore.position.z - home.position.z)).toBeLessThanOrEqual(37001);
  const simulation = new LocalUnitSimulation([scout], buildings, map, { titaniumDeposits: map.titaniumDeposits });
  const solidProps = [
    ...map.environment.features.trees.map(tree => ({ ...tree, radius: tree.size * .03 })),
    ...map.environment.features.rubble.filter(rock => rock.size > 1.5).map(rock => ({ ...rock, radius: rock.size * .5 })),
  ];
  try {
    expect(simulation.dispatch(spawn.ownerId, {
      type: "gather", unitIds: [scout.id], depositId: ore.id,
    }).accepted).toBe(true);
    const phases = new Set<string>();
    for (let tick = 0; tick < 500 && (simulation.titaniumSnapshot()[spawn.ownerId] ?? 0) < 40; tick += 1) {
      simulation.step();
      const worker = simulation.snapshot()[0]!;
      if (worker.harvest) phases.add(worker.harvest.phase);
      for (const deposit of map.titaniumDeposits) {
        expect(Math.hypot(worker.position.x - deposit.position.x, worker.position.z - deposit.position.z))
          .toBeGreaterThanOrEqual(deposit.radius + worker.radius - 2);
      }
      for (const prop of solidProps) {
        expect(Math.hypot(worker.position.x - prop.x * 1000, worker.position.z - prop.z * 1000))
          .toBeGreaterThanOrEqual(prop.radius * 1000 + worker.radius - 2);
      }
    }
    expect(phases).toEqual(new Set(["to-deposit", "extracting", "to-dropoff"]));
    expect(simulation.titaniumSnapshot()[spawn.ownerId]).toBe(40);
    expect(simulation.depositSnapshot().find(deposit => deposit.id === ore.id)!.amount).toBe(ore.amount - 40);
    expect(simulation.snapshot()[0]!.cargoTitanium).toBe(0);
  } finally {
    simulation.dispose();
  }
}, 30000);
