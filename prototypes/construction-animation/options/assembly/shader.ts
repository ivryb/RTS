import * as THREE from "three";
import { UI_SELECTION_COLOR } from "../../../../src/uiColors";

/** Per-site values the construction shaders read; one object is shared by a site's materials. */
export const createUniforms = () => ({
  /** Construction progress, 0 to 1. */
  uProgress: { value: 0 },
  /** How much progress one part's flight and settle takes. */
  uSpan: { value: 0.1 },
  uTime: { value: 0 },
  /** 1 while a Scout Drone is beaming the site. */
  uWorking: { value: 0 },
  /** Strength of the projected plan of the parts still to come; 0 once the site is destroyed. */
  uPlan: { value: 1 },
  /** 1 at full health, 0 at none. */
  uHealth: { value: 1 },
  /** Seconds since completion, or -1 while the building is not complete. */
  uSettle: { value: -1 },
  /** 1 where the canvas has no multisampling, so partial coverage falls back to a screen door. */
  uScreenDoor: { value: 0 },
  uBeamColor: { value: new THREE.Color(UI_SELECTION_COLOR) },
  /** Shadowed and lit ends of the plan's two-tone tint. */
  uPlanShade: { value: new THREE.Color(0x123f4b) },
  uPlanLight: { value: new THREE.Color(0x58b8c6) },
});

export type AssemblyUniforms = ReturnType<typeof createUniforms>;

/** Where on its path a part meets its seat, as a fraction of its flight and settle. */
const IMPACT = 0.374;

const vertexHead = /* glsl */ `
attribute vec3 aPartPivot;
attribute vec3 aPartTravel;
// x: progress at which the part sets off, y: height within the part, z: height within the
// building (both 0 to 1), w: a random number per part.
attribute vec4 aPartTiming;
uniform float uProgress;
uniform float uSpan;
uniform float uWorking;
uniform float uPlan;
varying float vArrival;
varying vec3 vPartHeights;

// 1 at the start of a part's path and 0 in its seat; briefly negative as it overshoots.
float assemblyPath(float arrival) {
  float along = clamp(arrival, 0.0, 1.0);
  return exp(-4.0 * along) * cos(4.2 * along) * (1.0 - smoothstep(0.8, 1.0, along));
}
`;

const vertexBody = /* glsl */ `
float arrival = (uProgress - aPartTiming.x) / uSpan;
vArrival = arrival;
vPartHeights = aPartTiming.yzw;
// A part still to come stays in its seat as part of the projected plan. With no drone at work
// a part caught in the air hangs where it stopped, also drawn as plan.
bool planned = arrival <= 0.0 || (uWorking < 0.5 && arrival < ${IMPACT.toFixed(3)});
if (arrival > 0.0) {
  float grown = mix(0.82, 1.0, smoothstep(0.0, 0.3, arrival));
  transformed = aPartPivot + (transformed - aPartPivot) * grown + aPartTravel * assemblyPath(arrival);
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
uniform float uPlan;
uniform float uHealth;
uniform float uSettle;
uniform float uScreenDoor;
uniform vec3 uBeamColor;
uniform vec3 uPlanShade;
uniform vec3 uPlanLight;
varying float vArrival;
varying vec3 vPartHeights;

// Ordered 4 x 4 threshold, for canvases where alpha-to-coverage has no samples to work with.
float assemblyScreenDoor(vec2 pixel) {
  const float thresholds[16] = float[16](
    0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0
  );
  ivec2 cell = ivec2(mod(pixel, 4.0));
  return (thresholds[cell.x + cell.y * 4] + 0.5) / 16.0;
}

float assemblyHash(float seed) {
  return fract(sin(seed * 91.17) * 43758.5453);
}
`;

const fragmentBody = /* glsl */ `
bool planned = vArrival <= 0.0 || (uWorking < 0.5 && vArrival < ${IMPACT.toFixed(3)});
float coverage = smoothstep(0.0, 0.15, vArrival);
if (planned) {
  // The plan is tinted glass: thin where a surface faces the camera, dense where it turns
  // away, which draws the building's edges. It keeps the model's own shading as two tones.
  float glass = mix(0.85, 0.3, smoothstep(0.25, 0.7, abs(normal.z)));
  // A damaged projector drops whole parts of the plan for a moment.
  float dropout = step(1.0 - (1.0 - uHealth) * 0.5, assemblyHash(vPartHeights.z + floor(uTime * 9.0)));
  coverage = glass * uPlan * (1.0 - dropout);
  float tone = smoothstep(0.02, 0.55, dot(outgoingLight, vec3(0.3, 0.59, 0.11)));
  // At work a bright band climbs the plan; waiting, the whole plan breathes slowly.
  float band = exp(-pow((vPartHeights.y - fract(uTime * 0.55)) * 7.0, 2.0));
  float breath = 0.6 + 0.08 * sin(uTime * 2.2);
  gl_FragColor.rgb = mix(uPlanShade, uPlanLight, tone) * mix(breath, 1.0 + 0.45 * band, uWorking);
} else {
  // A part in flight is lit by the beam that carries it, and flashes along its lower seam
  // as it locks into its seat.
  float carried = 1.0 - smoothstep(0.1, ${IMPACT.toFixed(3)}, vArrival);
  float locked = step(${IMPACT.toFixed(3)}, vArrival) * exp(-(vArrival - ${IMPACT.toFixed(3)}) * 6.0)
    * (1.0 - smoothstep(0.85, 1.0, vArrival)) * uWorking;
  float seam = 1.0 - smoothstep(0.0, 0.3, vPartHeights.x);
  gl_FragColor.rgb += uBeamColor * (carried * 0.1 + locked * (0.05 + 1.3 * seam));
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
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>\n${fragmentBody}`);
  };
  material.alphaToCoverage = pass === "colour";
  material.customProgramCacheKey = () => `construction-assembly-${pass}`;
};
