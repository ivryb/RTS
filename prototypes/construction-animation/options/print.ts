import * as THREE from "three";
import type { BuildingKind } from "../../../src/sim/units";
import type { ConstructionSite, ConstructionSketch, SiteModel } from "../sketch";

/** Seconds the finished building keeps its construction material for the sealing flash. */
const SETTLE_SECONDS = 0.9;
/** Seconds the blueprint takes to switch off when a site is destroyed. */
const BLUEPRINT_SHUTDOWN_SECONDS = 0.24;
const PROFILE_STEPS = 64;
/**
 * Share of the build that follows raw height. The rest follows the model's volume, so a thin
 * mast is printed quickly and a wide hull slowly; this share keeps the top of the building from
 * flashing past in the last moments.
 */
const HEIGHT_SHARE = 0.4;

/** Height of the build plane, as a fraction of the model's height, at evenly spaced progress. */
type BuildProfile = { height: number; planeAt: Float32Array };

const profiles = new Map<BuildingKind, BuildProfile>();

const measureProfile = (model: SiteModel): BuildProfile => {
  const baseY = model.root.matrixWorld.elements[13]!;
  const height = new THREE.Box3().setFromObject(model.visualRoot).max.y - baseY;
  // Upward-facing area minus downward-facing area in each height step. Summed from the top
  // down it is the model's cross-section at that height, which needs no closed or tidy mesh.
  const facingUp = new Float64Array(PROFILE_STEPS);
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
  const [a, b, c] = corners;
  const edge = new THREE.Vector3();
  const normal = new THREE.Vector3();

  model.visualRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry: THREE.BufferGeometry = object.geometry;
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    const world = new Float32Array(position.count * 3);
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      a.fromBufferAttribute(position, vertex).applyMatrix4(object.matrixWorld).toArray(world, vertex * 3);
    }
    const count = index ? index.count : position.count;
    for (let offset = 0; offset < count; offset += 3) {
      corners.forEach((corner, at) => corner.fromArray(world, (index ? index.getX(offset + at) : offset + at) * 3));
      const up = normal.subVectors(b, a).cross(edge.subVectors(c, a)).y / 2;
      const low = (Math.min(a.y, b.y, c.y) - baseY) / height * PROFILE_STEPS;
      const high = (Math.max(a.y, b.y, c.y) - baseY) / height * PROFILE_STEPS;
      const first = THREE.MathUtils.clamp(Math.floor(low), 0, PROFILE_STEPS - 1);
      const last = THREE.MathUtils.clamp(Math.floor(high), first, PROFILE_STEPS - 1);
      // A triangle that spans several height steps gives each the share of its height inside it.
      for (let step = first; step <= last; step += 1) {
        const inside = first === last ? 1 : (Math.min(high, step + 1) - Math.max(low, step)) / (high - low);
        facingUp[step]! += up * Math.max(0, inside);
      }
    }
  });

  const volume = new Float64Array(PROFILE_STEPS);
  let section = 0;
  for (let step = PROFILE_STEPS - 1; step >= 0; step -= 1) {
    const above = section;
    section += facingUp[step]!;
    volume[step] = Math.max(0, above + section) / 2;
  }
  const total = volume.reduce((sum, value) => sum + value, 0);
  // Work done once the plane has passed each step boundary, from 0 to 1.
  const work = new Float64Array(PROFILE_STEPS + 1);
  for (let step = 0; step < PROFILE_STEPS; step += 1) {
    work[step + 1] = work[step]! + (1 - HEIGHT_SHARE) * volume[step]! / total + HEIGHT_SHARE / PROFILE_STEPS;
  }
  const planeAt = new Float32Array(PROFILE_STEPS + 1);
  let step = 0;
  for (let sample = 0; sample <= PROFILE_STEPS; sample += 1) {
    const progress = sample / PROFILE_STEPS;
    while (step < PROFILE_STEPS - 1 && work[step + 1]! < progress) step += 1;
    const within = (progress - work[step]!) / (work[step + 1]! - work[step]!);
    planeAt[sample] = (step + THREE.MathUtils.clamp(within, 0, 1)) / PROFILE_STEPS;
  }
  return { height, planeAt };
};

const planeFraction = ({ planeAt }: BuildProfile, progress: number) => {
  const at = THREE.MathUtils.clamp(progress, 0, 1) * PROFILE_STEPS;
  const sample = Math.min(PROFILE_STEPS - 1, Math.floor(at));
  return THREE.MathUtils.lerp(planeAt[sample]!, planeAt[sample + 1]!, at - sample);
};

