import * as THREE from "three";
import { BUILDING_CATALOG } from "../buildingCatalog";
import { placeGroundGeometry, prepareGroundOverlay } from "../groundOverlay";
import { UI_ATTACK_COLOR, UI_SELECTION_COLOR } from "../uiColors";
import type { MarkerOption, PlacementState } from "./index";
import { groundQuad } from "./stub";

/**
 * Option A, "Halo": one thin ring with a pool of light that fades inward from it, as if the
 * footprint were lit from below the sand. Every measure is in world units and the same on every
 * marker, so a Scout Drone and a Command Center wear the same line.
 */
const PADDING = 0.25;
/** Room outside the ring for its soft outer edge. */
const MARGIN = 0.5;

const haloMaterial = (color: number, ringRadius: number) => new THREE.ShaderMaterial({
  uniforms: {
    color: { value: new THREE.Color(color) },
    ringRadius: { value: ringRadius },
    blocked: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vLocal;
    varying vec2 vWorld;
    void main() {
      vLocal = position.xz;
      // Hatching runs along a world axis, so it keeps one screen diagonal whatever the mesh's rotation.
      vWorld = (modelMatrix * vec4(position, 1.0)).xz - modelMatrix[3].xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform float ringRadius;
    uniform float blocked;
    varying vec2 vLocal;
    varying vec2 vWorld;

    const float STROKE = 0.07;
    const float HATCH_SPACING = 0.78;

    // A line of constant world width around distance 0, never thinner than a pixel and a half.
    float stroke(float offset, float pixel) {
      float halfWidth = max(STROKE * 0.5, pixel * 0.75);
      return 1.0 - smoothstep(halfWidth - pixel * 0.5, halfWidth + pixel * 0.5, abs(offset));
    }

    void main() {
      float r = length(vLocal);
      float inward = ringRadius - r;
      float inside = step(0.0, inward);

      float ring = stroke(inward, fwidth(r));
      // Bright against the ring, then a long tail that never reaches the centre of a large disc
      // and stays a gradient inside a small one.
      float pool = inside * (0.14 * exp(-inward / 0.2) + 0.17 * exp(-inward / min(1.2, ringRadius * 0.5)));
      float bloom = (1.0 - inside) * 0.16 * exp(inward / 0.1);

      float hatchAt = (fract(vWorld.x / HATCH_SPACING + 0.5) - 0.5) * HATCH_SPACING;
      float hatch = blocked * inside * 0.8 * stroke(hatchAt, fwidth(vWorld.x))
        * smoothstep(0.12, 0.22, inward);
      float wash = blocked * inside * 0.07;

      float alpha = max(max(ring * 0.95, pool + wash), max(bloom, hatch));
      if (alpha < 0.004) discard;
      gl_FragColor = vec4(color, alpha);
      #include <colorspace_fragment>
    }`,
  side: THREE.DoubleSide,
});

const haloMesh = (extent: number, color: number, ringRadius: number) => {
  const mesh = new THREE.Mesh(groundQuad(extent), haloMaterial(color, ringRadius));
  prepareGroundOverlay(mesh);
  return mesh;
};

/** Writes depth only, so the translucent ghost shows its nearest surface once instead of stacking. */
const ghostDepth = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true });
const GHOST_RENDER_ORDER = 900;

interface Ghost {
  root: THREE.Group;
  /** Clones of the building's materials, each beside its real colour. */
  materials: { material: THREE.MeshStandardMaterial; base: THREE.Color }[];
}

const fillGhost = (ghost: Ghost, model: THREE.Object3D) => {
  const clones = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const meshes: THREE.Mesh[] = [];
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  for (const mesh of meshes) {
    const source = mesh.material;
    if (!(source instanceof THREE.MeshStandardMaterial)) continue;
    let material = clones.get(source);
    if (!material) {
      material = source.clone();
      material.transparent = true;
      material.depthWrite = false;
      clones.set(source, material);
      ghost.materials.push({ material, base: source.color.clone() });
    }
    mesh.material = material;
    mesh.castShadow = false;
    mesh.renderOrder = GHOST_RENDER_ORDER + 1;
    const depth = mesh.clone(false);
    depth.material = ghostDepth;
    depth.renderOrder = GHOST_RENDER_ORDER;
    mesh.parent?.add(depth);
  }
  ghost.root.add(model);
};

const blockedTint = new THREE.Color(UI_ATTACK_COLOR);

const tintGhost = (ghost: Ghost, valid: boolean) => {
  for (const { material, base } of ghost.materials) {
    material.color.copy(base);
    if (!valid) material.color.lerp(blockedTint, 0.85);
    material.opacity = valid ? 0.58 : 0.4;
  }
};

export const optionA: MarkerOption = {
  selection({ radius, color }) {
    const mesh = haloMesh(radius + PADDING + MARGIN, color, radius + PADDING);
    mesh.name = "Selection halo";
    mesh.userData.selectionOverlay = true;
    mesh.visible = false;
    return mesh;
  },
  placement(loadGhost) {
    const object = new THREE.Group();
    object.name = "Construction placement";
    // Keeps the ghost out of click picking, like the selection halos.
    object.userData.selectionOverlay = true;
    const halo = haloMesh(1, UI_SELECTION_COLOR, 1);
    object.add(halo);
    const ghosts = new Map<string, Ghost>();
    let shown: Ghost | undefined;
    let allowed = true;
    return {
      object,
      show({ kind, groundY, radius, valid }: PlacementState) {
        allowed = valid;
        const { uniforms } = halo.material;
        uniforms.color.value.setHex(valid ? UI_SELECTION_COLOR : UI_ATTACK_COLOR);
        uniforms.ringRadius.value = radius + PADDING;
        uniforms.blocked.value = valid ? 0 : 1;
        // The quad is built at half-size 1, so the scale is its half-size in the world.
        placeGroundGeometry(halo.geometry, groundY, radius + PADDING + MARGIN);

        let ghost = ghosts.get(kind);
        if (!ghost) {
          const created: Ghost = { root: new THREE.Group(), materials: [] };
          ghosts.set(kind, ghost = created);
          void loadGhost(kind).then((model) => {
            fillGhost(created, model);
            tintGhost(created, allowed);
          });
        }
        if (shown !== ghost) {
          if (shown) object.remove(shown.root);
          object.add(ghost.root);
          shown = ghost;
        }
        ghost.root.position.y = groundY;
        ghost.root.rotation.y = BUILDING_CATALOG[kind].defaultRotation;
        tintGhost(ghost, valid);
      },
    };
  },
};
