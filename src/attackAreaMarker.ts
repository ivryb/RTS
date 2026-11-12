import { prepareGroundOverlay } from "./groundOverlay";
import * as THREE from "three";
import { UI_ATTACK_COLOR } from "./uiColors";

/** Persistent artillery area: a quiet breathing edge, with a fixed blast radius. */
export class AttackAreaMarker extends THREE.Group {
  private readonly haze: THREE.MeshBasicMaterial;
  private elapsed = 0;
  private readonly reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

  constructor() {
    super();
    this.name = "Ground attack target";
    const geometry = new THREE.RingGeometry(0, 4, 96, 40);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute("position");
    const colors = new Float32Array(positions.count * 4);
    for (let index = 0; index < positions.count; index++) {
      const radius = Math.hypot(positions.getX(index), positions.getZ(index)) / 4;
      const edge = Math.exp(-(((radius - .96) / .025) ** 2)) * .6;
      const halo = Math.exp(-(((radius - .89) / .095) ** 2)) * .3;
      const interior = .045 * (1 - radius);
      colors.set([1, 1, 1, edge + halo + interior], index * 4);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    this.haze = new THREE.MeshBasicMaterial({
      color: UI_ATTACK_COLOR, vertexColors: true, transparent: true, opacity: .5,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const area = new THREE.Mesh(geometry, this.haze);
    area.name = "Artillery area glow";
    area.renderOrder = 2;
    this.add(area);
    // A small center mark remains legible without competing with the area edge.
    const centerMaterial = new THREE.MeshBasicMaterial({
      color: UI_ATTACK_COLOR, transparent: true, opacity: .4,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    for (const rotation of [0, Math.PI / 2]) {
      const stroke = new THREE.PlaneGeometry(.055, .55);
      stroke.rotateX(-Math.PI / 2);
      stroke.rotateY(rotation);
      this.add(new THREE.Mesh(stroke, centerMaterial));
    }
    this.traverse((child) => { if (child instanceof THREE.Mesh) prepareGroundOverlay(child); });
    this.visible = false;
  }

  animate(deltaSeconds: number) {
    if (!this.visible) return;
    this.elapsed += deltaSeconds;
    this.haze.opacity = this.reducedMotion?.matches ? .5 : .5 + Math.sin(this.elapsed * Math.PI) * .1;
  }
}
