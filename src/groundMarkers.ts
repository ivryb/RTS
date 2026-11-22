import * as THREE from "three";
import { BUILDING_CATALOG } from "./buildingCatalog";
import { placeGroundGeometry, prepareGroundOverlay } from "./groundOverlay";
import { BUILDING_DEFINITIONS } from "./sim/construction";
import type { BuildingKind } from "./sim/units";
import { UI_ATTACK_COLOR, UI_SELECTION_COLOR } from "./uiColors";

/**
 * The Reticle, the one language of every marker on the ground (docs/ground_markers.md): a ring
 * broken into four bracket arcs whose gaps face screen-up, -down, -left and -right. A selection
 * marker is the brackets alone, a unit's only the near two; the placement cursor adds the
 * building's ghost and a measured ring on its footprint.
 */

/**
 * From a selected footprint to the centre line of its brackets. A unit's brackets sit on its body
 * radius with no pad: any wider and the brackets of a tight squad join into one wavy line.
 */
const PAD = 0.1;
/**
 * From a placement's footprint ring to the centre line of the brackets that frame it. Wider than
 * PAD: at 0.1 m the brackets and the ring are two pixels apart and merge into one uneven line.
 */
const FRAME = 0.3;
/** How far the drawing reaches past the bracket line: stroke and keyline, or the cardinal ticks. */
const SELECTION_MARGIN = 0.15;
const PLACEMENT_MARGIN = 0.4;

const reticleLook = (color: number, radius: number, nearOnly = false) => ({
  color: { value: new THREE.Color(color) },
  /** Centre line of the brackets. */
  radius: { value: radius },
  /** Draws only the two brackets on the camera's side. */
  nearOnly: { value: nearOnly },
  /** The measured ring of a placement cursor; 0 on selection markers. */
  footprint: { value: 0 },
  blocked: { value: false },
});

const reticleVertexShader = /* glsl */ `
  varying vec2 vGround;
  void main() {
    // Offset from the marker's centre along screen-right and screen-up on the ground, so a
    // marker looks the same whichever way its unit or building faces.
    vec2 right = normalize(vec2(viewMatrix[0][0], viewMatrix[2][0]));
    vec2 offset = (modelMatrix * vec4(position.x, 0.0, position.z, 0.0)).xz;
    vGround = vec2(dot(offset, right), dot(offset, vec2(right.y, -right.x)));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Widths are in metres and the same on every marker, whatever its radius.
const reticleFragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform float radius;
  uniform bool nearOnly;
  uniform float footprint;
  uniform bool blocked;
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
    float stroke = max(abs(r - radius) - STROKE, pastEnd);
    // The ends turn in towards the target by 3% of the radius: a clear hook on a building,
    // nothing on a unit, where it would only thicken the ends into blobs.
    float turnIn = min(0.14, radius * 0.03);
    float turn = max(abs(pastEnd + STROKE) - STROKE, max(radius - turnIn - r, r - radius));
    float d = min(stroke, turn);
    // vGround.y grows away from the camera.
    if (nearOnly) d = max(d, vGround.y);
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
      if (blocked) {
        ink = max(ink, max(cover(ring, 0.0) * 0.9, cover(hatching(r), 0.0) * 0.8));
      } else {
        vec2 tick = ticks();
        ink = max(ink, max(cover(ring, 0.0), cover(tick, 0.0)) * 0.9);
        shade = max(shade, cover(tick, KEYLINE * 0.6) * 0.3);
      }
      shade = max(shade, cover(ring, KEYLINE * 0.6) * 0.3);
      // A faint shadow where the building will stand, darker when blocked: the hatched disc
      // then differs from the open ring in brightness too, not only in hue.
      shade = max(shade, cover(vec2(r - footprint, pixel), 0.0) * (blocked ? 0.34 : 0.2));
    }
    float alpha = ink + shade * (1.0 - ink);
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(mix(DARK, color, ink / alpha), alpha);
    #include <colorspace_fragment>
  }`;

/** A flat square of half-size `extent` that the reticle shader draws on, a step above y = 0. */
const reticleMesh = (extent: number, look: ReturnType<typeof reticleLook>) => {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(extent * 2, extent * 2).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: look,
      vertexShader: reticleVertexShader,
      fragmentShader: reticleFragmentShader,
      side: THREE.DoubleSide,
    }),
  );
  prepareGroundOverlay(mesh);
  placeGroundGeometry(mesh.geometry, 0);
  return mesh;
};

/**
 * The marker of a selected unit, building or Titanium Deposit, hidden until it is selected. Add
 * it to the thing's root, which stands on the ground, and switch `visible`. `radius` is the
 * unit's body or the footprint, in metres; `color` is off-white for the local player and for
 * resources, red for the enemy.
 *
 * A unit stands on its marker, so it gets only the two near brackets: the far two hide behind
 * its body and, in a squad, tangle with the unit behind.
 */
