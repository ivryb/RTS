import * as THREE from "three";

/**
 * Shows a building only up to a rising cut height: everything above is discarded and the
 * newest band below the cut is still bare steel. The main hull's opening is closed by a deck
 * (`deck.ts`); a thin part the deck leaves alone, such as a mast, is capped here.
 * It expects the baked atlas of `tools/assets/building_bake.py` (contact shading in the red
 * channel of the roughness map) and falls back to the plain band without it.
 * One shader program serves every site; each site owns only its uniforms.
 */
export interface Reveal {
  /**
   * `cut` is a world height, `band` the metres of bare steel below it, and `work` runs from
   * 0 (cold, nobody building) to 1 (hot seam and glowing cap).
   */
  set(cut: number, band: number, work: number): void;
  /** Hands the meshes back their own materials, so the building renders as it always does. */
  finish(): void;
  dispose(): void;
}

const PROGRAM_KEY = "d77-scaffold-reveal";

/** The bare structure of a half-built hull, shared by the deck and by the building's own cut. */
export const structureGlsl = /* glsl */ `
const vec3 SITE_STEEL = vec3(0.045, 0.038, 0.031);
const vec3 SITE_RIB = vec3(0.15, 0.1, 0.052);
const vec3 SITE_HOT_RIB = vec3(0.44, 0.17, 0.04);
const vec3 SITE_HOT_SEAM = vec3(2.6, 1.05, 0.26);
// Structural ribs every half metre, at a point of the building's own ground frame.
float siteRibs(vec2 local) {
  vec2 cell = abs(fract(local / 0.5) - 0.5);
  return smoothstep(0.42, 0.46, max(cell.x, cell.y));
}
// The flat deck that closes a cut; work runs from 0 (cold) to 1 (ribs glowing).
vec3 siteDeck(vec2 local, float work) {
  float rib = siteRibs(local);
  return mix(SITE_STEEL * 0.75, SITE_RIB, rib) + work * mix(vec3(0.035, 0.014, 0.004), SITE_HOT_RIB, rib);
}
`;

const sharedFragment = /* glsl */ `
uniform float uSiteCut;
uniform float uSiteBand;
uniform float uSiteWork;
uniform vec4 uSiteFrame;
varying vec3 vSitePosition;
${structureGlsl}
vec2 siteLocal(vec2 world) {
  vec2 offset = world - uSiteFrame.xy;
  return vec2(uSiteFrame.z * offset.x - uSiteFrame.w * offset.y, uSiteFrame.w * offset.x + uSiteFrame.z * offset.y);
}
`;

// The newest band under the cut is still bare steel, and so is every face the finished hull
// seals inside itself: the atlas keeps the bake's contact shading in its red channel, where
// zero means fully enclosed. Bare faces that look up are decks, ribbed like the cap, so
// floors inside the hull and the cap read as one structure.
const bareSteel = /* glsl */ `
float siteDepth = uSiteCut - vSitePosition.y;
float siteUp = dot(viewMatrix[1].xyz, normalize(vNormal));
float siteFresh = uSiteBand > 0.001 ? 1.0 - smoothstep(uSiteBand * 0.7, uSiteBand, siteDepth) : 0.0;
float siteBare = siteFresh;
#ifdef USE_ROUGHNESSMAP
  siteBare = max(siteBare, 1.0 - smoothstep(0.04, 0.12, texelRoughness.r));
#endif
float siteFloor = smoothstep(0.8, 0.95, siteUp) * siteRibs(siteLocal(vSitePosition.xz));
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
  gl_FragColor = vec4(siteDeck(siteLocal(siteCap.xz), uSiteWork), 1.0);
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

export const createReveal = (root: THREE.Object3D, visual: THREE.Object3D): Reveal => {
  const uniforms = {
    uSiteCut: { value: 0 },
    uSiteBand: { value: 0 },
    uSiteWork: { value: 0 },
    uSiteFrame: {
      value: new THREE.Vector4(
        root.position.x,
        root.position.z,
        Math.cos(root.rotation.y),
        Math.sin(root.rotation.y),
      ),
    },
  };

  // The shadow pass uses the same cut, so a half-built site casts a half-height shadow.
  const depth = new THREE.MeshDepthMaterial();
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    trackPosition(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uSiteCut;\nvarying vec3 vSitePosition;")
      .replace(
        "#include <clipping_planes_fragment>",
        "#include <clipping_planes_fragment>\nif (vSitePosition.y > uSiteCut) discard;",
      );
  };
  depth.customProgramCacheKey = () => `${PROGRAM_KEY}-depth`;

  const cutMaterials = new Map<THREE.Material, THREE.Material>();
  const cutMaterial = (source: THREE.Material) => {
    let material = cutMaterials.get(source);
    if (material) return material;
    material = source.clone();
    material.side = THREE.DoubleSide;
    material.shadowSide = source.shadowSide ?? THREE.BackSide;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      trackPosition(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${sharedFragment}`)
        .replace(
          "#include <clipping_planes_fragment>",
          "#include <clipping_planes_fragment>\nif (vSitePosition.y > uSiteCut) discard;",
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
      if (hits[index].point.y <= uniforms.uSiteCut.value) hits[kept++] = hits[index];
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
    set(cutHeight, band, work) {
      uniforms.uSiteCut.value = cutHeight;
      uniforms.uSiteBand.value = band;
      uniforms.uSiteWork.value = work;
      apply(true);
    },
    finish: () => apply(false),
    dispose() {
      apply(false);
      depth.dispose();
      for (const material of cutMaterials.values()) material.dispose();
    },
  };
};
