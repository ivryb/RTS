import * as THREE from "three";
import { BUILDING_CATALOG } from "../buildingCatalog";
import { placeGroundGeometry, prepareGroundOverlay } from "../groundOverlay";
import { UI_ATTACK_COLOR, UI_SELECTION_COLOR } from "../uiColors";
import type { MarkerOption, PlacementState } from "./index";

/**
 * Option C, "Ground plate": every marker is a decal pressed into the sand. The ground under the
 * thing is darkened by a soft plate, and one thin rim in the selection colour bounds it. Placement
 * adds a one-metre dot grid inside the footprint; a blocked spot turns the dots into crosses.
 */

/** Metres between the footprint and the rim's centre line, the same on every marker. */
const PAD = 0.1;
/** Metres the plate's shadow reaches past the rim; the quad must cover it. */
const FEATHER = 0.4;
const quadExtent = (radius: number) => radius + PAD + FEATHER + 0.05;
const GHOST_OPACITY = 0.45;

const plateMaterial = (color: number, radius: number) => new THREE.ShaderMaterial({
  uniforms: {
    color: { value: new THREE.Color(color) },
    radius: { value: radius },
    /** 0 draws a selection plate, 1 adds the placement grid. */
    grid: { value: 0 },
    /** 0 draws the grid as dots, 1 as crosses. */
    blocked: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vLocal;
    varying vec2 vWorld;
    varying vec2 vCentre;
    void main() {
      vLocal = position.xz;
      vWorld = (modelMatrix * vec4(position, 1.0)).xz;
      vCentre = modelMatrix[3].xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform float radius;
    uniform float grid;
    uniform float blocked;
    varying vec2 vLocal;
    varying vec2 vWorld;
    varying vec2 vCentre;

    const vec3 PLATE = vec3(0.012, 0.008, 0.005);
    const float RIM_HALF_WIDTH = 0.03;
    // The plate is darkest in a band this deep inside the rim and thins toward the centre, so a
    // unit gets a full contact shadow while a Command Center's disc does not read as a hole.
    const float BAND = 1.5;
    const float CORE_ALPHA = 0.14;
    const float EDGE_ALPHA = 0.46;
    // The ground direction toward the sun (SUN_OFFSET in main.ts). The rim's sunward lip shades
    // the plate below it, which is what makes the disc read as pressed in rather than painted on.
    const vec2 TO_SUN = vec2(-0.845, 0.534);
    const float LIP_SHADE = 0.35;

    float coverage(float d) {
      float aa = fwidth(d) * 0.5;
      return 1.0 - smoothstep(-aa, aa, d);
    }

    // One mark per world metre, kept only where the whole mark fits inside the rim. The grid is
    // fixed to the world, so it holds still while the cursor moves over it. Marks deeper than the
    // plate's band are faint, so they do not speckle the ghost standing over them.
    float gridMark(float rim) {
      vec2 cell = floor(vWorld) + 0.5;
      float depth = rim - length(cell - vCentre);
      if (depth < 0.3) return 0.0;
      vec2 q = abs(vWorld - cell);
      float dotShape = length(q) - 0.07;
      // World axes run along the screen's diagonals, so this plus sign shows as an X.
      float cross = max(min(q.x, q.y) - 0.04, max(q.x, q.y) - 0.2);
      return coverage(mix(dotShape, cross, blocked)) * mix(0.85, 0.3, smoothstep(BAND, BAND + 1.0, depth));
    }

    void main() {
      float rim = radius + ${PAD.toFixed(2)};
      float d = length(vLocal) - rim;
      float sunward = dot(normalize(vWorld - vCentre + 1e-5), TO_SUN);
      float inside = mix(CORE_ALPHA, EDGE_ALPHA * (1.0 + LIP_SHADE * sunward), smoothstep(-BAND, 0.0, d));
      float plate = inside * (1.0 - smoothstep(0.0, ${FEATHER.toFixed(2)}, d));
      // Never thinner than a pixel, so the rim holds when the camera pulls back.
      float line = coverage(abs(d) - max(RIM_HALF_WIDTH, fwidth(d) * 0.5)) * 0.95;
      if (grid > 0.5) line = max(line, gridMark(rim));
      float alpha = line + plate * (1.0 - line);
      if (alpha <= 0.002) discard;
      gl_FragColor = vec4((color * line + PLATE * plate * (1.0 - line)) / alpha, alpha);
      #include <colorspace_fragment>
    }`,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/** A flat square of half-size `extent` at y = 0, ready for `placeGroundGeometry`. */
const groundQuad = (extent: number) => new THREE.PlaneGeometry(extent * 2, extent * 2).rotateX(-Math.PI / 2);

const plate = (color: number, radius: number, extent: number) => {
  const mesh = new THREE.Mesh(groundQuad(extent), plateMaterial(color, radius));
  prepareGroundOverlay(mesh);
  return mesh;
};

/**
 * Turns a building model into its ghost, the real materials seen through, and returns each
 * material with its own colour so the caller can tint it. A depth-only copy of each mesh is drawn first, so only
 * the model's front surfaces show and its inner faces do not pile up.
 */
const ghostOf = (model: THREE.Object3D) => {
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  const meshes: THREE.Mesh[] = [];
  model.traverse((child) => {
    if (child instanceof THREE.Mesh && !child.userData.selectionOverlay) meshes.push(child);
  });
  return meshes.map((mesh) => {
    const depth = mesh.clone(false);
    depth.material = depthOnly;
    // Drawn after the world's solid things, so the ghost never hides a unit standing behind it.
    depth.renderOrder = mesh.renderOrder = 1000;
    depth.castShadow = mesh.castShadow = false;
    mesh.parent?.add(depth);
    // The model's materials are shared with the real buildings, so the ghost edits its own copies.
    const material = new THREE.MeshStandardMaterial().copy(mesh.material as THREE.MeshStandardMaterial);
    material.transparent = true;
    material.opacity = GHOST_OPACITY;
    material.depthWrite = false;
    mesh.material = material;
    return { material, base: material.color.clone() };
  });
};

export const optionC: MarkerOption = {
  selection({ radius, color }) {
    const mesh = plate(color, radius, quadExtent(radius));
    mesh.name = "Selection ring";
    mesh.userData.selectionOverlay = true;
    mesh.visible = false;
    return mesh;
  },
  placement(ghost) {
    const object = new THREE.Group();
    object.name = "Construction placement";
    const footprint = plate(UI_SELECTION_COLOR, 1, 1);
    footprint.material.uniforms.grid.value = 1;
    object.add(footprint);
    const ghosts = new Map<string, THREE.Object3D>();
    const parts: ReturnType<typeof ghostOf> = [];
    const tint = new THREE.Color();
    const applyTint = () => {
      for (const { material, base } of parts) material.color.copy(base).multiply(tint);
    };
    let shown: THREE.Object3D | undefined;
    return {
      object,
      show({ kind, groundY, radius, valid }: PlacementState) {
        const { uniforms } = footprint.material;
        uniforms.color.value.setHex(valid ? UI_SELECTION_COLOR : UI_ATTACK_COLOR);
        uniforms.radius.value = radius;
        uniforms.blocked.value = valid ? 0 : 1;
        placeGroundGeometry(footprint.geometry, groundY, quadExtent(radius));
        // A valid ghost keeps the building's own colours; a blocked one is washed red.
        tint.setHex(valid ? 0xffffff : UI_ATTACK_COLOR);
        applyTint();
        if (!ghosts.has(kind)) {
          const holder = new THREE.Group();
          ghosts.set(kind, holder);
          void ghost(kind).then((model) => {
            parts.push(...ghostOf(model));
            applyTint();
            holder.add(model);
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
};