// Shared by every site: the Aged desert indicator cyan, the drone beam's off-white run hot,
// an ember for cooling material, and the graphite core shown where the model is cut.
const palette = {
  uPrintBlueprint: { value: new THREE.Color(0x55d1da) },
  uPrintHot: { value: new THREE.Color(0xfff0d8) },
  uPrintEmber: { value: new THREE.Color(0xff8a3a) },
  uPrintCore: { value: new THREE.Color(0x4a443d) },
};

const createSiteUniforms = () => ({
  ...palette,
  /** The site's origin on the ground, in world space. */
  uPrintSite: { value: new THREE.Vector3() },
  /** x: world height of the build plane; y: heat, 1 while a drone works; z: blueprint presence; w: damage. */
  uPrintPlane: { value: new THREE.Vector4() },
  /** x: time; y: sealing flash; z: world height of the sealing band; w: 1 while the cut is open. */
  uPrintClock: { value: new THREE.Vector4() },
});
type SiteUniforms = ReturnType<typeof createSiteUniforms>;

const vertexPars = /* glsl */`
varying vec3 vPrintWorld;
void main() {`;
const vertexWorld = /* glsl */`
#include <project_vertex>
vPrintWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`;

const fragmentPars = /* glsl */`
uniform vec3 uPrintSite;
uniform vec4 uPrintPlane;
uniform vec4 uPrintClock;
uniform vec3 uPrintBlueprint;
uniform vec3 uPrintHot;
uniform vec3 uPrintEmber;
uniform vec3 uPrintCore;
varying vec3 vPrintWorld;

float printHash( vec2 cell ) {
	return fract( sin( dot( cell, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
float printGrain( vec2 pixel ) {
	return fract( 52.9829189 * fract( dot( pixel, vec2( 0.06711056, 0.00583715 ) ) ) );
}
// 1 on lines spaced "gap" apart along "along", drawn "width" pixels wide.
float printLines( float along, float gap, float perPixel, float width ) {
	float away = abs( fract( along / gap - 0.5 ) - 0.5 ) * gap / max( perPixel, 1e-5 );
	return 1.0 - smoothstep( width * 0.5, width * 0.5 + 1.0, away );
}

void main() {
	float printAbove = vPrintWorld.y - uPrintPlane.x;
	// The blueprint is the model's outside only, and is gone once its presence reaches zero.
	if ( printAbove > 0.0 && ( ! gl_FrontFacing || uPrintPlane.z <= 0.0 ) ) discard;`;

