import * as THREE from "three";
import { BUILDING_CATALOG } from "../buildingCatalog";
import { placeGroundGeometry, prepareGroundOverlay } from "../groundOverlay";
import { UI_ATTACK_COLOR, UI_SELECTION_COLOR } from "../uiColors";
import type { MarkerOption, PlacementState } from "./index";
import { groundQuad } from "./stub";

/**
 * Option D, "Octagon": every marker is the octagon of the Command Center and the construction
 * deck. A selection is a thin outline with heavier corners. A placement adds the building's ghost,
 * a faint fill and a fine inner rule; when it is blocked, hazard stripes fill the tray between
 * the outline and that rule.
 */

/** Metres between the radius a marker is given and its outline, so the outline never cuts the model. */
const PAD = 0.12;
/** Half-size of the square that holds an octagon of that radius, at any turn, with its corners. */
const extent = (radius: number) => (radius + PAD) / Math.cos(Math.PI / 8) + 0.2;

const vertexShader = /* glsl */ `
varying vec2 vWorld;
void main() {
  // A marker turns with its unit or building. Undo the turn, so every octagon's flats line up on screen.
  vWorld = position.x * normalize(modelMatrix[0].xz) + position.z * normalize(modelMatrix[2].xz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Widths are in metres and the same for every marker, whatever its radius.
const fragmentShader = /* glsl */ `
uniform vec3 color;
uniform float apothem;
uniform float pad;
uniform float blocked;
varying vec2 vWorld;

const float HALF_SIDE = 0.41421356;
const float EIGHTH = 0.78539816;
const vec3 DARK = vec3(0.012, 0.009, 0.007);

float cover(float distance, float blur) { return clamp(0.5 - distance / blur, 0.0, 1.0); }
vec4 over(vec4 under, vec3 tint, float alpha) { return vec4(tint * alpha, alpha) + under * (1.0 - alpha); }

void main() {
  // The nearest of the eight sides: "outside" is metres beyond it, "along" runs down its length.
  float turn = floor(atan(vWorld.y, vWorld.x) / EIGHTH + 0.5) * EIGHTH;
  vec2 normal = vec2(cos(turn), sin(turn));
  float reach = dot(vWorld, normal);
  float along = dot(vWorld, vec2(-normal.y, normal.x));
  float outside = reach - apothem;
  float halfSide = apothem * HALF_SIDE;
  float blur = length(fwidth(vWorld)) * 0.75;
  vec4 paint = vec4(0.0);

  if (pad > 0.5) {
    paint = over(paint, color, cover(outside, blur) * mix(0.05, 0.1, blocked));
    // A tray runs inside the outline, closed by a fine rule. It narrows on a small pad, so a
    // Turret's is not all tray. "depth" is metres into the tray from its outer edge.
    float width = min(0.62, apothem * 0.18);
    float depth = -outside - 0.18;
    paint = over(paint, color, cover(abs(depth - width) - 0.02, blur) * 0.55);
    // Hazard stripes fill the tray only when the placement is blocked. A whole number of stripes
    // per side, counted by angle, so they meet at every corner. Their lean flips from one quarter
    // to the next, which mirrors the pattern left to right on screen; one lean all the way round
    // lies flat along two of the sides under the tilted camera.
    float band = cover(-depth, blur) * cover(depth - width + 0.02, blur) * blocked;
    float count = max(1.0, floor(2.0 * halfSide / 0.6 + 0.5));
    float lean = 1.0 - mod(floor(atan(vWorld.y, vWorld.x) / (2.0 * EIGHTH) + 0.5), 2.0) * 2.0;
    float turns = lean * along / (2.0 * reach * HALF_SIDE) + depth / (2.0 * halfSide);
    float wave = abs(fract(count * turns) - 0.5) * 2.0;
    float stripe = cover((wave - 0.5) * halfSide / count * 0.7, blur);
    paint = over(paint, DARK, band * 0.8);
    paint = over(paint, color, band * stripe * 0.95);
  }

  // The outline grows heavier for a short tick either side of each corner. On a small octagon a
  // tick is only a dot, so its weight fades out as the side gets short: a unit's outline is plain.
  float tick = min(halfSide * 0.3, 0.6);
  float corner = cover(halfSide - abs(along) - tick, blur) * smoothstep(0.12, 0.4, tick);
  float halfWidth = 0.04 + 0.04 * corner;
  paint = over(paint, DARK, cover(abs(outside) - halfWidth - 0.04, blur) * 0.3);
  paint = over(paint, color, cover(abs(outside) - halfWidth, blur) * 0.9);

  if (paint.a < 0.004) discard;
  gl_FragColor = vec4(paint.rgb / paint.a, paint.a);
  #include <colorspace_fragment>
}`;

const octagon = (color: number, radius: number, pad: boolean) => {
  const mesh = new THREE.Mesh(groundQuad(pad ? 1 : extent(radius)), new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      apothem: { value: radius + PAD },
      pad: { value: pad ? 1 : 0 },
      blocked: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
  }));
  prepareGroundOverlay(mesh);
  return mesh;
};

// The ghost is one translucent skin: a first pass fills the depth, so no inner wall shows through.
const ghostDepth = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true });
/** Shared by every ghost skin: the state's colour and how solid the ghost is. */
const ghostLook = { tint: { value: new THREE.Color() }, opacity: { value: 0 } };

/** The building in one colour: its own panels as light and dark, shaded by a fixed sun. */
const ghostSkin = (map: THREE.Texture | null) => new THREE.ShaderMaterial({
  uniforms: { map: { value: map }, ...ghostLook },
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec2 vUv;
    void main() {
      vNormal = mat3(modelMatrix) * normal;
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    uniform vec3 tint;
    uniform float opacity;
    varying vec3 vNormal;
    varying vec2 vUv;
    void main() {
      float panel = smoothstep(0.0, 0.35, dot(texture2D(map, vUv).rgb, vec3(0.2126, 0.7152, 0.0722)));
      float light = 0.45 + 0.55 * max(dot(normalize(vNormal), normalize(vec3(0.35, 0.85, 0.4))), 0.0);
      gl_FragColor = vec4(tint * light * mix(0.4, 1.0, panel), opacity);
      #include <colorspace_fragment>
    }`,
  transparent: true,
});

