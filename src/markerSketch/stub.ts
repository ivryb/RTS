import * as THREE from "three";
import { placeGroundGeometry, prepareGroundOverlay } from "../groundOverlay";
import { BUILDING_CATALOG } from "../buildingCatalog";
import { UI_ATTACK_COLOR } from "../uiColors";
import type { MarkerOption, PlacementState } from "./index";

/**
 * A working example of the sketch API, and the starting point for each option: a quad whose
 * fragment shader draws a ring of constant world width, and a placement marker that shows a
 * translucent ghost of the building over its footprint.
 */
const ringMaterial = (color: number, radius: number) => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(color) }, radius: { value: radius } },
  vertexShader: /* glsl */ `
    varying vec2 vLocal;
    void main() {
      vLocal = position.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform float radius;
    varying vec2 vLocal;
    void main() {
      float d = abs(length(vLocal) - radius) - 0.05;
      float alpha = 1.0 - smoothstep(0.0, fwidth(d) * 1.5, d);
      if (alpha <= 0.0) discard;
      gl_FragColor = vec4(color, alpha * 0.9);
    }`,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/** A flat square of half-size `extent` at y = 0, ready for `placeGroundGeometry`. */
export const groundQuad = (extent: number) =>
  new THREE.PlaneGeometry(extent * 2, extent * 2).rotateX(-Math.PI / 2);

export const stubOption = (): MarkerOption => ({
  selection({ radius, color }) {
    const mesh = new THREE.Mesh(groundQuad(radius + 0.5), ringMaterial(color, radius));
    mesh.name = "Selection ring";
    mesh.userData.selectionOverlay = true;
    prepareGroundOverlay(mesh);
    mesh.visible = false;
    return mesh;
  },
  placement(ghost) {
    const object = new THREE.Group();
    object.name = "Construction placement";
    const ring = new THREE.Mesh(groundQuad(1), ringMaterial(0xffffff, 1));
    prepareGroundOverlay(ring);
    object.add(ring);
    const ghostMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false });
    const ghosts = new Map<string, THREE.Object3D>();
    let shown: THREE.Object3D | undefined;
    return {
      object,
      show({ kind, groundY, radius, valid }: PlacementState) {
        const color = valid ? 0xf4f4ef : UI_ATTACK_COLOR;
        ring.material.uniforms.color.value.setHex(color);
        ring.material.uniforms.radius.value = radius;
        // The quad is built at half-size 1, so scaling it by radius + 0.5 keeps 0.5 of padding.
        placeGroundGeometry(ring.geometry, groundY, radius + 0.5);
        ghostMaterial.color.setHex(color);
        if (!ghosts.has(kind)) {
          ghosts.set(kind, new THREE.Group());
          void ghost(kind).then((model) => {
            model.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.material = ghostMaterial;
                child.castShadow = false;
              }
            });
            ghosts.get(kind)!.add(model);
          });
        }
        const current = ghosts.get(kind)!;
        if (shown !== current) {
          if (shown) object.remove(shown);
          object.add(current);
          shown = current;
        }
        current.position.y = groundY;
        current.rotation.y = BUILDING_CATALOG[kind].defaultRotation;
      },
    };
  },
});
