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

/**
 * A selection marker's brackets start wider than rest and close in, with no bounce. The curve
 * covers nine tenths of the way in the first 55 ms; the rest of the time is a soft settle.
 */
const APPEAR_MS = 150;
/**
 * The wider start, as a share of the bracket radius, and its least in metres: 15% of a unit's
 * marker is two pixels at the default zoom, too little to see, and much more tangles a squad.
 */
const APPEAR_SPREAD = 0.15;
const APPEAR_MIN_SPREAD = 0.16;
/** How faint the brackets are on their first frame; they reach full strength as they close. */
const APPEAR_OPACITY = 0.45;
/** The blocked look's sweep across a placement cursor, and its quicker retreat. */
const BLOCK_MS = 160;
const UNBLOCK_MS = 100;

declare global {
  /** Milliseconds. A capture sets it to step marker motion frame by frame; unset in play. */
  var __markerClock: number | undefined;
}

const now = () => globalThis.__markerClock ?? performance.now();
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
/** How far a motion that began at `start` has come, 0 to 1; reduced motion skips to the end. */
const progress = (start: number, duration: number) =>
  reducedMotion?.matches ? 1 : THREE.MathUtils.clamp((now() - start) / duration, 0, 1);
/** The strong UI ease-out, cubic-bezier(0.23, 1, 0.32, 1), in its closed form. */
const easeOut = (t: number) => 1 - (1 - t) ** 5;

/**
 * Reports whether a mesh is being drawn for the first time after a frame without it, so a marker
 * knows it has just been shown without the game telling it. Counts frames, not time: a slow
 * machine draws every frame late and would otherwise restart the motion on each one.
 */
const appearance = () => {
  let last = -2;
  return (renderer: THREE.WebGLRenderer) => {
    const { frame } = renderer.info.render;
    const appeared = frame - last > 1;
    last = frame;
    return appeared;
  };
};

/**
 * The blocked look crosses a placement cursor from the screen's upper left to its lower right
 * behind one straight, slightly soft front. `along` is a point's ground distance from the
 * cursor's centre in that direction; the result is how blocked that point looks, 0 to 1.
 */
const SWEEP = /* glsl */ `
    uniform float blocked;
    uniform float reach;
    uniform vec3 blockedColor;

    float swept(float along) {
      float soft = reach * 0.3;
      float behind = clamp((mix(-reach, reach + soft, blocked) - along) / soft, 0.0, 1.0);
      // At rest even what pokes out past the reach is wholly in one state.
      return blocked <= 0.0 ? 0.0 : blocked >= 1.0 ? 1.0 : behind;
    }`;

