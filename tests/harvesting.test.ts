import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { initializeNavigation } from "../src/sim/navigation";
import { SCOUT_TITANIUM_CAPACITY, type TitaniumDepositState } from "../src/sim/harvesting";
import { createTrainedUnitState } from "../src/sim/production";
import {
  LocalUnitSimulation,
  toSimPoint,
  type BuildingState,
  type PlayerCommand,
  type UnitState,
} from "../src/sim/units";
import type { ConstructionTerrain } from "../src/sim/construction";

const scout = (id = "scout", x = 8, z = 0) => createTrainedUnitState({
  id, kind: "scout-drone", ownerId: "player", position: toSimPoint(x, z), facing: 0,
});
const center = (id = "center", x = 25, z = 0): BuildingState => ({
  id, kind: "command-center", ownerId: "player", lifecycle: "active", constructionProgress: 1,
  position: toSimPoint(x, z), radius: 5580, rotation: 0, health: 2500, maxHealth: 2500,
});
const ore = (amount = 47, x = 0, z = 0): TitaniumDepositState => ({
  id: "ore", position: toSimPoint(x, z), radius: 3000, amount, initialAmount: amount,
});
const simulations: LocalUnitSimulation[] = [];
const simulation = (
  units: UnitState[] = [scout()],
  buildings: BuildingState[] = [center()],
  deposit = ore(),
  terrain?: ConstructionTerrain,
) => {
  const result = new LocalUnitSimulation(units, buildings, terrain, { titaniumDeposits: [deposit] });
  simulations.push(result);
  return result;
};
const worker = (sim: LocalUnitSimulation, id = "scout") => sim.snapshot().find((unit) => unit.id === id)!;
const gather = (sim: LocalUnitSimulation, unitIds = ["scout"]) => sim.dispatch("player", {
  type: "gather", unitIds, depositId: "ore",
});
const until = (sim: LocalUnitSimulation, condition: () => boolean, limit = 1000) => {
  for (let tick = 0; tick < limit && !condition(); tick += 1) sim.step();
  expect(condition()).toBe(true);
};
const conserved = (sim: LocalUnitSimulation) => sim.depositSnapshot()[0]!.amount
  + sim.snapshot().reduce((sum, unit) => sum + (unit.cargoTitanium ?? 0), 0)
  + Object.values(sim.titaniumSnapshot()).reduce((sum, amount) => sum + amount, 0);

beforeAll(() => initializeNavigation());
afterEach(() => { for (const sim of simulations.splice(0)) sim.dispose(); });

