import * as THREE from "three";
import { BUILDING_CATALOG } from "../buildingCatalog";
import { placeGroundGeometry, prepareGroundOverlay } from "../groundOverlay";
import { UI_ATTACK_COLOR, UI_SELECTION_COLOR } from "../uiColors";
import type { MarkerOption, PlacementState } from "./index";
import { groundQuad } from "./stub";

/**
 * Option B, "Reticle": every marker is a ring broken into four bracket arcs whose gaps face
 * screen-up, -down, -left and -right, the round cousin of the attack brackets in `orderMarker.ts`.
 * Placement adds a fine measured ring on the real footprint and a ghost of the building.
 */

/** From a selected thing's radius to the centre line of its brackets. */
const PAD = 0.1;
/** From a placement's footprint ring to the centre line of the brackets that frame it. */
const FRAME = 0.3;
/** How far the drawing reaches past the bracket line: stroke and keyline, or the cardinal ticks. */
const SELECTION_MARGIN = 0.15;
const PLACEMENT_MARGIN = 0.4;

const reticleMaterial = (color: number, radius: number) => new THREE.ShaderMaterial({
  uniforms: {
    color: { value: new THREE.Color(color) },
    /** Centre line of the brackets. */
    radius: { value: radius },
    /** The measured ring of a placement cursor; 0 on selection markers. */
    footprint: { value: 0 },
    blocked: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vGround;
    void main() {
      // Offset from the marker's centre along screen-right and screen-up on the ground, so a
      // marker looks the same whichever way its unit or building faces.
      vec2 right = normalize(vec2(viewMatrix[0][0], viewMatrix[2][0]));
      vec2 offset = (modelMatrix * vec4(position.x, 0.0, position.z, 0.0)).xz;
      vGround = vec2(dot(offset, right), dot(offset, vec2(right.y, -right.x)));
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform float radius;
    uniform float footprint;
    uniform float blocked;
    varying vec2 vGround;

    const float PI = 3.14159265;
    const float STROKE = 0.045;       // half-width of a bracket
    const float FINE = 0.024;         // half-width of the measured ring, its ticks and the hatching
    const float KEYLINE = 0.05;       // dark edge that keeps off-white readable on bright sand
    const float ARC = 0.56;           // half-angle of a bracket, leaving gaps of about 26 degrees
    const float TICK_STEP = PI / 12.0;
    const float HATCH_STEP = 0.62;
    const vec3 DARK = vec3(0.012, 0.01, 0.008);

    // A shape is (signed distance, negative inside; ground distance one screen pixel covers).
    float cover(vec2 shape, float grow) { return clamp(0.5 - (shape.x - grow) / shape.y, 0.0, 1.0); }
    // A fine line around d = 0 that never gets thinner than a pixel.
    float fine(float d, float pixel) { return abs(d) - max(FINE, pixel * 0.5); }
    // The pixel size across a line with unit normal n. Repeating patterns need it spelled out:
    // fwidth() of their distance spikes where the repeat wraps and leaves dotted seams.
    float pixelAcross(vec2 n) { return dot(abs(n), fwidth(vGround)); }

    vec2 brackets(float r) {
      vec2 p = abs(vGround);
      // q.x runs along the nearest screen diagonal, q.y away from it.
      vec2 q = vec2(p.x + p.y, abs(p.x - p.y)) * 0.7071;
      float pastEnd = dot(q, vec2(-sin(ARC), cos(ARC)));
      float arc = max(abs(r - radius) - STROKE, pastEnd);
      // The ends turn in towards the target by 3% of the radius: a clear hook on a building,
      // nothing on a unit, where it would only thicken the ends into blobs.
      float turnIn = min(0.14, radius * 0.03);
      float turn = max(abs(pastEnd + STROKE) - STROKE, max(radius - turnIn - r, r - radius));
      float d = min(arc, turn);
      return vec2(d, fwidth(d));
    }

    // Ticks every 15 degrees inside the footprint; the four on the screen axes reach out through
    // the bracket gaps like a crosshair.
    vec2 ticks() {
      float index = floor(atan(vGround.y, vGround.x) / TICK_STEP + 0.5);
      float angle = index * TICK_STEP;
      vec2 dir = vec2(cos(angle), sin(angle));
      vec2 side = vec2(-dir.y, dir.x);
      float along = dot(vGround, dir);
      float cardinal = step(abs(mod(index + 3.0, 6.0) - 3.0), 0.5);
      float inner = footprint - mix(0.16, 0.34, cardinal);
      float outer = mix(footprint, radius + 0.3, cardinal);
      float pixel = pixelAcross(side);
      return vec2(max(fine(dot(vGround, side), pixel), max(inner - along, along - outer)), pixel);
    }

    // Diagonal lines across the footprint, stopping just short of its ring.
    vec2 hatching(float r) {
      float pixel = pixelAcross(vec2(0.7071));
      float across = (vGround.x + vGround.y) * 0.7071;
      float d = fine(mod(across, HATCH_STEP) - HATCH_STEP * 0.5, pixel);
      return vec2(max(d, r - footprint + 0.12), pixel);
    }

    void main() {
      float r = length(vGround);
      vec2 bracket = brackets(r);
      float ink = cover(bracket, 0.0) * 0.92;
      float shade = cover(bracket, KEYLINE) * 0.42;
      if (footprint > 0.0) {
        float pixel = fwidth(r);
        vec2 ring = vec2(fine(r - footprint, pixel), pixel);
        if (blocked > 0.5) {
          ink = max(ink, max(cover(ring, 0.0) * 0.9, cover(hatching(r), 0.0) * 0.8));
        } else {
          vec2 tick = ticks();
          ink = max(ink, max(cover(ring, 0.0), cover(tick, 0.0)) * 0.9);
          shade = max(shade, cover(tick, KEYLINE * 0.6) * 0.3);
        }
        shade = max(shade, cover(ring, KEYLINE * 0.6) * 0.3);
        // A faint shadow where the building will stand, darker when blocked: the hatched disc
        // then differs from the open ring in brightness too, not only in hue.
        shade = max(shade, cover(vec2(r - footprint, pixel), 0.0) * mix(0.2, 0.34, blocked));
      }
      float alpha = ink + shade * (1.0 - ink);
      if (alpha <= 0.0) discard;
      gl_FragColor = vec4(mix(DARK, color, ink / alpha), alpha);
      #include <colorspace_fragment>
    }`,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/** A shaded, single-colour hologram of the building, so the ghost keeps the model's form. */
const ghostMaterial = () => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(UI_SELECTION_COLOR) }, opacity: { value: 0.5 } },
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    void main() {
      vNormal = normalMatrix * normal;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform float opacity;
    varying vec3 vNormal;
    void main() {
      vec3 normal = normalize(gl_FrontFacing ? vNormal : -vNormal);
      // Lit from the upper left of the screen, with more contrast than real light: at half
      // opacity over sand a gentle shade washes out to a flat silhouette.
      float lit = smoothstep(0.1, 0.95, 0.5 + 0.5 * dot(normal, normalize(vec3(-0.55, 0.7, 0.45))));
      // Faint scanlines three pixels apart mark it as a projection, not a building.
      float scan = 0.88 + 0.12 * cos(gl_FragCoord.y * 2.0944);
      gl_FragColor = vec4(color * mix(0.3, 1.0, lit), opacity * scan);
      #include <colorspace_fragment>
    }`,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/**
 * Writes only depth, before the ghost draws: without it the far walls and the inside of the model
 * show through the near ones and the ghost reads as a tangle.
 */
const ghostDepthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, side: THREE.DoubleSide });

const dress = (model: THREE.Object3D, material: THREE.Material, renderOrder: number) => {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = material;
    child.castShadow = false;
    child.receiveShadow = false;
    child.renderOrder = renderOrder;
  });
  return model;
};

