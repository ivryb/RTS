import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
  formatAttackDamage,
  pickSurface,
  resolveAttackTarget,
  selectableEntityId,
} from "../src/unitInput";

const commander = () => {
  const commands: string[] = [];
  return {
    commands,
    system: {
      attackSelected: (targetId: string) => {
        commands.push(`attack:${targetId}`);
        return true;
      },
      attackGroundSelected: (x: number, z: number) => {
        commands.push(`ground:${x},${z}`);
        return true;
      },
    },
  };
};

describe("attack target resolution", () => {
  test("splits a mixed attack order across direct and ground attackers", () => {
    const { system, commands } = commander();

    expect(resolveAttackTarget(system, "attack-any", "building-1", { x: 4, z: 7 }))
      .toBe(true);
    expect(commands).toEqual(["attack:building-1", "ground:4,7"]);
  });

  test("issues only attack-ground when an attack-any target is terrain", () => {
    const { system, commands } = commander();

    resolveAttackTarget(system, "attack-any", undefined, { x: 2, z: 3 });
    expect(commands).toEqual(["ground:2,3"]);
  });

  test("keeps explicit attack modes separate", () => {
    const direct = commander();
    resolveAttackTarget(direct.system, "attack", "building-1", { x: 4, z: 7 });
    expect(direct.commands).toEqual(["attack:building-1"]);

    const ground = commander();
    resolveAttackTarget(ground.system, "attack-ground", "building-1", { x: 4, z: 7 });
    expect(ground.commands).toEqual(["ground:4,7"]);
  });
});

test("formats attack damage for the unit toolbar", () => {
  expect(formatAttackDamage(140)).toBe("Attack 140");
});

test("resolves unit, building and ore selections from nested model meshes", () => {
  const unit = new THREE.Group();
  unit.userData.unitId = "unit-1";
  const unitMesh = new THREE.Mesh();
  unit.add(unitMesh);
  const building = new THREE.Group();
  building.userData.buildingId = "building-1";
  const buildingMesh = new THREE.Mesh();
  building.add(buildingMesh);

  expect(selectableEntityId(unitMesh)).toBe("unit-1");
  expect(selectableEntityId(buildingMesh)).toBe("building-1");
  const ore = new THREE.Group();
  ore.userData.resourceId = "titanium-1";
  const mineralFace = new THREE.Mesh();
  ore.add(mineralFace);
  expect(selectableEntityId(mineralFace)).toBe("titanium-1");
  expect(selectableEntityId(new THREE.Mesh())).toBeUndefined();
  unit.userData.unitId = 42;
  expect(selectableEntityId(unitMesh)).toBeUndefined();
});


test("visible turret wins over a nearer Command Center click helper and overlays", () => {
  const center = new THREE.Group();
  center.userData.buildingId = "command-center";
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 2), new THREE.MeshBasicMaterial({ visible: false }));
  proxy.userData.selectionProxy = true;
  proxy.position.z = 4;
  center.add(proxy);
  const overlay = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 1));
  overlay.userData.selectionOverlay = true;
  overlay.position.z = 6;
  center.add(overlay);
  const turret = new THREE.Group();
  turret.userData.buildingId = "turret";
  const surface = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  turret.add(surface);
  center.updateMatrixWorld(true);
  turret.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
  const hits = () => ray.intersectObjects([center, turret], true);
  expect(selectableEntityId(hits()[0]?.object)).toBe("command-center");
  expect(selectableEntityId(pickSurface(hits())?.object)).toBe("turret");
  turret.visible = false;
  expect(selectableEntityId(pickSurface(hits())?.object)).toBe("command-center");
  center.visible = false;
  expect(pickSurface(hits())).toBeUndefined();
});