describe("Scout titanium harvesting", () => {
  test("physically gathers, hauls, credits on arrival, and repeats with the final partial load", () => {
    const sim = simulation();
    expect(gather(sim).accepted).toBe(true);
    until(sim, () => worker(sim).harvest?.phase === "to-dropoff");
    expect(worker(sim).cargoTitanium).toBe(SCOUT_TITANIUM_CAPACITY);
    expect(sim.titaniumSnapshot().player ?? 0).toBe(0);
    expect(sim.depositSnapshot()[0]!.amount).toBe(27);
    expect(worker(sim).moving).toBe(true);
    until(sim, () => (sim.titaniumSnapshot().player ?? 0) === 20);
    expect(worker(sim).harvest?.phase).toBe("to-deposit");
    until(sim, () => worker(sim).order === "idle");
    expect(sim.titaniumSnapshot().player).toBe(47);
    expect(sim.depositSnapshot()[0]!.amount).toBe(0);
    expect(worker(sim).cargoTitanium).toBe(0);
    expect(gather(sim).accepted).toBe(false);
    expect(conserved(sim)).toBe(47);
  });

  test("three Scouts share finite ore without overlapping work slots or creating titanium", () => {
    const sim = simulation([scout("a", 8, -2), scout("b"), scout("c", 8, 2)], [center()], ore(73));
    expect(gather(sim, ["c", "a", "b", "a"]).accepted).toBe(true);
    for (let tick = 0; tick < 500 && (sim.titaniumSnapshot().player ?? 0) < 73; tick += 1) {
      sim.step();
      expect(conserved(sim)).toBe(73);
      expect(sim.depositSnapshot()[0]!.amount).toBeGreaterThanOrEqual(0);
      for (const unit of sim.snapshot()) {
        expect(unit.cargoTitanium ?? 0).toBeLessThanOrEqual(20);
        expect(Math.hypot(unit.position.x, unit.position.z)).toBeGreaterThanOrEqual(3306);
      }
    }
    expect(sim.titaniumSnapshot().player).toBe(73);
    expect(sim.snapshot().every((unit) => unit.order === "idle")).toBe(true);
  });

  test("ignores hostile and unfinished centers, and chooses a newly completed nearer center next trip", () => {
    const sim = simulation([scout()], [
      center("far", 35),
      { ...center("enemy", 0, -12), ownerId: "enemy" },
      { ...center("unfinished", 0, 12), lifecycle: "constructing", constructionProgress: 0.2 },
    ], ore(45));
    gather(sim);
    until(sim, () => worker(sim).harvest?.phase === "to-dropoff");
    expect(worker(sim).harvest).toMatchObject({ dropoffId: "far" });
    expect(sim.createBuilding(center("new", -12))).toBe(true);
    until(sim, () => (sim.titaniumSnapshot().player ?? 0) === 20);
    until(sim, () => worker(sim).harvest?.phase === "to-dropoff");
    expect(worker(sim).harvest).toMatchObject({ dropoffId: "new" });
    until(sim, () => (sim.titaniumSnapshot().player ?? 0) === 45);
  });

  test("reroutes cargo when its center is destroyed", () => {
    const attacker = { ...scout("attacker", 25, -10), kind: "ghostrunner" as const,
      ownerId: "enemy", attackDamage: 2500, attackRange: 20000, attackIntervalTicks: 1 };
    const sim = simulation([scout(), attacker], [center("near"), center("fallback", -35)]);
    gather(sim);
    until(sim, () => worker(sim).harvest?.phase === "to-dropoff");
    expect(worker(sim).harvest).toMatchObject({ dropoffId: "near" });
    sim.dispatch("enemy", { type: "attack", unitIds: [attacker.id], targetId: "near" });
    until(sim, () => !sim.buildingSnapshot().some((building) => building.id === "near"));
    expect(worker(sim).cargoTitanium).toBe(20);
    expect(worker(sim).harvest).toMatchObject({ phase: "to-dropoff", dropoffId: "fallback" });
    until(sim, () => (sim.titaniumSnapshot().player ?? 0) >= 20);
  });

  test.each(["stop", "move", "build"] as const)("%s cancels harvesting but preserves cargo for a later gather order", (type) => {
    const sim = simulation();
    gather(sim);
    until(sim, () => (worker(sim).cargoTitanium ?? 0) >= 6);
    const cargo = worker(sim).cargoTitanium;
    const command: PlayerCommand = type === "stop" ? { type, unitIds: ["scout"] }
      : type === "move" ? { type, unitIds: ["scout"], target: toSimPoint(10, 10) }
      : { type, unitIds: ["scout"], kind: "turret", target: toSimPoint(15, 15), rotation: 0 };
    expect(sim.dispatch("player", command).accepted).toBe(true);
    for (let tick = 0; tick < 10; tick += 1) sim.step();
    expect(worker(sim).harvest).toBeUndefined();
    expect(worker(sim).cargoTitanium).toBe(cargo);
    expect(sim.titaniumSnapshot().player ?? 0).toBe(0);
    gather(sim);
    expect(worker(sim).harvest?.phase).toBe("to-dropoff");
    until(sim, () => (sim.titaniumSnapshot().player ?? 0) === cargo);
    expect(conserved(sim)).toBe(47);
  });

  test("holds cargo without a completed center and resumes when construction finishes", () => {
    const builder = scout("builder", 25, 7);
    const sim = simulation([scout(), builder], [], ore(21));
    gather(sim);
    until(sim, () => worker(sim).harvest?.phase === "waiting-dropoff");
    for (let tick = 0; tick < 20; tick += 1) sim.step();
    expect(worker(sim).cargoTitanium).toBe(20);
    expect(sim.titaniumSnapshot().player ?? 0).toBe(0);
    sim.createBuilding({ ...center(), lifecycle: "constructing", constructionProgress: 598 / 600 });
    for (let tick = 0; tick < 10; tick += 1) sim.step();
    expect(worker(sim).harvest?.phase).toBe("waiting-dropoff");
    expect(sim.dispatch("player", { type: "resume-construction", unitIds: [builder.id], buildingId: "center" }).accepted).toBe(true);
    until(sim, () => sim.buildingSnapshot()[0]!.lifecycle === "active");
    until(sim, () => (sim.titaniumSnapshot().player ?? 0) === 21);
  });

  test("rejects hostile/non-Scout orders and loses the cargo of a killed Scout", () => {
    const attacker = { ...scout("attacker", 8, -5), kind: "ghostrunner" as const,
      ownerId: "enemy", attackDamage: 1000, attackRange: 20000, attackIntervalTicks: 1 };
    const sim = simulation([scout(), attacker]);
    expect(sim.dispatch("enemy", { type: "gather", unitIds: ["scout"], depositId: "ore" }).accepted).toBe(false);
    expect(sim.dispatch("enemy", { type: "gather", unitIds: ["attacker"], depositId: "ore" }).accepted).toBe(false);
    expect(sim.dispatch("player", { type: "gather", unitIds: ["scout"], depositId: "absent" }).accepted).toBe(false);
    gather(sim);
    until(sim, () => (worker(sim).cargoTitanium ?? 0) >= 6);
    const remaining = sim.depositSnapshot()[0]!.amount;
    sim.dispatch("enemy", { type: "attack", unitIds: ["attacker"], targetId: "scout" });
    until(sim, () => worker(sim).health === 0);
    expect(worker(sim).cargoTitanium).toBe(0);
    expect(worker(sim).harvest).toBeUndefined();
    expect(sim.titaniumSnapshot().player ?? 0).toBe(0);
    expect(sim.depositSnapshot()[0]!.amount).toBeLessThanOrEqual(remaining);
  });

  test("depleted deposits still prevent construction and movement across their footprint", () => {
    const sim = simulation([scout("scout", -8)], [], ore(0));
    expect(sim.dispatch("player", { type: "build", unitIds: ["scout"], kind: "turret", target: toSimPoint(0, 0), rotation: 0 }).accepted).toBe(false);
    expect(sim.dispatch("player", { type: "move", unitIds: ["scout"], target: toSimPoint(8, 0) }).accepted).toBe(true);
    for (let tick = 0; tick < 50; tick += 1) {
      sim.step();
      const position = worker(sim).position;
      expect(Math.hypot(position.x, position.z)).toBeGreaterThanOrEqual(3306);
    }
    expect(worker(sim).position).toEqual(toSimPoint(8, 0));
  });

  test("selects a farther reachable center over a closer center across blocked mountain terrain", () => {
    const size = 80;
    const segments = 160;
    const row = segments + 1;
    const heights = new Float32Array(row * row);
    const mountainMask = new Float32Array(row * row);
    for (let z = 0; z <= segments; z += 1) {
      for (let x = 0; x <= segments; x += 1) {
        const worldX = x / segments * size - size / 2;
        if (Math.abs(worldX) < 2) { heights[z * row + x] = 8; mountainMask[z * row + x] = 1; }
      }
    }
    const sim = simulation([scout("scout", -12, 0)], [center("unreachable", 10), center("reachable", -15, 27)], ore(23, -8), { size, segments, heights, mountainMask });
    gather(sim);
    until(sim, () => worker(sim).harvest?.phase === "to-dropoff");
    expect(worker(sim).harvest).toMatchObject({ dropoffId: "reachable" });
    until(sim, () => (sim.titaniumSnapshot().player ?? 0) === 23);
    expect(worker(sim).position.x).toBeLessThan(-2000);
  });

  test("compares route length rather than straight-line distance when both centers are reachable", () => {
    const size = 80;
    const segments = 160;
    const row = segments + 1;
    const heights = new Float32Array(row * row);
    const mountainMask = new Float32Array(row * row);
    for (let z = 0; z <= segments; z += 1) {
      for (let x = 0; x <= segments; x += 1) {
        const worldX = x / segments * size - size / 2;
        const worldZ = z / segments * size - size / 2;
        if (Math.abs(worldX) < 2 && worldZ > -28) {
          heights[z * row + x] = 8;
          mountainMask[z * row + x] = 1;
        }
      }
    }
    const terrain = { size, segments, heights, mountainMask };
    const near = center("near-across-wall", 10);
    const farther = center("farther-same-side", -15, 27);
    const sim = simulation([scout("scout", -12)], [near, farther], ore(21, -8), terrain);
    gather(sim);
    until(sim, () => worker(sim).harvest?.phase === "to-dropoff");
    expect(worker(sim).harvest).toMatchObject({ dropoffId: farther.id });
    // A second worker with only the other center proves the wall has a usable route around its end.
    const acrossWall = simulation([scout("scout", -12)], [near], ore(1, -8), terrain);
    gather(acrossWall);
    until(acrossWall, () => (acrossWall.titaniumSnapshot().player ?? 0) === 1);
    expect(worker(acrossWall).position.x).toBeGreaterThan(2000);
  });

  test("replays harvesting deterministically, including deposit and stockpile state", () => {
    const first = simulation();
    const second = simulation();
    gather(first); gather(second);
    for (let tick = 0; tick < 250; tick += 1) {
      first.step(); second.step();
      expect(first.stateHash()).toBe(second.stateHash());
    }
    expect(first.titaniumSnapshot().player).toBe(47);
    expect(first.stateHash()).not.toBe(simulation([scout()], [center()], ore(48)).stateHash());
  });
});
