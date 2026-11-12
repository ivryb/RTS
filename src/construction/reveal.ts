import * as THREE from "three";

/**
 * Shows a building only up to a rising cut height. Below the cut it is the finished model,
 * with its newest band still bare steel; everything above the cut is discarded. The main hull's opening is closed
 * by a deck (`deck.ts`); a thin part the deck leaves alone, such as a mast, is capped here.
 * It expects the baked atlas of `tools/assets/building_bake.py` (contact shading in the red
 * channel of the roughness map) and falls back to the plain band without it.
 * One shader program serves every site; each site owns only its uniforms.
 */
export interface Reveal {
  /**
   * `cut` is a world height and `band` the metres of bare steel below it. `work` runs from 0
   * (cold, nobody building) to 1 (hot seam and glowing cap). Nothing farther than `reach`
   * metres from the building's axis is drawn, which is how the first layer spreads out from
   * under the drone's beam.
   */
  set(cut: number, band: number, work: number, reach: number): void;
  /** Fades the cut building out as one solid, from 1 (opaque) to 0. */
  setOpacity(opacity: number): void;
  /** Hands the meshes back their own materials, so the building renders as it always does. */
  finish(): void;
  dispose(): void;
}

const PROGRAM_KEY = "d77-construction-reveal";

/** The bare structure of a half-built hull, shared by the deck and by the building's own cut. */
export const structureGlsl = /* glsl */ `
const vec3 SITE_STEEL = vec3(0.045, 0.038, 0.031);
const vec3 SITE_RIB = vec3(0.15, 0.1, 0.052);
const vec3 SITE_HOT_RIB = vec3(0.44, 0.17, 0.04);
const vec3 SITE_HOT_SEAM = vec3(2.6, 1.05, 0.26);
// Beams on a square grid, pitch metres apart and half metres wide either side of their line,
// at a point of the building's own ground frame. Thin beams fade instead of flickering.
float siteBeams(vec2 local, float pitch, float halfWidth) {
  vec2 offset = abs(fract(local / pitch + 0.5) - 0.5) * pitch;
  vec2 blur = max(fwidth(local), vec2(0.0001));
  vec2 cover = clamp((halfWidth - offset) / blur + 0.5, 0.0, 1.0);
  return max(cover.x, cover.y);
}
// The flat deck that closes a cut: ribs every half metre; heat runs from 0 (cold) to 1 (glowing).
vec3 siteDeck(vec2 local, float heat) {
  float rib = siteBeams(local, 0.5, 0.03);
  return mix(SITE_STEEL * 0.75, SITE_RIB, rib) + heat * mix(vec3(0.035, 0.014, 0.004), SITE_HOT_RIB, rib);
}
`;

// What is not built yet is discarded here, for the picture and for the shadow alike.
const clipGlsl = /* glsl */ `
uniform float uSiteCut;
uniform float uSiteReach;
uniform vec4 uSiteFrame;
varying vec3 vSitePosition;
vec2 siteLocal(vec2 world) {
  vec2 offset = world - uSiteFrame.xy;
  return vec2(uSiteFrame.z * offset.x - uSiteFrame.w * offset.y, uSiteFrame.w * offset.x + uSiteFrame.z * offset.y);
}
// Returns the metres a fragment lies below the cut.
float siteClip() {
  vec2 local = siteLocal(vSitePosition.xz);
  if (vSitePosition.y > uSiteCut || dot(local, local) > uSiteReach * uSiteReach) discard;
  return uSiteCut - vSitePosition.y;
}
`;

const sharedFragment = /* glsl */ `
uniform float uSiteBand;
uniform float uSiteWork;
${clipGlsl}
${structureGlsl}
`;

// The newest band under the cut is still bare steel, and so is every face the finished hull
// seals inside itself: the atlas keeps the bake's contact shading in its red channel, where
// zero means fully enclosed. Sealed faces that look up are decks, ribbed like the cap, so
// floors inside the hull and the cap read as one structure. An outer face that looks up, such
// as a shoulder, gets no ribs: a grid fading out across it read as z-fighting.
const bareSteel = /* glsl */ `
float siteUp = dot(viewMatrix[1].xyz, normalize(vNormal));
float siteFresh = uSiteBand > 0.001 ? 1.0 - smoothstep(uSiteBand * 0.7, uSiteBand, siteDepth) : 0.0;
float siteSealed = 0.0;
#ifdef USE_ROUGHNESSMAP
  siteSealed = 1.0 - smoothstep(0.04, 0.12, texelRoughness.r);
#endif
float siteBare = max(siteFresh, siteSealed);
float siteFloor = smoothstep(0.8, 0.95, siteUp) * siteSealed * siteBeams(siteLocal(vSitePosition.xz), 0.5, 0.03);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(SITE_STEEL, SITE_RIB, siteFloor), siteBare * 0.94);
metalnessFactor *= 1.0 - siteBare;
`;

