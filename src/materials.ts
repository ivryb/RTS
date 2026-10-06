import * as THREE from "three";
import aerialBeach01Url from "../assets/textures/terrain/sand-scan.webp";
import cliffMarble02Url from "../assets/textures/terrain/cliff-marble-02.webp";
import coastSand05Url from "../assets/textures/terrain/ground-coast-sand-05.webp";
import dirtAerial03Url from "../assets/textures/terrain/ground-dirt-aerial-03.webp";

const textureLoader = new THREE.TextureLoader();
const GROUND_TEXTURE_WORLD_SCALE = 0.6;
const CLIFF_TEXTURE_METERS = 6.8;
export const GROUND_TEXTURES = [
  {
    id: "aerial-beach-01",
    label: "Aerial Beach 01",
    meters: 30,
    url: aerialBeach01Url,
    base: true,
    patches: false,
  },
  {
    id: "coast-sand-05",
    label: "Coast Sand 05",
    meters: 17.5,
    url: coastSand05Url,
    base: false,
    patches: true,
  },
  {
    id: "dirt-aerial-03",
    label: "Dirt Aerial 03",
    meters: 25,
    url: dirtAerial03Url,
    base: false,
    patches: true,
  },
] as const;

export type GroundTextureId = (typeof GROUND_TEXTURES)[number]["id"];
export const BASE_GROUND_TEXTURES = GROUND_TEXTURES.filter(
  (texture) => texture.base
);
export const PATCH_GROUND_TEXTURES = GROUND_TEXTURES.filter(
  (texture) => texture.patches
);
export interface GroundTint {
  h: number;
  s: number;
  l: number;
}

export const DEFAULT_GROUND_TINT: GroundTint = { h: 29, s: 94, l: 75 };
export const groundTintCss = ({ h, s, l }: GroundTint) =>
  `hsl(${h}, ${s}%, ${l}%)`;

let selectedTexture: GroundTextureId = "aerial-beach-01";
let selectedSecondaryTexture: GroundTextureId = "dirt-aerial-03";
let selectedSmoothBorders = true;
let selectedTint = groundTintCss(DEFAULT_GROUND_TINT);

const loadGroundTexture = (
  id: GroundTextureId,
  mapSize: number,
  seed: number
) => {
  const option =
    GROUND_TEXTURES.find((candidate) => candidate.id === id) ??
    GROUND_TEXTURES[0];
  const map = textureLoader.load(option.url);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.setScalar(mapSize / (option.meters * GROUND_TEXTURE_WORLD_SCALE));
  map.center.set(0.5, 0.5);
  map.rotation = ((seed & 3) * Math.PI) / 2;
  map.offset.set(((seed >>> 2) & 15) / 16, ((seed >>> 6) & 15) / 16);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.updateMatrix();
  return map;
};

const loadCliffTexture = () => {
  const map = textureLoader.load(cliffMarble02Url);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
};

interface GroundMaterialSettings {
  mapSize: number;
  seed: number;
  texture: GroundTextureId;
  secondaryTexture: GroundTextureId;
  secondaryMap: THREE.Texture;
  cliffMap: THREE.Texture;
  secondaryMapUniform?: { value: THREE.Texture };
  secondaryTransformUniform?: { value: THREE.Matrix3 };
  smoothBorders: boolean;
  borderUniform?: { value: number };
}

const groundSettings = (material: THREE.MeshStandardMaterial) =>
  material.userData.ground as GroundMaterialSettings;

const setSecondaryTexture = (
  settings: GroundMaterialSettings,
  texture: GroundTextureId
) => {
  if (settings.secondaryTexture === texture) return;
  const oldMap = settings.secondaryMap;
  settings.secondaryMap = loadGroundTexture(
    texture,
    settings.mapSize,
    settings.seed ^ 0x5f3759df
  );
  settings.secondaryTexture = texture;
  if (settings.secondaryMapUniform)
    settings.secondaryMapUniform.value = settings.secondaryMap;
  if (settings.secondaryTransformUniform)
    settings.secondaryTransformUniform.value = settings.secondaryMap.matrix;
  oldMap.dispose();
};

export const getGroundStyle = () => ({
  texture: selectedTexture,
  secondaryTexture: selectedSecondaryTexture,
  smoothBorders: selectedSmoothBorders,
  tint: selectedTint,
});

export const applyGroundStyle = (
  material: THREE.MeshStandardMaterial,
  texture: GroundTextureId,
  secondaryTexture: GroundTextureId,
  smoothBorders: boolean,
  tint: string
) => {
  selectedTexture = texture;
  selectedSecondaryTexture = secondaryTexture;
  selectedSmoothBorders = smoothBorders;
  selectedTint = tint;
  const settings = groundSettings(material);
  if (settings.texture !== texture) {
    const oldMap = material.map;
    material.map = loadGroundTexture(texture, settings.mapSize, settings.seed);
    settings.texture = texture;
    material.needsUpdate = true;
    oldMap?.dispose();
  }
  setSecondaryTexture(settings, secondaryTexture);
  settings.smoothBorders = smoothBorders;
  if (settings.borderUniform)
    settings.borderUniform.value = Number(smoothBorders);
  material.color.set(tint);
};

