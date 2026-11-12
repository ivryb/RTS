import { placeGroundGeometry } from "../src/groundOverlay";
import { beforeAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { initializeNavigation } from "../src/sim/navigation";
import type { GeneratedMap } from "../src/map";
import { UnitSystem, createRangeIndicator, type UnitPresentationOptions, type UnitSpawn } from "../src/unitSystem";

// Keep this focused presentation test independent of other test files.
beforeAll(() => initializeNavigation());

const map = {
  size: 100,
  segments: 1,
  heights: new Float32Array(4),
} as GeneratedMap;

const options: UnitPresentationOptions = {
  terrainAlignment: 0,
  turnResponsiveness: 10,
  selectionRing: { radius: 1, offset: { x: 0, z: 0 } },
  selectionHitbox: { radius: 1, height: 1, offset: { x: 0, y: 0.5, z: 0 } },
};

const spawn = (id: string, kind: UnitSpawn["kind"], x: number, z: number): UnitSpawn => ({
  id,
  kind,
  x,
  z,
  health: 100,
  radius: 1,
  speed: 5,
  attackMinRange: kind === "behemoth" ? 4 : undefined,
  attackRange: 10,
});

describe("selected attack ranges", () => {
  test("merges one ranged type and hides mixed ranged types", () => {
    const spawns = [
      spawn("hornet-1", "hornet", 0, 0),
      spawn("hornet-2", "hornet", 4, 0),
      spawn("hornet-3", "hornet", 8, 0),
      spawn("behemoth-1", "behemoth", 0, 4),
    ];
    const world = new THREE.Group();
    const system = new UnitSystem(world, map, spawns);
    const roots = new Map<string, THREE.Group>();
    for (const unit of spawns) {
      const root = new THREE.Group();
      const visual = new THREE.Group();
      root.add(visual);
      system.attachHornet(unit.id, root, visual, options);
      roots.set(unit.id, root);
    }

    const combined = world.getObjectByName("Combined attack range") as THREE.Group;
    system.select(["hornet-1"]);
    const singleRange = roots.get("hornet-1")!.getObjectByName("Attack range")!;
    const singleVertices = (singleRange.children[0] as THREE.Mesh)
      .geometry.getAttribute("position").count;

    system.select(["hornet-1", "hornet-2", "hornet-3"]);
    const union = combined.children[0] as THREE.Mesh;
    const unionPositions = union.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(combined.visible).toBe(true);
    expect(union.geometry.drawRange.count).toBeLessThan(3 * singleVertices);
    expect([...roots.values()].every((root) => !root.getObjectByName("Attack range")!.visible))
      .toBe(true);

    const rangeVersion = unionPositions.version;
    const selectedGroups = system.selectedGroups();
    system.update(0);
    expect(unionPositions.version).toBe(rangeVersion);
    expect(system.selectedGroups()).toBe(selectedGroups);
    system.select(["hornet-1", "hornet-2", "hornet-3"]);
    expect(unionPositions.version).toBe(rangeVersion);

    system.select(["hornet-1", "behemoth-1"]);
    expect(combined.visible).toBe(false);
    expect(roots.get("hornet-1")!.getObjectByName("Attack range")!.visible).toBe(false);
    expect(roots.get("behemoth-1")!.getObjectByName("Attack range")!.visible).toBe(false);

    system.select(["hornet-1"]);
    expect(roots.get("hornet-1")!.getObjectByName("Attack range")!.visible).toBe(true);
    roots.get("hornet-1")!.rotation.y = 1.2;
    system.update(0);
    expect(roots.get("hornet-1")!.getObjectByName("Attack range")!.rotation.y)
      .toBeCloseTo(-1.2);
  });
});


test("range shape and dot dimensions remain stable at different mountain elevations", () => {
  const range = createRangeIndicator(7, 22);
  for (const child of range.children) {
    const mesh = child as THREE.Mesh;
    const original = mesh.geometry.getAttribute("position").clone();
    for (const height of [0, 18, 3, 42]) {
      placeGroundGeometry(mesh.geometry, height);
      const points = mesh.geometry.getAttribute("position");
      expect(points.count).toBe(original.count);
      for (let i = 0; i < points.count; i++) {
        expect(points.getX(i)).toBe(original.getX(i));
        expect(points.getZ(i)).toBe(original.getZ(i));
        expect(points.getY(i)).toBeCloseTo(height + .1, 4);
      }
    }
  }
});

test("Scout selection stays centered and circular on steep terrain while turning", () => {
  const mountain = { ...map, heights: new Float32Array([0, 60, 20, 90]) };
  const units = [spawn("scout", "scout-drone", 8, 12)];
  const world = new THREE.Group();
  const system = new UnitSystem(world, mountain, units);
  const root = new THREE.Group();
  const visual = new THREE.Group();
  root.add(visual);
  system.attachScoutDrone("scout", root, visual, options);
  system.select(["scout"]);
  for (const rotation of [0, .7, 2.1]) {
    root.rotation.y = rotation;
    system.update(0);
    const ring = root.getObjectByName("Selection ring") as THREE.Mesh;
    expect(ring.visible).toBe(true);
    const positions = ring.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const radius = Math.hypot(positions.getX(i), positions.getZ(i));
      expect(radius).toBeGreaterThan(.9999);
      expect(radius).toBeLessThan(1.1001);
      expect(positions.getY(i)).toBeCloseTo(.1, 5);
    }
    root.updateWorldMatrix(true, true);
    const center = new THREE.Box3().setFromObject(ring).getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(root.position.x, 4);
    expect(center.z).toBeCloseTo(root.position.z, 4);
  }
  system.dispose();
});