// The seam is the top edge of a wall; a deck lying just under the cut glows along its ribs
// instead of lighting up as one flat plate.
const hotSeam = /* glsl */ `
float siteSeam = (1.0 - smoothstep(0.45, 0.85, abs(siteUp))) * (1.0 - smoothstep(0.0, 0.08, siteDepth));
totalEmissiveRadiance += uSiteWork * (siteSeam * SITE_HOT_SEAM + siteFresh * siteFloor * SITE_HOT_RIB);
`;

// A back face seen through the opening is drawn as the point where the view ray crosses the
// cut plane, which caps a closed shell without a stencil pass. Only parts the deck does not
// cover show it.
const cap = /* glsl */ `
if (!gl_FrontFacing) {
  vec3 siteRay = isOrthographic
    ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])
    : normalize(cameraPosition - vSitePosition);
  vec3 siteCap = vSitePosition + siteRay * ((uSiteCut - vSitePosition.y) / siteRay.y);
  gl_FragColor = vec4(siteDeck(siteLocal(siteCap.xz), uSiteWork * 0.5), gl_FragColor.a);
}
`;

const trackPosition = (shader: { vertexShader: string }) => {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vSitePosition;")
    .replace(
      "#include <project_vertex>",
      "#include <project_vertex>\nvSitePosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    );
};

/** `root` is the building's root, turned only about its vertical axis; `visual` holds its model. */
export const createReveal = (root: THREE.Object3D, visual: THREE.Object3D): Reveal => {
  const uniforms = {
    uSiteCut: { value: 0 },
    uSiteBand: { value: 0 },
    uSiteOpacity: { value: 1 },
    uSiteWork: { value: 0 },
    uSiteReach: { value: 0 },
    uSiteFrame: {
      value: new THREE.Vector4(
        root.position.x,
        root.position.z,
        Math.cos(root.rotation.y),
        Math.sin(root.rotation.y),
      ),
    },
  };

  // The shadow pass uses the same cut, so a half-built site casts a half-height shadow. A
  // fading site's shadow thins out with it, one scattered texel at a time, or the shadow
  // would outlast the building and vanish in one frame.
  const depth = new THREE.MeshDepthMaterial({ name: "Construction cut shadow" });
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    trackPosition(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uSiteOpacity;\n${clipGlsl}`)
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
siteClip();
if (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= uSiteOpacity) discard;`,
      );
  };
  depth.customProgramCacheKey = () => `${PROGRAM_KEY}-depth`;

  const cutMaterials = new Map<THREE.Material, THREE.Material>();
  const cutMaterial = (source: THREE.Material) => {
    let material = cutMaterials.get(source);
    if (material) return material;
    material = source.clone();
    material.name = "Construction cut";
    material.side = THREE.DoubleSide;
    material.shadowSide = source.shadowSide ?? THREE.BackSide;
    // Fading keeps writing depth, so the hull fades as one solid and needs no second pass.
    material.forceSinglePass = true;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      trackPosition(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${sharedFragment}`)
        .replace(
          "#include <clipping_planes_fragment>",
          "#include <clipping_planes_fragment>\nfloat siteDepth = siteClip();",
        )
        .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${bareSteel}`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${hotSeam}`)
        .replace("#include <opaque_fragment>", `#include <opaque_fragment>\n${cap}`);
    };
    material.customProgramCacheKey = () => PROGRAM_KEY;
    cutMaterials.set(source, material);
    return material;
  };

  const meshes: { mesh: THREE.Mesh; finished: THREE.Material; cut: THREE.Material }[] = [];
  visual.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    meshes.push({ mesh: object, finished: object.material, cut: cutMaterial(object.material) });
  });

  // A click ray ignores the shader's discard, so drop its hits on the part not built yet.
  function raycastBuiltPart(this: THREE.Mesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
    let kept = hits.length;
    THREE.Mesh.prototype.raycast.call(this, raycaster, hits);
    for (let index = kept; index < hits.length; index += 1) {
      if (hits[index]!.point.y <= uniforms.uSiteCut.value) hits[kept++] = hits[index]!;
    }
    hits.length = kept;
  }

  let cutting = false;
  const apply = (next: boolean) => {
    if (next === cutting) return;
    cutting = next;
    for (const { mesh, finished, cut } of meshes) {
      mesh.material = next ? cut : finished;
      mesh.customDepthMaterial = next ? depth : undefined;
      if (next) mesh.raycast = raycastBuiltPart;
      else delete (mesh as Partial<THREE.Mesh>).raycast;
    }
  };

  return {
    set(cutHeight, band, work, reach) {
      uniforms.uSiteCut.value = cutHeight;
      uniforms.uSiteBand.value = band;
      uniforms.uSiteWork.value = work;
      uniforms.uSiteReach.value = reach;
      apply(true);
    },
    setOpacity(opacity) {
      uniforms.uSiteOpacity.value = opacity;
      for (const material of cutMaterials.values()) {
        // Blending is a different shader program, so the material has to be rebuilt once.
        if (material.transparent !== opacity < 1) material.needsUpdate = true;
        material.transparent = opacity < 1;
        material.opacity = opacity;
      }
    },
    finish: () => apply(false),
    dispose() {
      apply(false);
      depth.dispose();
      for (const material of cutMaterials.values()) material.dispose();
    },
  };
};
