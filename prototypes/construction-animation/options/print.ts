import * as THREE from "three";
import type { BuildingKind } from "../../../src/sim/units";
import type { ConstructionSite, ConstructionSketch, SiteModel } from "../sketch";
import { CONE_SLOPE, measureShape, type BuildingShape } from "./print/shape";

/** Seconds the finished building keeps its construction material for the completion sweep. */
const SETTLE_SECONDS = 0.9;
/** Seconds the blueprint takes to switch off when a site is destroyed. */
const BLUEPRINT_SHUTDOWN_SECONDS = 0.24;

const shapes = new Map<BuildingKind, BuildingShape>();

// Shared by every site: the Aged desert indicator cyan, the drone beam's off-white run hot,
// and the graphite core shown where the model is cut.
const palette = {
  uPrintBlueprint: { value: new THREE.Color(0x55d1da) },
  uPrintHot: { value: new THREE.Color(0xfff0d8) },
  uPrintCore: { value: new THREE.Color(0x4a443d) },
};

const createSiteUniforms = () => ({
  ...palette,
  /** xyz: the site's origin on the ground, in world space; w: the model's height. */
  uPrintSite: { value: new THREE.Vector4() },
  /** x: world height of the build surface at the site's axis; y: heat, 1 while a drone works; z: blueprint presence; w: damage. */
  uPrintPlane: { value: new THREE.Vector4() },
  /** x: time; y: the completion sweep, 0 to 1, and 1 when there is none; z: 1 while the cut is open. */
  uPrintClock: { value: new THREE.Vector3() },
  /** Where the finished model is solid, and the way there from world space. */
  uPrintSolid: { value: null as THREE.Data3DTexture | null },
  uPrintToSolid: { value: new THREE.Matrix4() },
});
type SiteUniforms = ReturnType<typeof createSiteUniforms>;

const vertexPars = /* glsl */`
varying vec3 vPrintWorld;
void main() {`;
const vertexWorld = /* glsl */`
#include <project_vertex>
vPrintWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`;

// Height above the build surface. The surface is a shallow cone, highest on the site's axis
// where the beam lands, so a level deck fills from the middle outward instead of all at once.
const heightAboveSurface = /* glsl */`vPrintWorld.y - uPrintPlane.x + ${CONE_SLOPE.toFixed(3)} * length( vPrintWorld.xz - uPrintSite.xz )`;

const fragmentPars = /* glsl */`
uniform vec4 uPrintSite;
uniform vec4 uPrintPlane;
uniform vec3 uPrintClock;
uniform vec3 uPrintBlueprint;
uniform vec3 uPrintHot;
uniform vec3 uPrintCore;
uniform lowp sampler3D uPrintSolid;
uniform mat4 uPrintToSolid;
varying vec3 vPrintWorld;

float printHash( vec2 cell ) {
	return fract( sin( dot( cell, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
float printGrain( vec2 pixel ) {
	return fract( 52.9829189 * fract( dot( pixel, vec2( 0.06711056, 0.00583715 ) ) ) );
}
float printLuma( vec3 color ) {
	return dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
}
// 1 on lines spaced "gap" apart along "along", drawn "width" pixels wide.
float printLines( float along, float gap, float perPixel, float width ) {
	float away = abs( fract( along / gap - 0.5 ) - 0.5 ) * gap / max( perPixel, 1e-5 );
	return 1.0 - smoothstep( width * 0.5, width * 0.5 + 1.0, away );
}

void main() {
	float printAbove = ${heightAboveSurface};
	float printAbovePerPixel = fwidth( printAbove );
	float metresPerPixel = min( length( dFdx( vPrintWorld ) ), length( dFdy( vPrintWorld ) ) );
	// The blueprint is the model's outside only, and is gone once its presence reaches zero.
	if ( printAbove > 0.0 && ( ! gl_FrontFacing || uPrintPlane.z <= 0.0 ) ) discard;`;