export const createSelectionMarker = (target: "unit" | "footprint", radius: number, color = UI_SELECTION_COLOR) => {
  const brackets = target === "unit" ? radius : radius + PAD;
  const marker = reticleMesh(brackets + SELECTION_MARGIN, reticleLook(color, brackets, target === "unit"));
  marker.name = "Selection ring";
  marker.userData.selectionOverlay = true;
  marker.visible = false;
  return marker;
};

const ghostVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vNormal = mat3(modelMatrix) * normal;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const ghostFragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 tint;
  uniform float opacity;
  varying vec3 vNormal;
  varying vec2 vUv;
  // Where the match's sun stands.
  const vec3 SUN = vec3(-0.52, 0.79, 0.33);
  void main() {
    // The model's own panels, windows and seams as light and dark, in the state's colour.
    float panel = smoothstep(0.0, 0.35, dot(texture2D(map, vUv).rgb, vec3(0.2126, 0.7152, 0.0722)));
    float light = 0.45 + 0.55 * max(dot(normalize(vNormal), SUN), 0.0);
    gl_FragColor = vec4(tint * light * mix(0.4, 1.0, panel), opacity);
    #include <colorspace_fragment>
  }`;

/**
 * Writes only depth, before the ghost's skin draws: without it the far walls and the inside of
 * the model show through the near ones and the ghost reads as a tangle.
 */
const ghostDepthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true });

/** The state's colour and how solid the ghost is, shared by every skin of one cursor. */
const ghostLook = () => ({ tint: { value: new THREE.Color() }, opacity: { value: 0 } });

/** Turns a building's model into its ghost. Its meshes get their own materials; the shared ones are left alone. */
const dressAsGhost = (model: THREE.Object3D, look: ReturnType<typeof ghostLook>) => {
  // The ghost must not answer to the building's name: tools and tests find buildings by it.
  model.name = "Placement ghost";
  const meshes: THREE.Mesh[] = [];
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  for (const mesh of meshes) {
    const map = mesh.material instanceof THREE.MeshStandardMaterial ? mesh.material.map : null;
    mesh.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, ...look },
      vertexShader: ghostVertexShader,
      fragmentShader: ghostFragmentShader,
      transparent: true,
    });
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;
    const depth = new THREE.Mesh(mesh.geometry, ghostDepthMaterial);
    depth.renderOrder = 1;
    mesh.add(depth);
  }
  return model;
};

/** Resolves to a model of the building that the cursor may dress as it likes, or nothing when the match has no models. */
export type GhostModelLoader = (kind: BuildingKind) => THREE.Object3D | Promise<THREE.Object3D> | undefined;

/**
 * The cursor that follows the pointer while the player places a building: its ghost, a measured
 * ring on the footprint the placement rules test, and the brackets that frame it. Blocked turns
 * it red and hatches the footprint. Add it to the world once; `show` moves it, `visible = false`
 * puts it away.
 */
export class PlacementCursor extends THREE.Group {
  private readonly reticleLook = reticleLook(UI_SELECTION_COLOR, 1);
  private readonly reticle = reticleMesh(1, this.reticleLook);
  private readonly ghostLook = ghostLook();
  private readonly ghosts = new Map<BuildingKind, THREE.Group>();

  constructor(private readonly loadModel: GhostModelLoader) {
    super();
    this.name = "Construction placement";
    this.visible = false;
    this.add(this.reticle);
  }

  /** `ground` is the point on the terrain under the pointer, where the building would stand. */
  show(kind: BuildingKind, ground: THREE.Vector3Like, valid: boolean) {
    const footprint = BUILDING_DEFINITIONS[kind].radius;
    const color = valid ? UI_SELECTION_COLOR : UI_ATTACK_COLOR;
    this.position.copy(ground);
    this.reticleLook.color.value.setHex(color);
    this.reticleLook.radius.value = footprint + FRAME;
    this.reticleLook.footprint.value = footprint;
    this.reticleLook.blocked.value = !valid;
    placeGroundGeometry(this.reticle.geometry, 0, footprint + FRAME + PLACEMENT_MARGIN);
    // A blocked ghost keeps a little of the valid one's pale cast and turns more solid, so the
    // model still reads over the red hatching under it.
    this.ghostLook.tint.value.setHex(UI_SELECTION_COLOR).lerp(this.reticleLook.color.value, 0.85);
    this.ghostLook.opacity.value = valid ? 0.45 : 0.6;
    const shown = this.ghost(kind);
    for (const ghost of this.ghosts.values()) ghost.visible = ghost === shown;
    this.visible = true;
  }

  private ghost(kind: BuildingKind) {
    const existing = this.ghosts.get(kind);
    if (existing) return existing;
    const ghost = new THREE.Group();
    ghost.rotation.y = BUILDING_CATALOG[kind].defaultRotation;
    this.ghosts.set(kind, ghost);
    this.add(ghost);
    // A model that fails to load leaves the reticle alone, which still places the building.
    void Promise.resolve(this.loadModel(kind)).then(
      (model) => { if (model) ghost.add(dressAsGhost(model, this.ghostLook)); },
      () => {},
    );
    return ghost;
  }
}
