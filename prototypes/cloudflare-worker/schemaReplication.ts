import { Encoder, StateView, schema } from "@colyseus/schema";
import type { BuildingState, UnitState } from "../../src/sim/units";

Encoder.BUFFER_SIZE = 64 * 1024;

const UNIT_KIND = {
  ghostrunner: 0,
  "scout-drone": 1,
  behemoth: 2,
  hornet: 3,
} as const;
const UNIT_ORDER = { idle: 0, move: 1, attack: 2, "attack-ground": 3, build: 4 } as const;
const BUILDING_KIND = { "command-center": 0, turret: 1 } as const;
const BUILDING_LIFECYCLE = { constructing: 0, active: 1 } as const;

export const ReplicatedUnit = schema({
  owner: "uint8",
  kind: "uint8",
  x: "int32",
  z: "int32",
  targetX: "int32",
  targetZ: "int32",
  health: "uint16",
  maxHealth: "uint16",
  order: "uint8",
  flags: "uint8",
  constructionTargetId: "string",
}, "ReplicatedUnit");

export const ReplicatedTrainingItem = schema({
  id: "string",
  kind: "uint8",
  progressTicks: "uint16",
  totalTicks: "uint16",
}, "ReplicatedTrainingItem");

export const ReplicatedBuilding = schema({
  owner: "int8",
  kind: "uint8",
  lifecycle: "uint8",
  constructionProgress: "float32",
  x: "int32",
  z: "int32",
  rotation: "float32",
  radius: "uint16",
  health: "uint16",
  maxHealth: "uint16",
  builderId: "string",
  weaponRange: "uint16",
  attackDamage: "uint16",
  attackIntervalTicks: "uint16",
  attackCooldownTicks: "uint16",
  attackTargetId: "string",
  productionQueue: [ReplicatedTrainingItem],
  rallyX: "int32",
  rallyZ: "int32",
  hasRallyPoint: "boolean",
}, "ReplicatedBuilding");

export const ReplicatedMatch = schema({
  tick: "uint32",
  units: { map: ReplicatedUnit, view: true },
  buildings: { map: ReplicatedBuilding, view: true },
}, "ReplicatedMatch");

export interface ReplicationVisibility {
  unitIds: ReadonlySet<string>;
  buildingIds: ReadonlySet<string>;
}

/** Standalone Colyseus Schema encoder; it has no dependency on the Colyseus server framework. */
export class SchemaReplication {
  private readonly state = new ReplicatedMatch();
  private readonly encoder = new Encoder(this.state);
  private readonly views = new Map<string, StateView>();
  private readonly owners = new Map<string, number>();

  constructor(playerIds: readonly string[]) {
    playerIds.forEach((id, index) => this.owners.set(id, index));
    for (const id of playerIds) this.views.set(id, new StateView(true));
  }

  sync(tick: number, units: readonly UnitState[], buildings: readonly BuildingState[]) {
    this.state.tick = tick;
    const unitIds = new Set<string>();
    for (const unit of units) {
      unitIds.add(unit.id);
      let target = this.state.units.get(unit.id);
      if (!target) {
        target = new ReplicatedUnit();
        this.state.units.set(unit.id, target);
      }
      target.owner = this.owners.get(unit.ownerId) ?? 255;
      target.kind = UNIT_KIND[unit.kind];
      target.x = unit.position.x;
      target.z = unit.position.z;
      target.targetX = unit.target.x;
      target.targetZ = unit.target.z;
      target.health = unit.health;
      target.maxHealth = unit.maxHealth;
      target.order = UNIT_ORDER[unit.order];
      target.flags = Number(unit.moving) | Number(unit.attacking) << 1
        | Number(unit.guardMode === "hold-position") << 2;
      target.constructionTargetId = unit.constructionTargetId ?? "";
    }
    for (const id of this.state.units.keys()) {
      if (!unitIds.has(id)) this.state.units.delete(id);
    }
    const buildingIds = new Set<string>();
    for (const building of buildings) {
      buildingIds.add(building.id);
      let target = this.state.buildings.get(building.id);
      if (!target) {
        target = new ReplicatedBuilding();
        this.state.buildings.set(building.id, target);
      }
      target.owner = this.owners.get(building.ownerId) ?? -1;
      target.kind = BUILDING_KIND[building.kind];
      target.lifecycle = BUILDING_LIFECYCLE[building.lifecycle];
      target.constructionProgress = building.constructionProgress;
      target.x = building.position.x;
      target.z = building.position.z;
      target.rotation = building.rotation;
      target.radius = building.radius;
      target.health = building.health;
      target.maxHealth = building.maxHealth;
      target.builderId = building.builderId ?? "";
      target.weaponRange = building.weapon?.range ?? 0;
      target.attackDamage = building.weapon?.damage ?? 0;
      target.attackIntervalTicks = building.weapon?.intervalTicks ?? 0;
      target.attackCooldownTicks = building.weapon?.cooldownTicks ?? 0;
      target.attackTargetId = building.weapon?.targetId ?? "";
      const queue = building.productionQueue ?? [];
      while (target.productionQueue.length > queue.length) target.productionQueue.pop();
      for (const [index, item] of queue.entries()) {
        let replicated = target.productionQueue[index];
        if (!replicated) {
          replicated = new ReplicatedTrainingItem();
          target.productionQueue.push(replicated);
        }
        replicated.id = item.id;
        replicated.kind = UNIT_KIND[item.kind];
        replicated.progressTicks = item.progressTicks;
        replicated.totalTicks = item.totalTicks;
      }
      target.rallyX = building.rallyPoint?.x ?? 0;
      target.rallyZ = building.rallyPoint?.z ?? 0;
      target.hasRallyPoint = Boolean(building.rallyPoint);
    }
    for (const id of this.state.buildings.keys()) {
      if (!buildingIds.has(id)) this.state.buildings.delete(id);
    }
  }

  setVisibility(playerId: string, visibility: ReplicationVisibility) {
    const view = this.views.get(playerId);
    if (!view) throw new Error(`Unknown replication view: ${playerId}`);
    const wanted = new Set<Parameters<StateView["add"]>[0]>();
    for (const id of visibility.unitIds) {
      const unit = this.state.units.get(id);
      if (unit) wanted.add(unit);
    }
    for (const id of visibility.buildingIds) {
      const building = this.state.buildings.get(id);
      if (building) wanted.add(building);
    }
    for (const item of [...view.items]) {
      if (!wanted.has(item)) view.remove(item);
    }
    for (const item of wanted) {
      if (!view.items.includes(item)) view.add(item);
    }
  }

  encodeInitial() {
    const iterator = { offset: 0 };
    this.encoder.encodeAll(iterator);
    const sharedOffset = iterator.offset;
    const frames = new Map<string, Uint8Array>();
    for (const [playerId, view] of this.views) {
      frames.set(playerId, this.encoder.encodeAllView(view, sharedOffset, iterator));
    }
    this.encoder.discardChanges();
    return frames;
  }

  encodeDelta() {
    const iterator = { offset: 0 };
    this.encoder.encode(iterator);
    const sharedOffset = iterator.offset;
    const frames = new Map<string, Uint8Array>();
    for (const [playerId, view] of this.views) {
      frames.set(playerId, this.encoder.encodeView(view, sharedOffset, iterator));
    }
    this.encoder.discardChanges();
    return frames;
  }
}