export const createSandMaterial = (mapSize: number, seed: number, options: {cliffs?: boolean} = {}) => {
  const material = new THREE.MeshStandardMaterial({
    color: selectedTint,
    map: loadGroundTexture(selectedTexture, mapSize, seed),
    roughness: 0.95,
  });
  const settings: GroundMaterialSettings = {
    mapSize,
    seed,
    texture: selectedTexture,
    secondaryTexture: selectedSecondaryTexture,
    smoothBorders: selectedSmoothBorders,
    secondaryMap: loadGroundTexture(
      selectedSecondaryTexture,
      mapSize,
      seed ^ 0x5f3759df
    ),
    cliffMap: loadCliffTexture(),
  };
  material.userData.ground = settings;
  material.onBeforeCompile = (shader) => {
    settings.secondaryMapUniform = shader.uniforms.patchMap = {
      value: settings.secondaryMap,
    };
    settings.secondaryTransformUniform = shader.uniforms.patchMapTransform = {
      value: settings.secondaryMap.matrix,
    };
    settings.borderUniform = shader.uniforms.smoothBorders = {
      value: Number(settings.smoothBorders),
    };
    shader.uniforms.cliffMap = { value: settings.cliffMap };
    shader.uniforms.cliffOffset = {
      value: new THREE.Vector2(((seed >>> 3) & 31) / 31, ((seed >>> 8) & 31) / 31),
    };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float patchWeight;
attribute float mountainWeight;
attribute float mountainFoundationWeight;
uniform mat3 patchMapTransform;
varying float vPatchWeight;
varying vec2 vPatchUv;
varying vec3 vGroundWorldPosition;
varying vec3 vGroundWorldNormal;
varying float vMountainWeight;
varying float vMountainFoundationWeight;`
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
vGroundWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      )
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
vPatchWeight = patchWeight;
vPatchUv = (patchMapTransform * vec3(uv, 1.0)).xy;
vMountainWeight = mountainWeight;
vMountainFoundationWeight = mountainFoundationWeight;`
      )
      .replace(
        "#include <project_vertex>",
`#include <project_vertex>
vGroundWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D patchMap;
uniform sampler2D cliffMap;
uniform vec2 cliffOffset;
uniform float smoothBorders;
varying float vPatchWeight;
varying vec2 vPatchUv;
varying vec3 vGroundWorldPosition;
varying vec3 vGroundWorldNormal;
varying float vMountainWeight;
varying float vMountainFoundationWeight;

float groundHash(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}

float groundNoise(vec2 position) {
  vec2 cell = floor(position);
  vec2 blend = smoothstep(vec2(0.0), vec2(1.0), fract(position));
  return mix(
    mix(groundHash(cell), groundHash(cell + vec2(1.0, 0.0)), blend.x),
    mix(
      groundHash(cell + vec2(0.0, 1.0)),
      groundHash(cell + vec2(1.0, 1.0)),
      blend.x
    ),
    blend.y
  );
}

vec2 groundTileOffset(float variant) {
  return fract(sin(vec2(variant * 127.1, variant * 311.7)) * 43758.5453);
}

vec4 sampleGround(
  sampler2D source,
  vec2 uv,
  float antiTileMix,
  vec2 firstOffset,
  vec2 secondOffset,
  float offsetBlend,
  vec2 uvDx,
  vec2 uvDy
) {
  if (antiTileMix <= 0.0) return textureGrad(source, uv, uvDx, uvDy);

  vec4 smoothed = mix(
    textureGrad(source, uv + firstOffset, uvDx, uvDy),
    textureGrad(source, uv + secondOffset, uvDx, uvDy),
    offsetBlend
  );
  if (antiTileMix >= 1.0) return smoothed;
  return mix(textureGrad(source, uv, uvDx, uvDy), smoothed, antiTileMix);
}`
      )
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
float antiTileMix = smoothBorders;
float variation = groundNoise(vGroundWorldPosition.xz * 0.02) * 6.0;
float offsetBlend = smoothstep(0.15, 0.85, fract(variation));
vec2 firstOffset = groundTileOffset(floor(variation));
vec2 secondOffset = groundTileOffset(floor(variation) + 1.0);
vec2 patchUvDx = dFdx(vPatchUv), patchUvDy = dFdy(vPatchUv);
vec4 sampledDiffuseColor = sampleGround(
  map,
  vMapUv,
  antiTileMix,
  firstOffset,
  secondOffset,
  offsetBlend,
  dFdx(vMapUv), dFdy(vMapUv)
);
float patchBlend = vPatchWeight * 0.5;
if (patchBlend > 0.001) {
  vec4 patchDiffuseColor = sampleGround(
    patchMap,
    vPatchUv,
    antiTileMix,
    firstOffset,
    secondOffset,
    offsetBlend,
    patchUvDx, patchUvDy
  );
  patchDiffuseColor.rgb *= vec3(0.88, 0.78, 0.66);
  sampledDiffuseColor = mix(sampledDiffuseColor, patchDiffuseColor, patchBlend);
}
diffuseColor *= sampledDiffuseColor;
${options.cliffs === false ? "" : `
vec2 mountainUv = vGroundWorldPosition.xz / 18.0;
vec4 mountainDiffuseColor = texture2D(cliffMap, mountainUv);
vec4 mountainFoundationDiffuse = sampleGround(
  patchMap,
  vPatchUv,
  antiTileMix,
  firstOffset,
  secondOffset,
  offsetBlend,
  patchUvDx, patchUvDy
);
float mountainBrightness = 0.60;
vec3 mountainRockColor = mountainDiffuseColor.rgb * mountainBrightness;
float foundationDetail = dot(
  mountainFoundationDiffuse.rgb,
  vec3(0.2126, 0.7152, 0.0722)
);
vec3 mountainFoundationColor =
  mountainRockColor * mix(0.92, 1.08, foundationDetail);
float mountainFoundationBlend =
  smoothstep(0.01, 0.4, vMountainFoundationWeight) * 0.6;
float mountainBlend = smoothstep(0.05, 0.95, vMountainWeight);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  mountainFoundationColor,
  mountainFoundationBlend
);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  mountainRockColor,
  mountainBlend
);
vec3 cliffWorldNormal = normalize(vGroundWorldNormal);
vec3 cliffNormal = abs(cliffWorldNormal);
// Keep the fade near cliff slopes, but do not square it: that sharpening made
// the rock look like a texture strip pasted between two hard borders.
float cliffSlope = 1.0 - smoothstep(0.55, 0.82, cliffNormal.y);
float cliffBlend = cliffSlope;
float xDirection = cliffWorldNormal.x < 0.0 ? -1.0 : 1.0;
float zDirection = cliffWorldNormal.z < 0.0 ? -1.0 : 1.0;
vec2 cliffUvX = vec2(vGroundWorldPosition.z * xDirection, vGroundWorldPosition.y)
  / ${CLIFF_TEXTURE_METERS.toFixed(1)} + cliffOffset;
vec2 cliffUvZ = vec2(-vGroundWorldPosition.x * zDirection, vGroundWorldPosition.y)
  / ${CLIFF_TEXTURE_METERS.toFixed(1)} + cliffOffset.yx;
vec2 cliffUvXDx = dFdx(cliffUvX);
vec2 cliffUvXDy = dFdy(cliffUvX);
vec2 cliffUvZDx = dFdx(cliffUvZ);
vec2 cliffUvZDy = dFdy(cliffUvZ);
if (cliffBlend > 0.001) {
  vec3 cliffWeights = pow(cliffNormal, vec3(6.0));
  cliffWeights /= max(cliffWeights.x + cliffWeights.y + cliffWeights.z, 0.0001);
  vec4 cliffDiffuseX = textureGrad(cliffMap, cliffUvX, cliffUvXDx, cliffUvXDy);
  vec4 cliffDiffuseZ = textureGrad(cliffMap, cliffUvZ, cliffUvZDx, cliffUvZDy);
  vec3 cliffFaceNormal = abs(normalize(cross(
    dFdx(vGroundWorldPosition),
    dFdy(vGroundWorldPosition)
  )));
  float cliffFaceSlope = 1.0 - smoothstep(0.616, 0.766, cliffFaceNormal.y);
  float cliffRock = 1.0 - smoothstep(0.28, 0.72, cliffNormal.y);
  float cliffDetail =
    cliffRock *
    smoothstep(0.15, 0.75, cliffFaceSlope);
  vec3 cliffTint = mix(
    vec3(0.78, 0.72, 0.66),
    vec3(mountainBrightness),
    mountainBlend
  );
  cliffDiffuseX.rgb *= cliffTint;
  cliffDiffuseZ.rgb *= cliffTint;
  vec3 edgeColor = diffuseColor.rgb * vec3(0.88, 0.82, 0.76);
  cliffDiffuseX.rgb = mix(edgeColor, cliffDiffuseX.rgb, cliffDetail);
  cliffDiffuseZ.rgb = mix(edgeColor, cliffDiffuseZ.rgb, cliffDetail);
  vec4 cliffDiffuseColor =
    cliffDiffuseX * cliffWeights.x +
    vec4(diffuseColor.rgb, 1.0) * cliffWeights.y +
    cliffDiffuseZ * cliffWeights.z;
  diffuseColor.rgb = mix(diffuseColor.rgb, cliffDiffuseColor.rgb, cliffBlend);
}
`}
#endif`
      );
  };
  material.customProgramCacheKey = () => `sand-cliffs-${options.cliffs !== false}`;
  material.addEventListener("dispose", () => {
    settings.secondaryMap.dispose();
    settings.cliffMap.dispose();
  });
  return material;
};
