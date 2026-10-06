import * as THREE from 'three';
import { createSandMaterial } from '../materials';

export interface TerrainRockLook {
  colorUrl: string;
  normalUrl: string;
  roughnessUrl: string;
  meters: number;
  tint: THREE.ColorRepresentation;
  normalStrength: number;
}

interface GroundSurfaceLook {colorUrl:string; normalUrl:string; meters:number; normalStrength:number}
export interface TerrainBiomeGroundLook {
  oasis:GroundSurfaceLook;
  caprock:GroundSurfaceLook;
  talus:GroundSurfaceLook;
}

/** Production ground blending, with the shared continuous cliff contact. */
export function createMapTerrainMaterial(size: number, seed: number, look?: TerrainRockLook, biomeGround?:TerrainBiomeGroundLook) {
  const material = createSandMaterial(size, seed, {cliffs:false});
  const ownedTextures:THREE.Texture[]=[];
  const loader = new THREE.TextureLoader();
  const loadTexture=(url:string,color=false)=>{
    const texture=loader.load(url);
    if(color)texture.colorSpace=THREE.SRGBColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.anisotropy=8;
    ownedTextures.push(texture);
    return texture;
  };
  const rockTextures = look ? (() => {
    const color = loadTexture(look.colorUrl,true);
    const normal = loadTexture(look.normalUrl);
    const roughness = loadTexture(look.roughnessUrl);
    return {color, normal, roughness};
  })() : undefined;
  const biomeTextures=biomeGround?{
    oasisColor:loadTexture(biomeGround.oasis.colorUrl,true),
    oasisNormal:loadTexture(biomeGround.oasis.normalUrl),
    caprock:loadTexture(biomeGround.caprock.colorUrl,true),
    caprockNormal:loadTexture(biomeGround.caprock.normalUrl),
    talusColor:loadTexture(biomeGround.talus.colorUrl,true),
    talusNormal:loadTexture(biomeGround.talus.normalUrl),
  }:undefined;
  material.addEventListener('dispose',()=>{for(const texture of ownedTextures)texture.dispose();});
  const groundCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    groundCompile(shader, renderer);
    shader.uniforms.rockTint = { value: look ? new THREE.Color(look.tint) : new THREE.Color().setHSL(.065,.26,.49) };
    shader.uniforms.rockMeters = {value: look?.meters ?? 8};
    if (rockTextures) shader.uniforms.cliffMap.value = rockTextures.color;
    const varyings = 'varying vec3 rockPosition;\nvarying vec3 rockSurfaceNormal;\nvarying float edge;\nvarying float contactDistance;\n';
    shader.vertexShader = 'attribute float rockEdge;\nattribute float rockDistance;\n' + varyings + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nrockPosition = position;\nrockSurfaceNormal = objectNormal;\nedge = rockEdge;\ncontactDistance = rockDistance;',
    );
    if(biomeTextures&&biomeGround){
      shader.uniforms.oasisGroundMap={value:biomeTextures.oasisColor};
      shader.uniforms.caprockMap={value:biomeTextures.caprock};
      shader.uniforms.caprockNormalMap={value:biomeTextures.caprockNormal};
      shader.uniforms.caprockNormalStrength={value:biomeGround.caprock.normalStrength};
      shader.uniforms.biomeGroundMeters={value:biomeGround.oasis.meters};
      shader.uniforms.caprockMeters={value:biomeGround.caprock.meters};
      shader.uniforms.oasisGroundNormal={value:biomeTextures.oasisNormal};
      shader.uniforms.biomeNormalStrength={value:biomeGround.oasis.normalStrength};
      shader.uniforms.talusMap={value:biomeTextures.talusColor};
      shader.uniforms.talusNormalMap={value:biomeTextures.talusNormal};
      shader.uniforms.talusMeters={value:biomeGround.talus.meters};
      shader.uniforms.talusNormalStrength={value:biomeGround.talus.normalStrength};
      shader.vertexShader='attribute vec2 biomeWeight;\nvarying vec2 biomeMask;\n'+shader.vertexShader.replace(
        '#include <begin_vertex>','#include <begin_vertex>\nbiomeMask=biomeWeight;');
      shader.fragmentShader=`
        varying vec2 biomeMask;
        uniform sampler2D oasisGroundMap, caprockMap;
        uniform sampler2D oasisGroundNormal;
        uniform float biomeGroundMeters, biomeNormalStrength;
        uniform float caprockMeters, caprockNormalStrength;
        uniform sampler2D caprockNormalMap;
        uniform sampler2D talusMap, talusNormalMap;
        uniform float talusMeters, talusNormalStrength;
      `+shader.fragmentShader;
    }
    // The production ground runs unchanged; only its cliff treatment is replaced here.
    shader.fragmentShader = `
      uniform vec3 rockTint;
      uniform float rockMeters;
      vec3 sampleRock(sampler2D source, vec3 uv, vec3 uvDx, vec3 uvDy, vec3 weights) {
        vec3 sampled = vec3(0.0);
        if (weights.x > 0.0) sampled += textureGrad(source, uv.zy, uvDx.zy, uvDy.zy).rgb * weights.x;
        if (weights.y > 0.0) sampled += textureGrad(source, uv.xz, uvDx.xz, uvDy.xz).rgb * weights.y;
        if (weights.z > 0.0) sampled += textureGrad(source, uv.xy, uvDx.xy, uvDy.xy).rgb * weights.z;
        return sampled;
      }
    ` + varyings + shader.fragmentShader.replace('#include <color_fragment>', `
      // Material blends must be continuous across shared terrain edges. Face
      // derivatives choose a different projection for each triangle, exposing
      // bright triangular patches at close range even without normal maps.
      vec3 surfaceDirection = normalize(rockSurfaceNormal);
      // Continuous weights join weathered caps to stratified faces through the
      // shoulders. Zero-weight axes still skip texture reads.
      vec3 weights = ${look
        ? 'pow(max(abs(surfaceDirection) - vec3(.15), vec3(0.0)), vec3(4.0))'
        : 'pow(abs(surfaceDirection), vec3(4.0))'};
      // Derivatives only control texture filtering and tangent frames; compute
      // them outside sampling branches to keep mip selection well-defined.
      vec3 positionDx = dFdx(rockPosition), positionDy = dFdy(rockPosition);
      weights /= max(dot(weights, vec3(1.0)), 0.0001);
      vec3 p = rockPosition / rockMeters;
      vec3 pDx = positionDx / rockMeters, pDy = positionDy / rockMeters;

      // Deposits have broad lobes, exposed fragments and sand-filled gaps, not a wider blur.
      float deposits=groundNoise(rockPosition.xz*.19+vec2(31.,17.));
      float channels=groundNoise(rockPosition.xz*.55+vec2(7.,43.));
      float apronWidth=1.8+6.0*deposits*deposits;
      float apron=1.0-smoothstep(.35,apronWidth,contactDistance);
      float breakup=(channels-.5)*1.3+(groundNoise(rockPosition.xz*1.4)-.5)*.18;
      float sandTongues=(deposits-.5)*2.0;
      float amount=smoothstep(-.35,.35,edge+breakup-sandTongues);
      float summitDeposit=smoothstep(17.0,21.0,rockPosition.y)*smoothstep(.7,.94,abs(surfaceDirection.y));
      vec3 rockColor = vec3(0.0);
      if (amount > 0.0${biomeTextures?' || summitDeposit > 0.0':''}) {
        rockColor = sampleRock(cliffMap, p, pDx, pDy, ${biomeTextures?'vec3(weights.x,0.0,weights.z)':'weights'}) * rockTint;
        ${biomeTextures?`
        // Use a nondirectional exposed-rock scan on crowns. Cliff bands belong
        // on the faces, not folded across a horizontal erosion surface.
        if (weights.y > 0.0) rockColor += textureGrad(caprockMap,rockPosition.xz/caprockMeters,positionDx.xz/caprockMeters,positionDy.xz/caprockMeters).rgb * weights.y;
        `:''}
      }
      vec3 fragments = vec3(0.0);
      if (apron * (1.0-amount)${biomeTextures?' * (1.0-summitDeposit)':''} > 0.0${biomeTextures?'':' || summitDeposit > 0.0'}) {
        fragments = textureGrad(cliffMap, rockPosition.xz/2.2, positionDx.xz/2.2, positionDy.xz/2.2).rgb * rockTint;
      }
      float grain=groundNoise(rockPosition.xz*3.4);
      float pockets=groundNoise(rockPosition.xz*1.1+vec2(11.,29.));
      float chips=smoothstep(.50,.57,grain*.55+pockets*.45+(apron-.5)*.35);
      vec3 sand=diffuseColor.rgb;
      ${biomeTextures?`
      float groundBlend=clamp(biomeMask.x,0.0,1.0)*smoothstep(.68,.94,abs(surfaceDirection.y));
      vec2 oasisGroundUv=rockPosition.xz/biomeGroundMeters;
      vec2 talusUv=rockPosition.xz/talusMeters;
      float talusBlend=clamp(biomeMask.y,0.0,1.0)*smoothstep(.5,.9,abs(surfaceDirection.y));
      if (talusBlend > 0.0) {
        vec3 looseRock=textureGrad(talusMap,talusUv,positionDx.xz/talusMeters,positionDy.xz/talusMeters).rgb;
        sand=mix(sand,looseRock,talusBlend);
      }
      if (groundBlend > 0.0) {
        sand=mix(sand,textureGrad(oasisGroundMap,oasisGroundUv,positionDx.xz/biomeGroundMeters,positionDy.xz/biomeGroundMeters).rgb,groundBlend);
      }
      `:''}
      // Thin summit deposits retain crushed parent rock, especially at their margins.
      // Use the existing rock scan for mineral detail rather than tinting a uniform patch.
      ${biomeTextures?`
      // Thin dust retains the parent rock detail. Opaque summit color made the
      // height transition read as a painted band instead of settled sediment.
      if (summitDeposit > 0.0) {
        vec3 mineralSand=mix(rockColor,textureGrad(caprockMap,rockPosition.xz/caprockMeters,positionDx.xz/caprockMeters,positionDy.xz/caprockMeters).rgb,.22);
        sand=mix(sand,mineralSand,summitDeposit);
      }
      `:`
      float mineralDetail=dot(fragments,vec3(.299,.587,.114));
      vec3 mineralSand=sand*(.88+.3*mineralDetail);
      float rubble=smoothstep(.56,.7,grain*.35+pockets*.65);
      mineralSand=mix(mineralSand,mix(fragments,sand,.55),rubble*.45);
      sand=mix(sand,mineralSand,summitDeposit*(1.0-amount));
      float margin=(1.0-smoothstep(0.0,3.5,contactDistance))*summitDeposit;
      sand=mix(sand,mix(fragments,sand,.48),margin*chips*.45);
      `}
      diffuseColor.rgb=sand;
      vec3 dustyRock=mix(fragments,sand,.42);
      vec3 depositColor=mix(sand*.94,dustyRock,chips*.85);
      diffuseColor.rgb=mix(sand,depositColor,apron*(1.0-amount)${biomeTextures?'*(1.0-summitDeposit)':''});
      diffuseColor.rgb=mix(diffuseColor.rgb,rockColor,amount);
      #include <color_fragment>
    `);
    if (rockTextures && look) {
      shader.uniforms.rockNormalMap = {value: rockTextures.normal};
      shader.uniforms.rockRoughnessMap = {value: rockTextures.roughness};
      shader.uniforms.rockNormalStrength = {value: look.normalStrength};
      // Each projection needs its own tangent frame. Ground UV tangents stretch
      // the scan across steep faces and incorrectly orient its fracture lighting.
      shader.fragmentShader = `
        uniform sampler2D rockNormalMap;
        uniform sampler2D rockRoughnessMap;
        uniform float rockNormalStrength;
        vec3 projectedSurfaceNormal(sampler2D source, float strength, vec2 uv, vec2 st0, vec2 st1, vec3 q0, vec3 q1, vec3 surfaceNormal) {
          vec3 q1perp = cross(q1, surfaceNormal);
          vec3 q0perp = cross(surfaceNormal, q0);
          vec3 tangent = q1perp * st0.x + q0perp * st1.x;
          vec3 bitangent = q1perp * st0.y + q0perp * st1.y;
          float frameScale = inversesqrt(max(max(dot(tangent,tangent),dot(bitangent,bitangent)), 1e-12));
          vec3 detail = textureGrad(source, uv, st0, st1).xyz * 2.0 - 1.0;
          detail.xy *= strength;
          return normalize(tangent * frameScale * detail.x + bitangent * frameScale * detail.y + surfaceNormal * detail.z);
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        if (amount > 0.0) {
          float rockRoughness = sampleRock(rockRoughnessMap, p, pDx, pDy, ${biomeTextures?'vec3(weights.x,0.0,weights.z)':'weights'}).r${biomeTextures?' + .9 * weights.y':''};
          roughnessFactor = mix(roughnessFactor, max(.68, rockRoughness), amount);
        }
      `).replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        vec3 eyeDx = dFdx(-vViewPosition), eyeDy = dFdy(-vViewPosition);
        ${biomeTextures?`
        float bareGround=(1.0-amount)*(1.0-summitDeposit);
        if (talusBlend * bareGround > 0.0) {
          vec3 talusNormal=projectedSurfaceNormal(talusNormalMap,talusNormalStrength,talusUv,positionDx.xz/talusMeters,positionDy.xz/talusMeters,eyeDx,eyeDy,normal);
          normal=normalize(mix(normal,talusNormal,talusBlend*bareGround));
        }
        if (groundBlend * bareGround > 0.0) {
          vec3 oasisNormal=projectedSurfaceNormal(oasisGroundNormal,biomeNormalStrength,oasisGroundUv,positionDx.xz/biomeGroundMeters,positionDy.xz/biomeGroundMeters,eyeDx,eyeDy,normal);
          normal=normalize(mix(normal,oasisNormal,groundBlend*bareGround));
        }
        `:''}
        float rockNormalBlend = ${biomeTextures?'amount+(1.0-amount)*summitDeposit*.58':'amount'};
        if (rockNormalBlend > 0.0) {
          vec3 detailedRockNormal = vec3(0.0);
          if (weights.x > 0.0) detailedRockNormal += projectedSurfaceNormal(rockNormalMap,rockNormalStrength,p.zy,pDx.zy,pDy.zy,eyeDx,eyeDy,normal) * weights.x;
          if (weights.y > 0.0) detailedRockNormal += ${biomeTextures
            ? 'projectedSurfaceNormal(caprockNormalMap,caprockNormalStrength,rockPosition.xz/caprockMeters,positionDx.xz/caprockMeters,positionDy.xz/caprockMeters,eyeDx,eyeDy,normal)'
            : 'projectedSurfaceNormal(rockNormalMap,rockNormalStrength,p.xz,pDx.xz,pDy.xz,eyeDx,eyeDy,normal)'} * weights.y;
          if (weights.z > 0.0) detailedRockNormal += projectedSurfaceNormal(rockNormalMap,rockNormalStrength,p.xy,pDx.xy,pDy.xy,eyeDx,eyeDy,normal) * weights.z;
          normal = normalize(mix(normal, normalize(detailedRockNormal), rockNormalBlend));
        }
      `);
    }
  };
  material.customProgramCacheKey = () => `${look?'production-ground-authored-cliffs-v3':'production-ground-procedural-cliffs-v4'}${biomeGround?'-oasis-talus-caprock-v4':''}-continuous-projection-v2`;
  return material;
}
