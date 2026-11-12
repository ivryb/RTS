import * as THREE from "three";
import { UI_SELECTION_COLOR } from "../../../../src/uiColors";

/** Per-site values the construction shaders read; one object is shared by a site's materials. */
export const createUniforms = () => ({
  /** Construction progress, 0 to 1; it runs on past 1 while the completed building settles. */
  uProgress: { value: 0 },
  /** How much progress one part's flight and settle takes. */
  uSpan: { value: 0.1 },
  uTime: { value: 0 },
  /** 1 while a Scout Drone is beaming the site, and while the completed building settles. */
  uWorking: { value: 0 },
  /** 1 while a started site waits for a drone: the plan stands by as an outline. */
  uStandby: { value: 0 },
  /** How much of the plan of the parts still to come stands, from the ground up; 0 once the site is destroyed. */
  uPlan: { value: 1 },
  /** 1 at full health, 0 at none. */
  uHealth: { value: 1 },
  /** Seconds since completion, or -1 while the building is not complete. */
  uSettle: { value: -1 },
  /** 1 where the canvas has no multisampling, so partial coverage falls back to a screen door. */
  uScreenDoor: { value: 0 },
  uBeamColor: { value: new THREE.Color(UI_SELECTION_COLOR) },
  /** The plan's one colour: its shadowed and lit tones, and the lines where a surface turns away. */
  uPlanShade: { value: new THREE.Color(0x172a30) },
  uPlanLight: { value: new THREE.Color(0x33545b) },
  uPlanEdge: { value: new THREE.Color(0x46676b) },
  /** Surfaces the finished building encloses are drawn as graphite deck plates. */
  uDeckColor: { value: new THREE.Color(0x3e3a35) },
});

export type AssemblyUniforms = ReturnType<typeof createUniforms>;

/** Where on its path a part meets its seat, as a fraction of its flight and settle. */
export const IMPACT = Math.PI / 8.4;

/**
 * How far a part is from its seat: 1 where it appears, 0 in its seat, briefly negative as it
 * overshoots. It holds still for a moment while it appears, travels in, and meets the seat at
 * `IMPACT` with a short damped bounce. `pathGlsl` below is the same curve for the vertex shader.
 */
export const partPath = (arrival: number) => {
  const along = THREE.MathUtils.clamp(arrival, 0, 1);
  const eased = along * THREE.MathUtils.smoothstep(along, 0, 0.12);
  const seated = eased - IMPACT;
  const offset = seated < 0
    ? Math.exp(-2.4 * eased) * Math.cos(4.2 * eased)
    : -0.19 * Math.exp(-9 * seated) * Math.sin(9 * seated);
  return offset * (1 - THREE.MathUtils.smoothstep(along, 0.8, 1));
};

const pathGlsl = /* glsl */ `
float assemblyPath(float arrival) {
  float along = clamp(arrival, 0.0, 1.0);
  float eased = along * smoothstep(0.0, 0.12, along);
  float seated = eased - ${IMPACT.toFixed(4)};
  float offset = seated < 0.0
    ? exp(-2.4 * eased) * cos(4.2 * eased)
    : -0.19 * exp(-9.0 * seated) * sin(9.0 * seated);
  return offset * (1.0 - smoothstep(0.8, 1.0, along));
}
`;

const vertexHead = /* glsl */ `
// Centre of the part.
attribute vec3 aPartPivot;
attribute vec3 aPartTravel;
// x: progress at which the part sets off, y: height within the part, z: height within the
// building (both 0 to 1), w: strength of the flash along the part's lower seam.
attribute vec4 aPartTiming;
uniform float uProgress;
uniform float uSpan;
uniform float uTime;
uniform float uWorking;
uniform float uPlan;
varying float vArrival;
varying vec3 vPartHeights;
varying vec3 vSeat;
varying vec3 vSeatNormal;
${pathGlsl}
`;