const fragmentLook = /* glsl */`
{
	float printTime = uPrintClock.x;
	float printHeat = uPrintPlane.y;
	float printPresence = uPrintPlane.z;
	float printBelow = - printAbove;
	float metresPerPixel = min( length( dFdx( vPrintWorld ) ), length( dFdy( vPrintWorld ) ) );
	// The line at the plane is drawn on walls. A level face lying just under the plane would
	// light up whole, so it only warms.
	float edge = ( 1.0 - smoothstep( 0.6, 1.0, printBelow / max( 0.05, 1.8 * metresPerPixel ) ) )
		* saturate( fwidth( vPrintWorld.y ) / ( 0.5 * metresPerPixel ) );
	// The building bake stores contact occlusion in the roughness texture's red channel. It is
	// zero on faces buried inside other parts, which the finished building never shows. Seams
	// on the outside reach zero too, but only a texel wide, so a blurred sample must agree.
	#ifdef USE_ROUGHNESSMAP
		bool concealed = texelRoughness.r < 0.02 && textureLod( roughnessMap, vRoughnessMapUv, 3.0 ).r < 0.08;
	#else
		bool concealed = false;
	#endif
	bool cut = uPrintClock.w > 0.5 && ( ! gl_FrontFacing || concealed );

	if ( printAbove > 0.0 ) {

		if ( concealed ) discard;

		// Not built yet: a blueprint projection of the finished model.
		float printLevel = vPrintWorld.y - uPrintSite.y;
		float heightPerPixel = fwidth( vPrintWorld.y );
		float albedo = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		// Light reaching the surface, without its colour: the projection keeps the model's form.
		float shade = saturate( dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( albedo, 0.04 ) / 3.0 );
		float rim = pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), 2.0 );
		// Slice lines belong to walls and slopes; a level deck would light up whole at a line's height.
		float slices = printLines( printLevel, 0.25, heightPerPixel, 1.0 )
			* smoothstep( 2.5, 5.0, 0.25 / max( heightPerPixel, 1e-5 ) )
			* smoothstep( 0.05, 0.3, heightPerPixel / metresPerPixel );
		float rising = pow( 0.5 + 0.5 * sin( printAbove * 2.6 - printTime * 3.6 ), 3.0 );
		float next = exp( - printAbove / 0.12 );

		float coverage = mix( 0.34, 0.24, smoothstep( 0.03, 0.45, albedo ) ) + 0.35 * rim + 0.55 * slices;
		coverage += printHeat * ( 0.08 * rising + 0.1 * next );
		// Waiting for a drone: a slow breath instead of the working pulse.
		coverage *= mix( 0.9 + 0.1 * sin( printTime * 2.4 ), 1.0, printHeat );
		// Damage makes bands of the projection drop out; destruction switches them all off.
		float band = floor( printLevel / 0.09 );
		float dropout = step( printHash( vec2( band, floor( printTime * 9.0 ) ) ), uPrintPlane.w * 0.55 );
		coverage *= 1.0 - 0.9 * dropout;
		coverage *= printPresence * step( printHash( vec2( band, 7.0 ) ), printPresence );

		outgoingLight = uPrintBlueprint
			* ( 0.5 + 0.3 * shade + 0.55 * slices + 0.35 * rim + printHeat * ( 0.18 * rising + 0.1 * next ) );
		diffuseColor.a = saturate( coverage );
		#ifdef PRINT_COVERAGE
			diffuseColor.a = saturate( diffuseColor.a + ( printGrain( gl_FragCoord.xy ) - 0.5 ) * 0.25 );
		#else
			if ( diffuseColor.a < printGrain( gl_FragCoord.xy ) ) discard;
			diffuseColor.a = 1.0;
		#endif

	} else if ( ! cut ) {

		// Built: the finished surface, with the newest layer still hot under the plane.
		float glow = exp( - printBelow / 0.2 );
		float around = atan( vPrintWorld.z - uPrintSite.z, vPrintWorld.x - uPrintSite.x );
		float travel = 0.7 + 0.3 * sin( around * 3.0 - printTime * 6.0 );
		float sparkle = step( 0.9, printHash( vec2( floor( around * 30.0 ), floor( printTime * 20.0 ) ) ) );
		vec3 edgeColor = mix( uPrintBlueprint * 1.1, uPrintHot * ( 1.8 * travel + 2.0 * sparkle ), printHeat );
		outgoingLight = mix( outgoingLight, edgeColor, edge * printPresence );
		outgoingLight += uPrintEmber * ( printHeat * printPresence * 0.5 * glow * glow * travel );
		// Completion: a flash that cools while a sealing band runs down the hull.
		float seal = exp( - abs( vPrintWorld.y - uPrintClock.z ) / 0.1 );
		outgoingLight = outgoingLight * ( 1.0 + 0.7 * uPrintClock.y ) + uPrintHot * uPrintClock.y * ( 0.03 + 1.1 * seal );
		diffuseColor.a = 1.0;

	} else {

		// The models are hollow shells of overlapping parts. Every back face and every concealed
		// face seen through the cut is drawn as one flat colour, patterned where the view ray
		// crosses the build plane, so the cut reads as solid material.
		vec3 ray = isOrthographic
			? - vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] )
			: normalize( vPrintWorld - cameraPosition );
		vec2 cap = vPrintWorld.xz - uPrintSite.xz + ray.xz * ( printBelow / ray.y );
		// Rings spread from where the drone's beam lands, at the site's centre, out to the walls.
		// Without a drone they stand still and cold.
		float working = printHeat * printPresence;
		float reach = length( cap );
		float ripple = pow( 0.5 + 0.5 * cos( ( reach - printTime * 1.5 * working ) * 8.4 ), 4.0 ) / ( 1.0 + 0.35 * reach );
		float landing = exp( - reach / 0.3 );
		vec3 capColor = uPrintCore * ( 1.0 + 0.45 * ripple )
			+ working * ( uPrintEmber * ( 0.04 + 0.32 * ripple ) + uPrintHot * 0.6 * landing );
		capColor = mix( capColor, mix( uPrintBlueprint * 1.1, uPrintHot * 1.8, printHeat ), edge * printPresence );
		outgoingLight = capColor;
		diffuseColor.a = 1.0;

	}
}
#include <opaque_fragment>`;

const patchVertex = (shader: { vertexShader: string }) => {
  shader.vertexShader = shader.vertexShader
    .replace("void main() {", vertexPars)
    .replace("#include <project_vertex>", vertexWorld);
};