const reticleMaterial = (color: number, radius: number) => new THREE.ShaderMaterial({
  uniforms: {
    color: { value: new THREE.Color(color) },
    blockedColor: { value: new THREE.Color(UI_ATTACK_COLOR) },
    /** Centre line of the brackets. */
    radius: { value: radius },
    /** The measured ring of a placement cursor; 0 on selection markers. */
    footprint: { value: 0 },
    /** 0 while a placement is valid, 1 once blocked; in between the blocked look is sweeping in. */
    blocked: { value: 0 },
    /** How far from its centre a placement cursor draws: where the sweep starts and ends. */
    reach: { value: 0 },
    opacity: { value: 1 },
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
    uniform float opacity;
    varying vec2 vGround;
    ${SWEEP}

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
      float sweep = 0.0;
      if (footprint > 0.0) {
        float pixel = fwidth(r);
        vec2 ring = vec2(fine(r - footprint, pixel), pixel);
        // Ahead of the sweep's front the cursor is valid, with ticks; behind it blocked, with hatching.
        sweep = swept((vGround.x - vGround.y) * 0.7071);
        vec2 tick = ticks();
        float ticked = 1.0 - sweep;
        ink = max(ink, max(cover(ring, 0.0), cover(tick, 0.0) * ticked) * 0.9);
        ink = max(ink, cover(hatching(r), 0.0) * sweep * 0.8);
        shade = max(shade, cover(tick, KEYLINE * 0.6) * ticked * 0.3);
        shade = max(shade, cover(ring, KEYLINE * 0.6) * 0.3);
        // A faint shadow where the building will stand, darker when blocked: the hatched disc
        // then differs from the open ring in brightness too, not only in hue.
        shade = max(shade, cover(vec2(r - footprint, pixel), 0.0) * mix(0.2, 0.34, sweep));
      }
      float alpha = ink + shade * (1.0 - ink);
      if (alpha <= 0.0) discard;
      gl_FragColor = vec4(mix(DARK, mix(color, blockedColor, sweep), ink / alpha), alpha * opacity);
      #include <colorspace_fragment>
    }`,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/**
 * A shaded, single-colour hologram of the building, so the ghost keeps the model's form. It takes
 * the reticle's own sweep uniforms, so the blocked look crosses both as one front.
 */
const ghostMaterial = (sweep: Record<"blocked" | "reach" | "blockedColor", THREE.IUniform>) => new THREE.ShaderMaterial({
  uniforms: {
    ...sweep,
    color: { value: new THREE.Color(UI_SELECTION_COLOR) },
    /** The cursor's centre on the ground, world x and z. */
    centre: { value: new THREE.Vector2() },
  },
  vertexShader: /* glsl */ `
    uniform vec2 centre;
    varying vec3 vNormal;
    varying float vAlong;
    void main() {
      vNormal = normalMatrix * normal;
      // The same screen-aligned ground offset the reticle measures its sweep along.
      vec2 right = normalize(vec2(viewMatrix[0][0], viewMatrix[2][0]));
      vec2 offset = (modelMatrix * vec4(position, 1.0)).xz - centre;
      vAlong = (dot(offset, right) - dot(offset, vec2(right.y, -right.x))) * 0.7071;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    varying vec3 vNormal;
    varying float vAlong;
    ${SWEEP}
    void main() {
      vec3 normal = normalize(gl_FrontFacing ? vNormal : -vNormal);
      // Lit from the upper left of the screen, with more contrast than real light: at half
      // opacity over sand a gentle shade washes out to a flat silhouette.
      float lit = smoothstep(0.1, 0.95, 0.5 + 0.5 * dot(normal, normalize(vec3(-0.55, 0.7, 0.45))));
      // Faint scanlines three pixels apart mark it as a projection, not a building.
      float scan = 0.88 + 0.12 * cos(gl_FragCoord.y * 2.0944);
      float sweep = swept(vAlong);
      // A blocked ghost steps back so whatever is in the way stays visible through it.
      gl_FragColor = vec4(mix(color, blockedColor, sweep) * mix(0.3, 1.0, lit), mix(0.5, 0.42, sweep) * scan);
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
    const rest = radius + PAD;
    const spread = Math.max(rest * APPEAR_SPREAD, APPEAR_MIN_SPREAD);
    const mesh = new THREE.Mesh(groundQuad(rest + spread + SELECTION_MARGIN), reticleMaterial(color, rest));
    mesh.name = "Selection ring";
    mesh.userData.selectionOverlay = true;
    prepareGroundOverlay(mesh);
    mesh.visible = false;
    // Drawn whenever selected, even off screen, so panning back to it does not replay the motion.
    mesh.frustumCulled = false;
    const appeared = appearance();
    let shownAt = 0;
    mesh.onBeforeRender = (renderer) => {
      if (appeared(renderer)) shownAt = now();
      const open = 1 - easeOut(progress(shownAt, APPEAR_MS));
      const { uniforms } = mesh.material;
      uniforms.radius.value = rest + spread * open;
      uniforms.opacity.value = 1 - (1 - APPEAR_OPACITY) * open;
    };
    return mesh;
  },
  placement(ghost) {
    const object = new THREE.Group();
    object.name = "Construction placement";
    const reticle = new THREE.Mesh(groundQuad(1), reticleMaterial(UI_SELECTION_COLOR, 1));
    prepareGroundOverlay(reticle);
    object.add(reticle);
    const { uniforms } = reticle.material;
    const hologram = ghostMaterial({ blocked: uniforms.blocked, reach: uniforms.reach, blockedColor: uniforms.blockedColor });
    const ghosts = new Map<string, THREE.Group>();
    let shown: THREE.Group | undefined;
    // `blocked` runs from where it stood when validity last flipped to its new end, so a flip
    // in the middle of a sweep turns it around without a jump.
    const flip = { from: 0, to: 0, at: 0 };
    const blockedNow = () =>
      THREE.MathUtils.lerp(flip.from, flip.to, easeOut(progress(flip.at, flip.to ? BLOCK_MS : UNBLOCK_MS)));
    const appeared = appearance();
    reticle.onBeforeRender = (renderer) => {
      // A cursor that appears already blocked shows it at once; only a change while shown moves.
      if (appeared(renderer)) flip.from = flip.to;
      uniforms.blocked.value = blockedNow();
      const { elements } = reticle.matrixWorld;
      hologram.uniforms.centre.value.set(elements[12], elements[14]);
    };
    return {
      object,
      show({ kind, groundY, radius, valid }: PlacementState) {
        const blocked = valid ? 0 : 1;
        if (blocked !== flip.to) Object.assign(flip, { from: blockedNow(), to: blocked, at: now() });
        const reach = radius + FRAME + PLACEMENT_MARGIN;
        uniforms.radius.value = radius + FRAME;
        uniforms.footprint.value = radius;
        uniforms.reach.value = reach;
        placeGroundGeometry(reticle.geometry, groundY, reach);
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