const vertexBody = /* glsl */ `
float arrival = (uProgress - aPartTiming.x) / uSpan;
vArrival = arrival;
vPartHeights = aPartTiming.yzw;
// The part's own position in metres, so the deck plates stay on it as it moves.
vSeat = position * length(modelMatrix[1].xyz);
vSeatNormal = normal;
// A part still to come stays in its seat as part of the projected plan. With no drone at work
// a part caught in the air hangs where it stopped, also drawn as plan, and bobs as it waits.
bool hanging = uWorking < 0.5 && arrival > 0.0 && arrival < ${IMPACT.toFixed(4)};
bool planned = arrival <= 0.0 || hanging;
if (arrival > 0.0) {
  // A carried part grows out of the end of the drone's beam.
  float grown = hanging ? 1.0 : smoothstep(0.0, 0.1, arrival);
  float bob = hanging ? 0.08 * sin(uTime * 2.6) : 0.0;
  transformed = aPartPivot + (transformed - aPartPivot) * grown
    + aPartTravel * (assemblyPath(arrival) + bob);
}
#ifdef ASSEMBLY_DEPTH
// The plan is light, not matter: it casts no shadow.
if (planned) transformed = aPartPivot;
#else
if (planned && uPlan <= 0.0) transformed = aPartPivot;
#endif
`;

const fragmentHead = /* glsl */ `
uniform float uTime;
uniform float uWorking;
uniform float uStandby;
uniform float uPlan;
uniform float uHealth;
uniform float uSettle;
uniform float uScreenDoor;
uniform vec3 uBeamColor;
uniform vec3 uPlanShade;
uniform vec3 uPlanLight;
uniform vec3 uPlanEdge;
uniform vec3 uDeckColor;
varying float vArrival;
varying vec3 vPartHeights;
varying vec3 vSeat;
varying vec3 vSeatNormal;

// Ordered 4 x 4 threshold, for canvases where alpha-to-coverage has no samples to work with.
float assemblyScreenDoor(vec2 pixel) {
  const float thresholds[16] = float[16](
    0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0
  );
  ivec2 cell = ivec2(mod(pixel, 4.0));
  return (thresholds[cell.x + cell.y * 4] + 0.5) / 16.0;
}

// Graphite deck plates, 0.32 m across, with dark joints: the look of a building's inside.
vec3 assemblyDeck(vec3 seat, vec3 facing) {
  vec3 cell = seat / 0.32;
  // Joints run along the two directions that lie in the face, not the one it looks along.
  vec3 inFace = step(abs(normalize(facing)), vec3(0.7));
  vec3 fromJoint = 0.5 - abs(fract(cell) - 0.5);
  vec3 soft = fwidth(cell);
  // Seen from far off the joints thin out instead of shimmering.
  vec3 joints = (1.0 - smoothstep(vec3(0.04), 0.04 + soft, fromJoint)) * inFace
    * clamp(0.07 / soft, 0.0, 1.0);
  float joint = max(joints.x, max(joints.y, joints.z));
  float plate = fract(sin(dot(floor(cell) * inFace, vec3(12.99, 78.23, 37.72))) * 43758.5453);
  return uDeckColor * mix(0.85 + 0.3 * plate, 0.4, joint);
}
`;

/**
 * Runs before lighting, so enclosed surfaces are lit and shadowed like any built surface. The
 * shared baker (`tools/assets/building_bake.py`) stores contact occlusion in the red channel of
 * the roughness texture: zero there is a surface that other parts of the building close over,
 * such as a sealing face or the core under the roof.
 */
const fragmentSurface = /* glsl */ `
float concealed = 0.0;
#ifdef USE_ROUGHNESSMAP
concealed = 1.0 - smoothstep(0.02, 0.07, texelRoughness.r);
#endif
diffuseColor.rgb = mix(diffuseColor.rgb, assemblyDeck(vSeat, vSeatNormal), concealed);
roughnessFactor = mix(roughnessFactor, 0.72, concealed);
metalnessFactor = mix(metalnessFactor, 0.1, concealed);
`;

