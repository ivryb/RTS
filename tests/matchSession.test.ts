import { beforeAll, describe, expect, test } from "bun:test";
import { LocalMatchSession, RemoteMatchSession } from "../src/matchSession";
import { initializeNavigation } from "../src/sim/navigation";
import {
  LocalUnitSimulation,
  POSITION_SCALE,
  toSimPoint,
  type BuildingState,
  type UnitState,
} from "../src/sim/units";

const unit = (): UnitState => ({
  id: "unit-1",
  kind: "ghostrunner",
  ownerId: "player-1",
  health: 140,
  maxHealth: 140,
  pushable: true,
  radius: 450,
  speed: 9 * POSITION_SCALE,
  attackDamage: 20,
  attackIntervalTicks: 11,
  attackCooldownTicks: 0,
  position: toSimPoint(0, 0),
  target: toSimPoint(0, 0),
  path: [],
  order: "idle",
  moving: false,
  attacking: false,
});

const commandCenter = (id: string, ownerId: string, x: number, health = 2_500): BuildingState => ({
  id,
  kind: "command-center",
  lifecycle: "active",
  constructionProgress: 1,
  ownerId,
  position: toSimPoint(x, 0),
  rotation: 0,
  radius: 5_580,
  attackRadius: 5_000,
  health,
  maxHealth: 2_500,
  productionQueue: [],
  rallyPoint: toSimPoint(x + 10, 0),
});

beforeAll(() => initializeNavigation());

describe("match sessions", () => {
  test("local sessions own ticking and only publish changed frames", () => {
    const session = new LocalMatchSession("player-1", new LocalUnitSimulation([unit()]));
    const initial = session.readFrame(0)!;
    expect(session.readFrame(initial.version)).toBeUndefined();

    const submission = session.submit({
      type: "move",
      unitIds: ["unit-1"],
      target: toSimPoint(10, 0),
    });
    expect(submission).toMatchObject({ status: "accepted", serverTick: 0 });
    const commanded = session.readFrame(initial.version)!;
    expect(commanded.units[0]).toMatchObject({ order: "move", moving: true });

    session.advance(0.1);
    const advanced = session.readFrame(commanded.version)!;
    expect(advanced.tick).toBe(1);
    expect(advanced.units[0]!.position.x).toBe(900);
  });

  test("remote sessions queue identity-free commands and consume authoritative frames", () => {
    const sent: unknown[] = [];
    const session = new RemoteMatchSession((message) => sent.push(message));
    const submission = session.submit({
      type: "stop",
      unitIds: ["unit-1"],
    });
    expect(submission.status).toBe("queued");
    expect(sent).toEqual([{
      type: "command",
      command: { type: "stop", unitIds: ["unit-1"], commandId: submission.commandId },
    }]);

    const frame = {
      version: 4,
      tick: 12,
      full: true,
      units: [unit()],
      buildings: [],
      events: [],
    };
    session.receive({ type: "frame", frame });
    const delta = {
      ...frame,
      version: 5,
      full: false,
      units: [],
      removedUnitIds: ["unit-1"],
    };
    session.receive({ type: "frame", frame: delta });
    expect(session.readFrame(3)).toEqual(frame);
    expect(session.readFrame(4)).toEqual(delta);
    expect(session.readFrame(5)).toBeUndefined();
  });

  test("publishes the authoritative command-center elimination result", () => {
    const attacker = unit();
    attacker.position = toSimPoint(8, 0);
    attacker.target = { ...attacker.position };
    attacker.attackRange = 14 * POSITION_SCALE;
    attacker.attackDamage = 30;
    const playerCenter = commandCenter("player-center", "player-1", -20);
    const enemyCenter = commandCenter("enemy-center", "player-2", 10, 30);
    const simulation = new LocalUnitSimulation(
      [attacker],
      [playerCenter, enemyCenter],
      undefined,
      { commandCenterElimination: ["player-1", "player-2"] },
    );
    const session = new LocalMatchSession("player-1", simulation);

    session.submit({ type: "attack", unitIds: [attacker.id], targetId: enemyCenter.id });
    session.advance(0.2);

    const resolvedFrame = session.readFrame(0)!;
    expect(resolvedFrame.matchResult).toEqual({
      winnerId: "player-1",
      defeatedPlayerIds: ["player-2"],
      resolvedTick: 2,
    });
    session.advance(1);
    expect(session.readFrame(resolvedFrame.version)).toBeUndefined();
  });
});