export const optionB: MarkerOption = {
  selection({ radius, color }) {
    const mesh = new THREE.Mesh(groundQuad(radius + PAD + SELECTION_MARGIN), reticleMaterial(color, radius + PAD));
    mesh.name = "Selection ring";
    mesh.userData.selectionOverlay = true;
    prepareGroundOverlay(mesh);
    mesh.visible = false;
    return mesh;
  },
  placement(ghost) {
    const object = new THREE.Group();
    object.name = "Construction placement";
    const reticle = new THREE.Mesh(groundQuad(1), reticleMaterial(UI_SELECTION_COLOR, 1));
    prepareGroundOverlay(reticle);
    object.add(reticle);
    const hologram = ghostMaterial();
    const ghosts = new Map<string, THREE.Group>();
    let shown: THREE.Group | undefined;
    return {
      object,
      show({ kind, groundY, radius, valid }: PlacementState) {
        const color = valid ? UI_SELECTION_COLOR : UI_ATTACK_COLOR;
        const { uniforms } = reticle.material;
        uniforms.color.value.setHex(color);
        uniforms.radius.value = radius + FRAME;
        uniforms.footprint.value = radius;
        uniforms.blocked.value = valid ? 0 : 1;
        placeGroundGeometry(reticle.geometry, groundY, radius + FRAME + PLACEMENT_MARGIN);
        hologram.uniforms.color.value.setHex(color);
        // A blocked ghost steps back so whatever is in the way stays visible through it.
        hologram.uniforms.opacity.value = valid ? 0.5 : 0.42;
        if (!ghosts.has(kind)) {
          const holder = new THREE.Group();
          ghosts.set(kind, holder);
          void ghost(kind).then((model) => {
            holder.add(dress(model.clone(), ghostDepthMaterial, 1), dress(model, hologram, 2));
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