const fragmentBody = /* glsl */ `
bool planned = vArrival <= 0.0 || (uWorking < 0.5 && vArrival < ${IMPACT.toFixed(4)});
float coverage = 1.0;
if (planned) {
  // The plan is tinted glass over the finished shape, with a line wherever a surface turns
  // away from the camera. It keeps the model's own shading as two tones of one colour.
  float edge = 1.0 - smoothstep(0.25, 0.7, abs(normal.z));
  // Waiting for a drone on a started site, the glass thins out and leaves the lines.
  // A destroyed site's plan goes out from the top down.
  coverage = mix(mix(0.75, 0.25, uStandby), 1.0, edge) * step(vPartHeights.y, uPlan * 1.01)
    * step(concealed, 0.5);
  float tone = smoothstep(0.02, 0.55, dot(outgoingLight, vec3(0.3, 0.59, 0.11)));
  vec3 plan = mix(mix(uPlanShade, uPlanLight, tone), uPlanEdge, edge * 0.8);
  // At work a bright band climbs the plan; standing by, the whole plan breathes slowly.
  float band = exp(-pow((vPartHeights.y - fract(uTime * 0.55)) * 7.0, 2.0));
  float breath = 0.6 + 0.4 * sin(uTime * 2.6);
  plan *= 1.0 + 0.5 * band * uWorking - (1.0 - breath) * uStandby;
  // Damage dulls the plan evenly: the projection of a site under fire loses its colour.
  float damage = 1.0 - uHealth;
  plan = mix(plan, vec3(dot(plan, vec3(0.3, 0.59, 0.11))) * vec3(0.8, 0.74, 0.66), damage * 0.8);
  gl_FragColor.rgb = plan;
} else {
  // A part glows as it appears at the end of the beam, cools as it is carried in, and flashes
  // along its lower seam as it locks into its seat.
  float carried = 0.3 - 0.2 * smoothstep(0.0, 0.2, vArrival) - 0.1 * smoothstep(0.2, ${IMPACT.toFixed(4)}, vArrival);
  float locked = step(${IMPACT.toFixed(4)}, vArrival) * exp(-(vArrival - ${IMPACT.toFixed(4)}) * 6.0)
    * (1.0 - smoothstep(0.85, 1.0, vArrival)) * uWorking;
  float seam = (1.0 - smoothstep(0.0, 0.3, vPartHeights.x)) * vPartHeights.z * (1.0 - concealed);
  // The carried glow brightens the part's own surface, so a dark plate keeps its pattern.
  gl_FragColor.rgb = gl_FragColor.rgb * (1.0 + 2.0 * carried)
    + uBeamColor * (carried * 0.05 + locked * (0.05 + 1.3 * seam));
  if (uSettle >= 0.0) {
    // Completion: one bright line runs from the ground to the top, then the glow dies away.
    float line = exp(-pow((vPartHeights.y - uSettle / 0.45) * 24.0, 2.0));
    float fade = 1.0 - smoothstep(0.4, 0.85, uSettle);
    gl_FragColor.rgb += uBeamColor * fade * (line * 0.42 + 0.04);
  }
}
// Partial coverage stays in the opaque pass: multisampling resolves it, so nothing is sorted.
if (uScreenDoor > 0.5) coverage = step(assemblyScreenDoor(gl_FragCoord.xy), coverage);
if (coverage <= 0.0) discard;
gl_FragColor.a = coverage;
`;

/**
 * Makes a material draw the site as parts in flight, parts in place, and a projected plan of
 * the rest. Every site's colour pass shares one shader program and every depth pass another.
 */
export const patchMaterial = (
  material: THREE.Material,
  uniforms: AssemblyUniforms,
  pass: "colour" | "depth",
) => {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${vertexHead}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${vertexBody}`);
    if (pass === "depth") {
      shader.vertexShader = `#define ASSEMBLY_DEPTH\n${shader.vertexShader}`;
      return;
    }
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${fragmentHead}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${fragmentSurface}`)
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>\n${fragmentBody}`);
  };
  material.alphaToCoverage = pass === "colour";
  material.customProgramCacheKey = () => `construction-assembly-${pass}`;
};
