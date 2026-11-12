import { placeGroundGeometry, prepareGroundOverlay } from "./groundOverlay";
import * as THREE from "three";
import { UI_ATTACK_COLOR, UI_SELECTION_COLOR } from "./uiColors";

const PULSE_DURATION = .46;

const pulseGeometry = (attack: boolean) => {
  const geometry = new THREE.RingGeometry(0, 1, 64, 32);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 4);
  for (let index = 0; index < position.count; index++) {
    const radius = Math.hypot(position.getX(index), position.getZ(index));
    const rim = Math.exp(-(((radius - .82) / (attack ? .085 : .045)) ** 2));
    const glow = Math.exp(-(((radius - .65) / .21) ** 2)) * .48;
    const alpha = Math.min(1, rim + glow);
    colors.set([1, 1, 1, alpha], index * 4);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  return geometry;
};

const targetBrackets = () => {
  const vertices: number[] = [];
  for (let corner = 0; corner < 4; corner++) {
    const angle = corner * Math.PI / 2;
    for (const [left, top, right, bottom] of [[.45, .84, 1, 1], [.84, .45, 1, .84]]) {
      for (const [x, z] of [[left, top], [right, top], [right, bottom], [left, top], [right, bottom], [left, bottom]]) {
        vertices.push(x * Math.cos(angle) - z * Math.sin(angle), 0, x * Math.sin(angle) + z * Math.cos(angle));
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
};

/** Ground feedback follows the terrain; the upright flag remains vertical. */
export class OrderMarker extends THREE.Group {
  private readonly cloth?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly pulse: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly highlight?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  private elapsed = 0;
  private radius = 1;

  constructor(
    kind: "destination" | "attack",
    private readonly groundHeight?: (x: number, z: number) => number,
  ) {
    super();
    this.name = kind === "destination" ? "Destination flag" : "Attack feedback";
    const material = new THREE.MeshBasicMaterial({
      color: kind === "attack" ? UI_ATTACK_COLOR : UI_SELECTION_COLOR,
      side: THREE.DoubleSide, toneMapped: false,
      depthWrite: false, depthTest: true, transparent: true,
    });
    if (kind === "destination") {
      const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xdadbd5, metalness: .25, roughness: .5, emissive: 0x92948a, emissiveIntensity: .35 });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.035, .055, 1.8, 10), poleMaterial);
      pole.position.y = .9;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(.12, .18, .13, 8), poleMaterial);
      base.position.y = .065;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(.065, 8, 6), poleMaterial);
      cap.position.y = 1.84;
      const geometry = new THREE.PlaneGeometry(.85, .5, 16, 6);
      geometry.translate(.425, 1.5, 0);
      const positions = geometry.attributes.position;
      const colors: number[] = [];
      for (let index = 0; index < positions.count; index++) {
        const x = positions.getX(index);
        const y = positions.getY(index);
        // A notched fabric pennant, with a dark hoist stripe and stitched hems.
        if (x > .7) positions.setX(index, x - (1 - Math.abs(y - 1.5) / .25) * .13);
        const shade = x < .1 ? .58 : Math.abs(y - 1.5) > .22 ? .84 : 1;
        colors.push(shade, shade, shade);
      }
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      const fabric = new THREE.MeshStandardMaterial({
        color: 0xfffdf5, emissive: 0xdedbd0, emissiveIntensity: .65,
        side: THREE.DoubleSide, roughness: .95, vertexColors: true,
      });
      this.cloth = new THREE.Mesh(geometry, fabric);
      this.cloth.rotation.y = Math.PI / 4;
      this.add(base, pole, cap, this.cloth);
    } else {
      const geometry = targetBrackets();
      this.highlight = new THREE.Mesh(geometry, material);
      this.highlight.name = "Attack target highlight";
      this.add(this.highlight);
    }
    const pulseMaterial = material.clone();
    pulseMaterial.vertexColors = true;
    this.pulse = new THREE.Mesh(pulseGeometry(kind === "attack"), pulseMaterial);
    if (kind === "destination") material.dispose();
    this.pulse.name = "Order pulse";
    this.add(this.pulse);
    prepareGroundOverlay(this.pulse);
    if (this.highlight) prepareGroundOverlay(this.highlight);
    this.visible = false;
  }

  show(x: number, y: number, z: number, radius = 1) {
    this.elapsed = 0;
    this.radius = radius;
    this.visible = true;
    this.place(x, y, z);
    this.animate(0);
  }

  place(x: number, y: number, z: number) {
    this.position.set(x, y, z);
    if (this.highlight) this.conform(this.highlight, this.radius);
  }

  animate(delta: number) {
    if (!this.visible) return;
    this.elapsed += delta;
    const reduced = this.reducedMotion?.matches ?? false;
    if (this.cloth) {
      const positions = this.cloth.geometry.attributes.position;
      for (let index = 0; index < positions.count; index++) {
        const x = positions.getX(index);
        positions.setZ(index, reduced ? 0 : Math.sin(x * 9 - this.elapsed * 7) * .13 * x);
      }
      positions.needsUpdate = true;
      this.cloth.geometry.computeVertexNormals();
    }
    const phase = this.elapsed / PULSE_DURATION;
    // One acknowledgement wave; afterwards only the flag or target highlight remains.
    this.pulse.visible = !reduced && phase >= 0 && phase < 1;
    if (this.pulse.visible) {
      this.pulse.material.opacity = (1 - phase) * (this.highlight ? .95 : .7);
      // Command feedback has a consistent size; only the brackets fit the target.
      this.conform(this.pulse, .35 + (1 - (1 - phase) ** 2) * 1.75);
    }
  }

  private conform(mesh: THREE.Mesh<THREE.BufferGeometry>, radius: number) {
    const height = this.groundHeight?.(this.position.x, this.position.z) ?? this.position.y;
    placeGroundGeometry(mesh.geometry, height - this.position.y, radius);
  }
}
