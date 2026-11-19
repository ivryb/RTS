import { seededRandom } from "../../../src/behemothAttack";
import { UNIT_DEFINITIONS, type UnitKind } from "../../../src/sim/unitDefinitions";
import type { BuildingKind } from "../../../src/sim/units";

/**
 * Positions are metres on the ground in screen-aligned axes around the scenario centre:
 * `right` runs toward the right edge of the screen and `away` toward the top.
 */
export interface CastUnit {
  id: string;
  kind: UnitKind;
  right: number;
  away: number;
  /** Screen-aligned metres per second; a mover travels from t = 0 until it dies. */
  velocityRight: number;
  velocityAway: number;
  diesAt: number;
}

export interface CastBuilding {
  id: string;
  kind: BuildingKind;
  right: number;
  away: number;
  rotation: number;
  constructionProgress: number;
  diesAt: number;
}

export interface Scenario {
  title: string;
  /** Clear ground the cast needs around the centre, in metres. */
  clearRadius: number;
  /** Stands the cast on the steepest clear ground nearby instead of the most level. */
  sloped?: true;
  /** Seconds of motion recorded as a clip at 30 frames per second. */
  clipSeconds: number;
  /** World height the close camera shows, in metres. The gameplay camera always shows 43 m. */
  closeHeight: number;
  closeFocus: { right: number; away: number };
  /** Moments shown in the frame strip, then the later stills that show what is left behind. */
  stripTimes: readonly number[];
  aftermathTimes: readonly number[];
  units: readonly CastUnit[];
  buildings: readonly CastBuilding[];
}

const MAX_ZOOM_HEIGHT = 56 / 3.9;

/**
 * One idle unit dies at 0.5 s; one crosses the frame at its real speed and dies at `moverDiesAt`.
 * Both die within 0.7 × `spacing` of the centre, so the 1:1 strip crop (12.8 m wide) holds them.
 */
const unitPair = (kind: UnitKind, spacing: number, moverDiesAt: number): Scenario => {
  const speed = UNIT_DEFINITIONS[kind].speed;
  return {
    title: `${kind} killed idle and moving`,
    clearRadius: 12,
    clipSeconds: Math.max(4, moverDiesAt + 3),
    closeHeight: MAX_ZOOM_HEIGHT,
    closeFocus: { right: 0, away: 0 },
    stripTimes: [0.4, 0.55, 0.7, 0.9, moverDiesAt + 0.05, moverDiesAt + 0.25, moverDiesAt + 0.7, moverDiesAt + 2],
    aftermathTimes: [10, 30, 60],
    units: [
      { id: `${kind}-idle`, kind, right: -spacing * 0.7, away: 1.6, velocityRight: 0, velocityAway: 0, diesAt: 0.5 },
      {
        id: `${kind}-moving`,
        kind,
        right: spacing * 0.7 - speed * moverDiesAt,
        away: -2.2,
        velocityRight: speed,
        velocityAway: 0,
        diesAt: moverDiesAt,
      },
    ],
    buildings: [],
  };
};

const building = (
  title: string,
  kind: BuildingKind,
  constructionProgress: number,
  closeHeight: number,
): Scenario => ({
  title,
  clearRadius: kind === "command-center" ? 15 : 9,
  clipSeconds: 6,
  closeHeight,
  closeFocus: { right: 0, away: 0 },
  stripTimes: [0.4, 0.7, 1.1, 1.5, 1.9, 2.4, 3.2, 5.5],
  aftermathTimes: [15, 45, 120],
  units: [],
  buildings: [{
    id: `${kind}-1`,
    kind,
    right: 0,
    away: 0,
    rotation: kind === "command-center" ? Math.PI / 4 : 0,
    constructionProgress,
    diesAt: 0.5,
  }],
});

const MASS_ROSTER: readonly [UnitKind, number][] = [
  ["ghostrunner", 12],
  ["scout-drone", 8],
  ["hornet", 6],
  ["behemoth", 4],
];

/** Units that outlive the fight: seven standing between the casualties and two walking through. */
const SURVIVORS: readonly [UnitKind, number, number, number][] = [
  ["ghostrunner", -5.4, -6.9, 0],
  ["ghostrunner", 0, -6.9, 0],
  ["ghostrunner", 5.4, -6.9, 0],
  ["scout-drone", -10.8, -2.3, 0],
  ["scout-drone", 10.8, -2.3, 0],
  ["hornet", 0, 2.3, 0],
  ["behemoth", 5.4, 6.9, 0],
  ["ghostrunner", -16, -2.3, 3],
  ["hornet", 16, 6.9, -3],
];
const NEVER = 1e9;

/**
 * Thirty units of the whole roster, half of them moving, all dead between 0.5 s and 2.5 s.
 * With `survivors`, nine more live on among them, to show whether leftovers read as dead.
 */
