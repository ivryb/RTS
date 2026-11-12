import { expect, test } from "bun:test";
import * as THREE from "three";
import { OrderMarker } from "../src/orderMarker";
import { UI_ATTACK_COLOR } from "../src/uiColors";

test("pulse proportions stay fixed on steep mountains", () => {
  const height = (x: number, z: number) => x * 8 + z * 12;
  const marker = new OrderMarker("destination", height);
  marker.show(4, height(4, 8), 8);
  marker.animate(.25);
  let checked = 0;
  marker.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.name !== "Order pulse" || !object.visible) return;
    const position = object.geometry.attributes.position;
    for (let index = 0; index < position.count; index++) {
      const y = position.getY(index) + marker.position.y;
      expect(y - height(marker.position.x, marker.position.z)).toBeCloseTo(.1, 4);
      checked++;
    }
  });
  expect(checked).toBeGreaterThan(0);
});

test("one soft pulse finishes in half a second, leaving flag or red ground highlight", () => {
  for (const kind of ["destination", "attack"] as const) {
    const marker = new OrderMarker(kind);
    marker.show(0, 0, 0);
    marker.animate(.2);
    const pulses = marker.children.filter((object) => object.name === "Order pulse");
    expect(pulses).toHaveLength(1);
    expect(pulses.some((pulse) => pulse.visible)).toBe(true);
    for (const pulse of pulses) {
      if (!(pulse instanceof THREE.Mesh)) throw new Error("Missing pulse mesh");
      const color = pulse.geometry.getAttribute("color");
      expect(color.itemSize).toBe(4);
      const alphas = Array.from({ length: color.count }, (_, index) => color.getW(index));
      expect(Math.min(...alphas)).toBeLessThan(.01);
      expect(Math.max(...alphas)).toBeGreaterThan(.9);
      expect(pulse.material.depthTest).toBe(false);
    }
    marker.animate(.3);
    expect(pulses.every((pulse) => !pulse.visible)).toBe(true);
    expect(marker.visible).toBe(true);
    if (kind === "attack") {
      const highlight = marker.getObjectByName("Attack target highlight");
      expect(highlight).toBeInstanceOf(THREE.Mesh);
      if (!(highlight instanceof THREE.Mesh)) throw new Error("Missing highlight");
      expect(highlight.material.color.getHex()).toBe(UI_ATTACK_COLOR);
      expect(highlight.material.depthTest).toBe(false);
    }
  }
});


test("move and attack pulses have the same size for small units and large buildings", () => {
  const move = new OrderMarker("destination");
  move.show(0, 0, 0);
  move.animate(.2);
  const pulseBounds = (marker: OrderMarker) => {
    const pulse = marker.getObjectByName("Order pulse");
    if (!pulse) throw new Error("Missing order pulse");
    return new THREE.Box3().setFromObject(pulse).getSize(new THREE.Vector3());
  };
  for (const radius of [.5, 1, 6]) {
    const attack = new OrderMarker("attack");
    attack.show(0, 0, 0, radius);
    attack.animate(.2);
    expect(pulseBounds(attack).distanceTo(pulseBounds(move))).toBeLessThan(.00001);
    const brackets = attack.getObjectByName("Attack target highlight");
    if (!brackets) throw new Error("Missing attack brackets");
    expect(new THREE.Box3().setFromObject(brackets).getSize(new THREE.Vector3()).x).toBeCloseTo(radius * 2);
  }
});
