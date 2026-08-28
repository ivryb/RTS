import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
  formatAttackDamage,
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

test("resolves unit and building selections from nested model meshes", () => {
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
  expect(selectableEntityId(new THREE.Mesh())).toBeUndefined();
  unit.userData.unitId = 42;
  expect(selectableEntityId(unitMesh)).toBeUndefined();
});