const ghostOf = (model: THREE.Object3D) => {
  const meshes: THREE.Mesh[] = [];
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  const skins = new Map<THREE.Texture | null, THREE.ShaderMaterial>();
  for (const mesh of meshes) {
    const map = mesh.material instanceof THREE.MeshStandardMaterial ? mesh.material.map : null;
    let skin = skins.get(map);
    if (!skin) skins.set(map, skin = ghostSkin(map));
    mesh.material = skin;
    mesh.castShadow = false;
    mesh.renderOrder = 3;
    const depth = new THREE.Mesh(mesh.geometry, ghostDepth);
    depth.renderOrder = 2;
    mesh.add(depth);
  }
  return model;
};

export const optionD: MarkerOption = {
  selection({ radius, color }) {
    const mesh = octagon(color, radius, false);
    mesh.name = "Selection octagon";
    mesh.userData.selectionOverlay = true;
    mesh.visible = false;
    return mesh;
  },
  placement(ghost) {
    const object = new THREE.Group();
    object.name = "Construction placement";
    const pad = octagon(UI_SELECTION_COLOR, 1, true);
    object.add(pad);
    const ghosts = new Map<string, THREE.Group>();
    let shown: THREE.Object3D | undefined;
    return {
      object,
      show({ kind, groundY, radius, valid }: PlacementState) {
        const color = valid ? UI_SELECTION_COLOR : UI_ATTACK_COLOR;
        const { uniforms } = pad.material;
        uniforms.color.value.setHex(color);
        uniforms.apothem.value = radius + PAD;
        uniforms.blocked.value = valid ? 0 : 1;
        placeGroundGeometry(pad.geometry, groundY, extent(radius));
        // A blocked ghost keeps a little of the valid one's pale cast under its red, so the model's
        // panels still read against the red pad.
        ghostLook.tint.value.setHex(UI_SELECTION_COLOR).lerp(uniforms.color.value, 0.88);
        ghostLook.opacity.value = valid ? 0.38 : 0.42;
        let current = ghosts.get(kind);
        if (!current) {
          current = new THREE.Group();
          ghosts.set(kind, current);
          const holder = current;
          void ghost(kind).then((model) => holder.add(ghostOf(model)));
        }
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
