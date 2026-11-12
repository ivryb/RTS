import * as THREE from "three";

export const TERRAIN_RENDER_ORDER = -100;
const OVERLAY_RENDER_ORDER = -50;

/** Draw between terrain and models, preserving alpha without entering the late transparent pass. */
export function prepareGroundOverlay(mesh: THREE.Mesh) {
  mesh.renderOrder = OVERLAY_RENDER_ORDER;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    material.transparent = false;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.SrcAlphaFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.depthTest = false;
    material.depthWrite = false;
  }
}

/** Anchor once at the center: draping vertices over cliffs distorts circles and pulses. */
export function placeGroundGeometry(geometry: THREE.BufferGeometry, height: number, scale = 1) {
  if (!geometry.hasAttribute("ground")) geometry.setAttribute("ground", geometry.getAttribute("position").clone());
  const rest = geometry.getAttribute("ground");
  const position = geometry.getAttribute("position");
  for (let index = 0; index < rest.count; index++) {
    position.setXYZ(index, rest.getX(index) * scale, height + .1, rest.getZ(index) * scale);
  }
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
}