const createPrintMaterial = (original: THREE.Material, uniforms: SiteUniforms, coverage: boolean) => {
  const material = original.clone();
  // The solid part keeps casting the shadow the finished building casts.
  material.shadowSide = original.shadowSide ?? (original.side === THREE.FrontSide ? THREE.BackSide : original.side);
  material.side = THREE.DoubleSide;
  material.alphaToCoverage = coverage;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (coverage) shader.defines = { ...shader.defines, PRINT_COVERAGE: "" };
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", fragmentPars)
      .replace("#include <opaque_fragment>", fragmentLook);
  };
  material.customProgramCacheKey = () => `print-construction-${coverage}`;
  return material;
};

/** The shadow grows with the built part: nothing above the plane is drawn into the shadow map. */
const createPrintDepthMaterial = (uniforms: SiteUniforms) => {
  const material = new THREE.MeshDepthMaterial();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPrintPlane = uniforms.uPrintPlane;
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", /* glsl */`
uniform vec4 uPrintPlane;
varying vec3 vPrintWorld;
void main() {
	if ( vPrintWorld.y > uPrintPlane.x ) discard;`);
  };
  material.customProgramCacheKey = () => "print-construction-depth";
  return material;
};

type PrintedMesh = { mesh: THREE.Mesh; finished: THREE.Material; printing: THREE.Material };

const createSite = (model: SiteModel, coverage: boolean): ConstructionSite => {
  let profile = profiles.get(model.kind);
  if (!profile) profiles.set(model.kind, profile = measureProfile(model));
  const { height } = profile;
  const [originX, baseY, originZ] = model.root.matrixWorld.elements.slice(12, 15) as [number, number, number];
  const uniforms = createSiteUniforms();
  uniforms.uPrintSite.value.set(originX, baseY, originZ);

  const depth = createPrintDepthMaterial(uniforms);
  const meshes: PrintedMesh[] = [];
  model.visualRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    meshes.push({
      mesh: object,
      finished: object.material,
      printing: createPrintMaterial(object.material, uniforms, coverage),
    });
  });
  let printing = false;
  const setPrinting = (next: boolean) => {
    if (next === printing) return;
    printing = next;
    for (const { mesh, finished, printing: material } of meshes) {
      mesh.material = next ? material : finished;
      mesh.customDepthMaterial = next ? depth : undefined;
    }
  };

  const site: ConstructionSite = {
    beamTargetY: baseY,
    update(state, time) {
      const settling = state.lifecycle === "active" && state.sinceLifecycleChange < SETTLE_SECONDS;
      setPrinting(state.lifecycle !== "active" || settling);
      model.visualRoot.scale.setScalar(1);
      if (!printing) return;

      const destroyed = state.lifecycle === "destroyed";
      // The plane starts a sliver under the model and ends a sliver over it, so no face lies in
      // the plane at 0% and the last layer's hot line is off the roof at 100%.
      const planeY = settling
        ? baseY + height + 1
        : baseY - 0.02 + planeFraction(profile, state.progress) * (height + 0.04);
      site.beamTargetY = Math.max(planeY, baseY + 0.12);
      const shutdown = destroyed ? Math.min(1, state.sinceLifecycleChange / BLUEPRINT_SHUTDOWN_SECONDS) : 0;
      uniforms.uPrintPlane.value.set(
        planeY,
        state.working && !destroyed && !settling ? 1 : 0,
        1 - shutdown,
        1 - state.health,
      );

      const settle = settling ? state.sinceLifecycleChange / SETTLE_SECONDS : 1;
      uniforms.uPrintClock.value.set(
        time,
        (1 - settle) ** 3,
        baseY + height * (1 - Math.min(1, settle * 1.8)),
        settling ? 0 : 1,
      );
      // A small swell as the last layer lands, gone within a third of a second.
      const swell = Math.min(1, state.sinceLifecycleChange / 0.32);
      if (settling) model.visualRoot.scale.setScalar(1 + 0.05 * Math.sin(Math.PI * swell) * (1 - swell));
    },
    dispose() {
      setPrinting(false);
      model.visualRoot.scale.setScalar(1);
      for (const { printing: material } of meshes) material.dispose();
      depth.dispose();
    },
  };
  return site;
};

let coverageSupported = false;

export const sketch: ConstructionSketch = {
  title: "Print: fabricated layer by layer",
  prepare({ renderer }) {
    // The blueprint is see-through without blending: multisample coverage where the canvas has
    // it, a screen-door pattern where it does not.
    const gl = renderer.getContext();
    coverageSupported = gl.getParameter(gl.SAMPLES) > 0;
  },
  createSite: (model) => createSite(model, coverageSupported),
};
