import * as THREE from "three";
import type { GeneratedMap } from "../../../src/map";
import type { MatchFrame, MatchSession } from "../../../src/matchSession";
import { createModelLibrary } from "../../../src/modelAssets";
import { BUILDING_DEFINITIONS } from "../../../src/sim/construction";
import { SIMULATION_TICK_SECONDS } from "../../../src/sim/simulationConstants";
import { UNIT_DEFINITIONS } from "../../../src/sim/unitDefinitions";
import {
  POSITION_SCALE,
  toSimPoint,
  type BuildingState,
  type SimulationEvent,
  type UnitState,
} from "../../../src/sim/units";
import { UnitSystem } from "../../../src/unitSystem";
import type { PlacedBuilding, PlacedUnit } from "./deathPreview";

/** Serves hand-written authoritative frames, so the production presentation runs unchanged. */
class ScriptedSession implements MatchSession {
  frame?: MatchFrame;

  submit() {
    return { commandId: "stage", status: "accepted" as const };
  }

  advance() {}

  readFrame(afterVersion: number) {
    return this.frame && this.frame.version > afterVersion ? this.frame : undefined;
  }
}

const unitState = (unit: PlacedUnit, time: number): UnitState => {
  const definition = UNIT_DEFINITIONS[unit.kind];
  const alive = time < unit.diesAt;
  const travelled = Math.min(time, unit.diesAt);
  const x = unit.x + unit.vx * travelled;
  const z = unit.z + unit.vz * travelled;
  const moving = alive && (unit.vx !== 0 || unit.vz !== 0);
  return {
    id: unit.id,
    kind: unit.kind,
    ownerId: "local-player",
    health: alive ? definition.maxHealth : 0,
    maxHealth: definition.maxHealth,
    pushable: true,
    radius: definition.radius * POSITION_SCALE,
    speed: definition.speed * POSITION_SCALE,
    attackCooldownTicks: 0,
    position: toSimPoint(x, z),
    target: toSimPoint(x + unit.vx, z + unit.vz),
    path: [],
    order: moving ? "move" : "idle",
    moving,
    attacking: false,
  };
};

const buildingState = (building: PlacedBuilding): BuildingState => {
  const definition = BUILDING_DEFINITIONS[building.kind];
  // An undamaged site has the health the simulation has granted by its progress.
  const health = 1 + Math.floor(building.constructionProgress * (definition.maxHealth - 1));
  return {
    id: building.id,
    kind: building.kind,
    lifecycle: building.constructionProgress < 1 ? "constructing" : "active",
    constructionProgress: building.constructionProgress,
    ownerId: "local-player",
    position: toSimPoint(building.x, building.z),
    rotation: building.rotation,
    radius: definition.radius * POSITION_SCALE,
    attackRadius: definition.attackRadius * POSITION_SCALE,
    health,
    maxHealth: definition.maxHealth,
  };
};

/**
 * The game's own presentation, fed the frames a real match sends when things die: every unit
 * and building is reported dead with a `unit-died` or `building-died` event on its tick.
 */
export const createScriptedMatch = (
  scene: THREE.Scene,
  map: GeneratedMap,
  units: readonly PlacedUnit[],
  buildings: readonly PlacedBuilding[],
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
) => {
  const session = new ScriptedSession();
  let tick = 0;
  const pushFrame = (time: number, previousTime: number) => {
    const events: SimulationEvent[] = [
      ...units.flatMap((unit) => unit.diesAt > previousTime && unit.diesAt <= time
        ? [{ type: "unit-died" as const, tick, id: unit.id, attackerId: "stage" }] : []),
      ...buildings.flatMap((building) => building.diesAt > previousTime && building.diesAt <= time
        ? [{ type: "building-died" as const, tick, id: building.id, attackerId: "stage" }] : []),
    ];
    session.frame = {
      version: tick + 1,
      tick,
      full: true,
      units: units.map((unit) => unitState(unit, time)),
      buildings: buildings.filter((building) => time < building.diesAt).map(buildingState),
      events,
    };
  };
  pushFrame(0, -1);
  const world = new THREE.Group();
  scene.add(world);
  const models = createModelLibrary();
  const system = new UnitSystem(
    world,
    map,
    [],
    [],
    session,
    ({ kind }) => models.building(kind),
    models.unit,
  );
  return {
    ready: system.prepareRendering(renderer, scene, camera),
    /** Advances by one fixed step; `time` is the scenario clock after the step. */
    update(deltaSeconds: number, time: number) {
      const nextTick = Math.floor(time / SIMULATION_TICK_SECONDS + 1e-6);
      while (tick < nextTick) {
        tick += 1;
        pushFrame(tick * SIMULATION_TICK_SECONDS, (tick - 1) * SIMULATION_TICK_SECONDS);
      }
      system.update(deltaSeconds);
    },
  };
};