const massFight = (survivors: boolean): Scenario => {
  const units: CastUnit[] = survivors
    ? SURVIVORS.map(([kind, right, away, velocityRight], member) => ({
      id: `${kind}-survivor-${member + 1}`, kind, right, away, velocityRight, velocityAway: 0, diesAt: NEVER,
    }))
    : [];
  let index = 0;
  for (const [kind, count] of MASS_ROSTER) {
    for (let member = 0; member < count; member += 1) {
      const column = index % 6;
      const row = Math.floor(index / 6);
      const moving = index % 2 === 1;
      const direction = column < 3 ? 1 : -1;
      const speed = moving ? UNIT_DEFINITIONS[kind].speed * 0.6 : 0;
      const diesAt = 0.5 + seededRandom(77, index) * 2;
      const right = (column - 2.5) * 5.4 + (seededRandom(31, index) - 0.5) * 2.4;
      units.push({
        id: `${kind}-${member + 1}`,
        kind,
        right: right - direction * speed * diesAt,
        away: (row - 2) * 4.6 + (seededRandom(47, index) - 0.5) * 2,
        velocityRight: direction * speed,
        velocityAway: 0,
        diesAt,
      });
      index += 1;
    }
  }
  return {
    title: survivors ? "30 of 39 units die within 2 seconds" : "30 units die within 2 seconds",
    clearRadius: 24,
    clipSeconds: survivors ? 8 : 6,
    closeHeight: MAX_ZOOM_HEIGHT * 1.5,
    closeFocus: { right: -2, away: 0 },
    stripTimes: [0.4, 0.9, 1.3, 1.7, 2.1, 2.6, 3.5, 5.5],
    aftermathTimes: [10, 30, 60],
    units,
    buildings: [],
  };
};

/** One of each unit and a Turret on a slope: wrecks, skids and scorch marks have to follow the ground. */
const slope = (): Scenario => {
  const kinds: UnitKind[] = ["scout-drone", "hornet", "behemoth", "ghostrunner"];
  return {
    title: "Deaths on a slope",
    clearRadius: 10,
    sloped: true,
    clipSeconds: 6,
    closeHeight: MAX_ZOOM_HEIGHT * 1.4,
    closeFocus: { right: 0, away: 0 },
    stripTimes: [0.4, 0.8, 1.2, 1.6, 2.2, 2.8, 3.6, 5.5],
    aftermathTimes: [10, 30, 60],
    units: kinds.map((kind, index) => {
      const speed = UNIT_DEFINITIONS[kind].speed * 0.8;
      const diesAt = 0.6 + index * 0.4;
      const right = (index - 1.5) * 4.4;
      return {
        id: `${kind}-slope`, kind, right: right - speed * diesAt, away: -3,
        velocityRight: speed, velocityAway: 0, diesAt,
      };
    }),
    buildings: [{ id: "turret-slope", kind: "turret", right: 0, away: 4, rotation: 0, constructionProgress: 1, diesAt: 1 }],
  };
};

/** More Scout Drones than there are wreck slots (24): the oldest wrecks sink early to make room. */
const wreckCap = (): Scenario => ({
  title: "32 Scout Drones die, 24 wreck slots",
  clearRadius: 16,
  clipSeconds: 10,
  closeHeight: MAX_ZOOM_HEIGHT * 1.6,
  closeFocus: { right: 0, away: 0 },
  stripTimes: [1, 2.5, 4, 5.5, 6.5, 7.5, 8.5, 9.9],
  aftermathTimes: [14, 24, 40],
  units: Array.from({ length: 32 }, (_, index) => ({
    id: `scout-drone-${index + 1}`,
    kind: "scout-drone" as const,
    right: (index % 8 - 3.5) * 2.6,
    away: (Math.floor(index / 8) - 1.5) * 2.6,
    velocityRight: 0,
    velocityAway: 0,
    diesAt: 0.5 + index * 0.25,
  })),
  buildings: [],
});

/** A base falling in a fight: the Command Center and its Turret go down among dying and surviving units. */
const baseAssault = (): Scenario => {
  const ring: readonly [UnitKind, number, number, number][] = [
    ["ghostrunner", -9, -7, 0.6], ["ghostrunner", -5, -9, 1.5], ["ghostrunner", 4, -9, NEVER],
    ["hornet", 9, -6, 1.1], ["hornet", -11, 2, NEVER], ["behemoth", 11, 3, 2.2],
    ["behemoth", -8, 8, NEVER], ["scout-drone", 2, 9, 0.9], ["scout-drone", 6, 8, 2.6],
    ["ghostrunner", 9, -9, 3], ["ghostrunner", -12, -3, NEVER], ["hornet", 0, -11, 2.4],
  ];
  return {
    title: "A Command Center and its Turret fall in a fight",
    clearRadius: 20,
    clipSeconds: 8,
    closeHeight: 24,
    closeFocus: { right: 1, away: 0 },
    stripTimes: [0.6, 1.2, 1.8, 2.4, 3, 3.8, 5, 7.5],
    aftermathTimes: [15, 45, 120],
    units: ring.map(([kind, right, away, diesAt], index) => ({
      id: `${kind}-assault-${index + 1}`, kind, right, away, velocityRight: 0, velocityAway: 0, diesAt,
    })),
    buildings: [
      { id: "command-center-assault", kind: "command-center", right: 0, away: 0, rotation: Math.PI / 4, constructionProgress: 1, diesAt: 2 },
      { id: "turret-assault", kind: "turret", right: 9, away: 7, rotation: 0, constructionProgress: 1, diesAt: 1.2 },
    ],
  };
};

export const SCENARIOS = {
  "scout-drone": unitPair("scout-drone", 2.6, 1.3),
  hornet: unitPair("hornet", 3.4, 1.4),
  behemoth: unitPair("behemoth", 4.6, 1.8),
  ghostrunner: unitPair("ghostrunner", 2.4, 1.3),
  "command-center": building("Completed Command Center destroyed", "command-center", 1, 20),
  turret: building("Completed Turret destroyed", "turret", 1, MAX_ZOOM_HEIGHT),
  "construction-site": building("Command Center construction site destroyed at 50%", "command-center", 0.5, 20),
  "turret-site": building("Turret construction site destroyed at 40%", "turret", 0.4, MAX_ZOOM_HEIGHT),
  "mass-fight": massFight(false),
  skirmish: massFight(true),
  slope: slope(),
  "wreck-cap": wreckCap(),
  "base-assault": baseAssault(),
} satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof SCENARIOS;