const fragmentLook = /* glsl */`
{
	float printTime = uPrintClock.x;
	float printHeat = uPrintPlane.y;
	float printPresence = uPrintPlane.z;
	float printBelow = - printAbove;
	// Waiting for a drone: everything the print lights breathes slowly instead of working.
	float waiting = 0.78 + 0.22 * sin( printTime * 2.4 );
	// The line where material is laid, a couple of pixels wide on walls and decks alike.
	float pixelsBelow = printBelow / max( printAbovePerPixel, 1e-5 );
	float edge = 1.0 - smoothstep( 0.6, 1.0, pixelsBelow / max( 1.8, 0.05 / metresPerPixel ) );
	vec3 coldEdge = uPrintBlueprint * 0.7 * waiting;

	// The models are piles of overlapping hollow shells, so through the cut the camera sees
	// their insides and the faces buried in other parts. Insides are back faces. A buried face
	// is one the building bake found fully occluded (the red channel of the roughness texture,
	// with a blurred sample agreeing, since seams reach zero a texel wide) and that the camera
	// sees through solid: recesses and decks the finished building shows are occluded too, but
	// the view ray reaches them through open air.
	vec3 ray = isOrthographic
		? - vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] )
		: normalize( vPrintWorld - cameraPosition );
	vec3 entry = vPrintWorld + ray * ( printBelow / ray.y );
	#ifdef USE_ROUGHNESSMAP
		bool buried = texelRoughness.r < 0.02 && textureLod( roughnessMap, vRoughnessMapUv, 3.0 ).r < 0.08
			&& texture( uPrintSolid, ( uPrintToSolid * vec4( entry, 1.0 ) ).xyz ).r > 0.5;
	#else
		bool buried = false;
	#endif

	if ( printAbove > 0.0 ) {

		// Not built yet: a blueprint of the finished model, drawn as contour lines over a faint
		// fill so it stays quieter than the built part and the working line.
		float printLevel = vPrintWorld.y - uPrintSite.y;
		float heightPerPixel = fwidth( vPrintWorld.y );
		// Light reaching the surface, without its colour: the fill keeps the model's form.
		float shade = saturate( printLuma( outgoingLight ) / max( printLuma( diffuseColor.rgb ), 0.04 ) / 3.0 );
		float rim = pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), 4.0 );
		// Contours every quarter metre, thinned out by doubling the gap as the camera pulls back.
		// They belong to walls and slopes; a level deck would light up whole at a contour's height.
		float detail = clamp( log2( 12.0 * metresPerPixel / 0.25 ), 0.0, 4.0 );
		float gap = 0.25 * exp2( floor( detail ) );
		float contours = smoothstep( 0.05, 0.3, heightPerPixel / metresPerPixel ) * max(
			printLines( printLevel, gap * 2.0, heightPerPixel, 0.6 ),
			( 1.0 - smoothstep( 0.2, 0.8, fract( detail ) ) ) * printLines( printLevel, gap, heightPerPixel, 0.6 ) );
		float lines = saturate( contours + 0.35 * rim );
		float rising = pow( 0.5 + 0.5 * sin( printAbove * 2.6 - printTime * 3.6 ), 3.0 );
		float next = exp( - printAbove / 0.12 );

		outgoingLight = uPrintBlueprint
			* ( mix( 0.32 + 0.16 * shade, 0.62, lines ) + printHeat * ( 0.08 * rising + 0.22 * next ) )
			* mix( 0.8 * waiting, 1.0, printHeat ) * ( 0.4 + 0.6 * printPresence );
		// The fill covers one sample in four and a line all of them. No dither: every pixel of
		// the fill gets the same share, so it is an even tint and surfaces behind it stay hidden.
		float coverage = mix( 0.3, 1.0, lines );
		// Damage opens evenly spaced gaps that drift up the blueprint.
		if ( fract( printLevel / 0.32 - printTime * 0.35 ) < uPrintPlane.w * 0.55 ) coverage = 0.0;
		// Destruction switches the blueprint off band by band.
		coverage *= step( printHash( vec2( floor( printLevel / 0.09 ), 7.0 ) ), printPresence );
		diffuseColor.a = coverage;
		#ifndef PRINT_COVERAGE
			if ( diffuseColor.a < 0.02 + 0.96 * printGrain( gl_FragCoord.xy ) ) discard;
			diffuseColor.a = 1.0;
		#endif

	} else if ( uPrintClock.z < 0.5 || ( gl_FrontFacing && ! buried ) ) {

		// Built: the finished surface. Only the line itself and a few centimetres under it glow.
		float around = atan( vPrintWorld.z - uPrintSite.z, vPrintWorld.x - uPrintSite.x );
		float travel = 0.7 + 0.3 * sin( around * 3.0 - printTime * 6.0 );
		float sparkle = step( 0.9, printHash( vec2( floor( around * 30.0 ), floor( printTime * 20.0 ) ) ) );
		float cooling = exp( - pixelsBelow / max( 2.5, 0.04 / metresPerPixel ) ) * ( 1.0 - edge );
		outgoingLight += uPrintHot * ( printHeat * printPresence * 0.1 * cooling * travel );
		outgoingLight = mix( outgoingLight, mix( coldEdge, uPrintHot * ( 1.8 * travel + 2.0 * sparkle ), printHeat ), edge * printPresence );
		// Completion: one more line runs up the finished hull, the way the build went, and leaves
		// the hull brighter for a moment behind it. Both are measured in shares of the model's
		// height, so a Turret and a Command Center settle alike.
		float settle = uPrintClock.y;
		float passed = mix( - 0.15, 1.3, 1.0 - ( 1.0 - settle ) * ( 1.0 - settle ) )
			- ( vPrintWorld.y - uPrintSite.y ) / uPrintSite.w;
		float fading = 1.0 - settle * settle;
		outgoingLight *= 1.0 + 0.6 * fading * exp( - ( passed > 0.0 ? passed / 0.22 : - passed / 0.06 ) );
		// The line is for walls: a level deck at its height would flash whole.
		float wall = saturate( fwidth( vPrintWorld.y ) / ( 0.5 * metresPerPixel ) );
		outgoingLight = mix( outgoingLight, uPrintHot * 1.5, 0.8 * fading * wall * exp( - abs( passed ) / 0.025 ) );
		diffuseColor.a = 1.0;

	} else {

		// Everything seen through the cut is one flat colour, patterned where the view ray
		// crosses the build surface, so the cut reads as solid material.
		vec2 cap = entry.xz - uPrintSite.xz;
		// Rings spread from where the drone's beam lands, at the site's centre, out to the walls.
		// Without a drone they stand still and faint, and a destroyed site keeps a plain cut.
		float working = printHeat * printPresence;
		float reach = length( cap );
		float ripple = pow( 0.5 + 0.5 * cos( ( reach - printTime * 1.5 * working ) * 8.4 ), 4.0 ) / ( 1.0 + 0.35 * reach );
		float landing = exp( - reach / 0.3 );
		vec3 capColor = uPrintCore * ( 1.0 + printPresence * mix( 0.2, 0.45, printHeat ) * ripple )
			+ working * uPrintHot * ( 0.02 + 0.16 * ripple + 0.6 * landing );
		// The line follows the shells' own walls; a buried face crossing the cut would add clutter.
		outgoingLight = mix( capColor, mix( coldEdge, uPrintHot * 1.8, printHeat ), gl_FrontFacing ? 0.0 : edge * printPresence );
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

/** The shadow grows with the built part: nothing above the build surface is drawn into the shadow map. */
const createPrintDepthMaterial = (uniforms: SiteUniforms) => {
  const material = new THREE.MeshDepthMaterial();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPrintSite = uniforms.uPrintSite;
    shader.uniforms.uPrintPlane = uniforms.uPrintPlane;
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", /* glsl */`
uniform vec4 uPrintSite;
uniform vec4 uPrintPlane;
varying vec3 vPrintWorld;
void main() {
	if ( ${heightAboveSurface} > 0.0 ) discard;`);
  };
  material.customProgramCacheKey = () => "print-construction-depth";
  return material;
};

type PrintedMesh = { mesh: THREE.Mesh; finished: THREE.Material; printing: THREE.Material };

const createSite = (model: SiteModel, coverage: boolean): ConstructionSite => {
  let shape = shapes.get(model.kind);
  if (!shape) shapes.set(model.kind, shape = measureShape(model));
  const { height, surfaceAt } = shape;
  const [originX, baseY, originZ] = model.root.matrixWorld.elements.slice(12, 15) as [number, number, number];
  // The surface starts a sliver under the model and ends a sliver clear of it, so no face lies
  // in it at 0% and the last layer's hot line is off the roof at 100%.
  const travel = shape.surfaceTop + 0.04;
  const uniforms = createSiteUniforms();
  uniforms.uPrintSite.value.set(originX, baseY, originZ, height);
  uniforms.uPrintSolid.value = shape.solid;
  uniforms.uPrintToSolid.value.copy(model.root.matrixWorld).invert().premultiply(shape.toSolid);

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
      const planeY = baseY - 0.02 + (settling ? 2 : surfaceAt(state.progress)) * travel;
      site.beamTargetY = THREE.MathUtils.clamp(planeY, baseY + 0.12, baseY + height);
      const shutdown = destroyed ? Math.min(1, state.sinceLifecycleChange / BLUEPRINT_SHUTDOWN_SECONDS) : 0;
      uniforms.uPrintPlane.value.set(
        planeY,
        state.working && !destroyed && !settling ? 1 : 0,
        1 - shutdown,
        1 - state.health,
      );
      uniforms.uPrintClock.value.set(
        time,
        settling ? state.sinceLifecycleChange / SETTLE_SECONDS : 1,
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
