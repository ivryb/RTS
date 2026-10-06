/** Run in the preview browser: verifies the shipped GLB through production presentation. */
import * as THREE from "three";
import { generateMap } from "../../src/map";
import type { MatchFrame, MatchSession } from "../../src/matchSession";
import { loadBuildingModel } from "../../src/modelAssets";
import { POSITION_SCALE, toSimPoint, type BuildingState, type UnitState } from "../../src/sim/units";
import { UnitSystem } from "../../src/unitSystem";

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function named(root: THREE.Object3D, name: string) {
  const object = root.getObjectByName(name);
  if (!object) throw new Error(`Shipped turret is missing ${name}`);
  return object;
}

export async function checkTurretBehavior() {
  const map = generateMap(77);
  const results = [];
  for (const rotation of [0, Math.PI / 4, Math.PI]) {
    const root = await loadBuildingModel("turret");
    const head = named(root, "TurretHead");
    const base = named(root, "TurretBase");
    const muzzle = named(head, "TurretMuzzle");
    const target: UnitState = {
      id: "target", kind: "ghostrunner", ownerId: "enemy-player", health: 100, maxHealth: 100,
      pushable: true, radius: POSITION_SCALE, speed: 5 * POSITION_SCALE,
      attackDamage: 20, attackIntervalTicks: 8, attackCooldownTicks: 0,
      position: toSimPoint(3, 14), target: toSimPoint(3, 14), path: [],
      order: "idle", moving: false, attacking: false,
    };
    const weapon = { range: 18 * POSITION_SCALE, damage: 25, intervalTicks: 6, cooldownTicks: 0, facing: 0 };
    const turret: BuildingState = {
      id: "turret", kind: "turret", lifecycle: "active", constructionProgress: 1,
      ownerId: "local-player", position: toSimPoint(3, 2), rotation,
      radius: 2 * POSITION_SCALE, attackRadius: 1.5 * POSITION_SCALE,
      health: 2500, maxHealth: 2500, weapon,
    };
    const frame: MatchFrame = { version: 1, tick: 0, full: true, units: [target], buildings: [turret], events: [] };
    const session: MatchSession = {
      submit() { throw new Error("Presentation check must not submit commands"); },
      advance() {},
      readFrame(afterVersion) { return frame.version > afterVersion ? structuredClone(frame) : undefined; },
    };
    const world = new THREE.Group();
    const system = new UnitSystem(world, map, [], [], session, () => root);
    const advance = (seconds: number) => {
      for (let step = 0; step < Math.round(seconds * 60); step += 1) system.update(1 / 60);
      world.updateMatrixWorld(true);
    };
    const publish = () => {
      frame.version += 1;
      frame.tick += 10;
      frame.events = [];
      system.update(0);
    };
    try {
      world.updateMatrixWorld(true);
      const fixedBase = base.matrixWorld.clone();
      const idleStart = head.rotation.y;
      const idleAngles = [];
      for (let step = 0; step < 12; step += 1) {
        advance(1);
        idleAngles.push(head.rotation.y);
      }
      const idleRange = Math.max(...idleAngles) - Math.min(...idleAngles);
      check(Math.min(...idleAngles) < idleStart - .2 && Math.max(...idleAngles) > idleStart + .2,
        "Idle head does not sweep in both directions");
      check(base.matrixWorld.equals(fixedBase), "Idle animation rotates the foundation");

      const aimErrors = [];
      for (let direction = 0; direction < 8; direction += 1) {
        const heading = direction * Math.PI / 4;
        target.position = toSimPoint(3 + Math.sin(heading) * 12, 2 + Math.cos(heading) * 12);
        target.target = { ...target.position };
        turret.weapon = { ...weapon, facing: heading, targetId: target.id };
        publish();
        const before = head.rotation.y;
        system.update(1 / 60);
        check(Math.abs(head.rotation.y - before) < Math.PI / 2, "Target acquisition snaps the head");
        advance(2);
        const origin = head.getWorldPosition(new THREE.Vector3());
        const expected = new THREE.Vector3(target.position.x / POSITION_SCALE, origin.y, target.position.z / POSITION_SCALE).sub(origin).normalize();
        const barrel = new THREE.Vector3(-1, 0, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
        const error = barrel.angleTo(expected);
        aimErrors.push(error);
        check(error < .002, `Barrel misses target at building yaw ${rotation}, direction ${direction}: ${error}`);
        check(base.matrixWorld.equals(fixedBase), "Target tracking moves the foundation");

        frame.version += 1;
        frame.tick += 1;
        frame.events = [{ type: "weapon-fired", tick: frame.tick, attackerId: turret.id, attack: "direct",
          targetId: target.id, target: { ...target.position }, impactTick: frame.tick + 4 }];
        system.update(0);
        const projectile = named(world, "Turret projectile");
        const tip = muzzle.getWorldPosition(new THREE.Vector3());
        check(projectile.position.distanceTo(tip) < 1e-5, "Projectile does not start at the authored barrel tip");
        system.update(1 / 60);
        const travel = projectile.position.clone().sub(tip);
        travel.y = 0;
        check(travel.length() > .001 && travel.normalize().dot(expected) > .999, "Projectile travels away from the aim direction");
      }
      turret.weapon = weapon;
      publish();
      const lastAim = head.rotation.y;
      advance(3);
      check(Math.abs(head.rotation.y - lastAim) > .05, "Idle sweep does not resume after losing the target");
      check(base.matrixWorld.equals(fixedBase), "Foundation moved during the rotation check");
      results.push({ buildingYaw: rotation, idleSweepRadians: idleRange, targetDirections: aimErrors.length,
        maximumAimErrorRadians: Math.max(...aimErrors), muzzleLaunches: aimErrors.length, idleResumed: true, stationaryBase: true });
    } finally {
      system.dispose();
    }
  }
  return { model: "assets/models/turret.glb", results };
}
