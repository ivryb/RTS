import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { createTerrainEnvironment } from './mapGenerators/environment';
import type { BiomePlacement } from './mapGenerators/biomeFeatures';
import { sampleMapField } from './mapGenerators/sampling';

const modelUrls = [
  new URL('../assets/models/terrain/talus.glb', import.meta.url),
  new URL('../assets/models/terrain/pebbles.glb', import.meta.url),
  new URL('../assets/models/terrain/tree.glb', import.meta.url),
  new URL('../assets/models/terrain/sage.glb', import.meta.url),
  new URL('../assets/models/terrain/oasis-grass.glb', import.meta.url),
  new URL('../assets/models/terrain/rooibos.glb', import.meta.url),
];

/** Instance the approved rocks and vegetation; callers own readiness and disposal. */
export function createEnvironmentProps(environment: ReturnType<typeof createTerrainEnvironment>) {
  const { layout, features } = environment;
  const heightAt = (x: number, z: number) => sampleMapField(layout, layout.heights, x, z);
  const group = new THREE.Group(), vegetation = new THREE.Group();
  group.name = 'Terrain environment';
  vegetation.name = 'Vegetation';
  group.add(vegetation);
  const batches = new Set<THREE.InstancedMesh>();
  let disposed = false;
  const sources: THREE.Object3D[] = [];

  function scatter(source: THREE.Object3D, parent: THREE.Group, placements: BiomePlacement[], options: {
    normalizeByHeight?: boolean; castShadow?: boolean; alignToGround?: boolean;
    verticalScale?: (point: BiomePlacement) => number;
  } = {}) {
    if (!placements.length) return;
    const { normalizeByHeight: height = false, castShadow = true, alignToGround = false, verticalScale } = options;
    const template = source.clone(true);
    template.position.set(0, 0, 0);
    template.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(template), extent = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    // Plant origins mark their roots. Centering an asymmetric crown instead
    // shifts the trunk away from the soil height and rock clearance we sampled.
    const normalization = new THREE.Matrix4().makeTranslation(height ? 0 : -center.x, -box.min.y, height ? 0 : -center.z);
    const dimension = height ? extent.y : Math.max(extent.x, extent.z);
    // Local batches let the renderer cull distant groves without thinning their crowns.
    const patches = new Map<string, BiomePlacement[]>();
    for(const placement of placements){
      const key=`${Math.floor(placement.x/48)}:${Math.floor(placement.z/48)}`;
      const patch=patches.get(key)??[];patch.push(placement);patches.set(key,patch);
    }
    const rotation = new THREE.Quaternion(), matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
    const groundNormal = new THREE.Vector3(), groundRotation = new THREE.Quaternion();
    template.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const material=child.material;
      const local = normalization.clone().multiply(child.matrixWorld);
      for(const patch of patches.values()) {
      const batch = new THREE.InstancedMesh(child.geometry, material, patch.length);
      for (const [index, p] of patch.entries()) {
        rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.angle);
        if (alignToGround) {
          // Grass roots span a bed. Sampling only its center leaves the
          // downhill roots floating when a horizontal bed meets a slope.
          groundNormal.set(
            (heightAt(p.x - 1, p.z) - heightAt(p.x + 1, p.z)) / 2,
            1,
            (heightAt(p.x, p.z - 1) - heightAt(p.x, p.z + 1)) / 2,
          ).normalize();
          groundRotation.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, groundNormal);
          rotation.premultiply(groundRotation);
        }
        scale.setScalar(p.size / dimension);
        scale.y *= verticalScale?.(p) ?? 1;
        position.set(p.x, heightAt(p.x, p.z) - p.burial, p.z);
        matrix.compose(position, rotation, scale).multiply(local);
        batch.setMatrixAt(index, matrix);
      }
      batch.castShadow = castShadow; batch.receiveShadow = true;
      batch.computeBoundingSphere(); parent.add(batch); batches.add(batch);
      }
    });
  }
  function variants(source: THREE.Object3D) {
    const meshes: THREE.Mesh[] = [];
    source.traverse(child => { if (child instanceof THREE.Mesh) meshes.push(child); });
    return meshes;
  }

  function releaseSources() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    for (const source of sources) source.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
    sources.length = 0;
  }

  const loader = new GLTFLoader();
  const ready = Promise.all(modelUrls.map(async url => {
    const { scene } = await loader.loadAsync(url.href);
    sources.push(scene);
    if (disposed) releaseSources();
    return scene;
  })).then(([rubble, pebbles, tree, shrub, grass, rooibos]) => {
    if (disposed) return;
    const sources = { rubble, pebbles, tree, shrub, grass, rooibos };
    variants(sources.pebbles).forEach((mesh,index,all)=>scatter(mesh,group,features.rubble.filter((p,i)=>p.size<=1.2&&i%all.length===index),{castShadow:false}));
    const rubbleVariants=variants(sources.rubble);
    rubbleVariants.forEach((mesh,index)=>scatter(mesh,group,features.rubble.filter((p,i)=>p.size>1.2&&(p.size>2?index===1:i%rubbleVariants.length===index))));
    scatter(sources.tree, vegetation, features.trees, {normalizeByHeight:true});
    const shrubs=[...variants(sources.rooibos),...variants(sources.shrub)];
    shrubs.forEach((mesh, index, all) => scatter(mesh, vegetation, features.shrubs.filter((_, i) => i % all.length === index), {normalizeByHeight:true,castShadow:false}));
    variants(sources.grass).forEach((mesh, index, all) => scatter(mesh, vegetation, features.grass.filter((_, i) => i % all.length === index), {
      normalizeByHeight:true, alignToGround:true,
      // Low grass should read as walkable cover. Keep the full root spread:
      // shrinking entire patches reopens gaps and separates them into tufts.
      verticalScale:p=>.6*(.45+.55*THREE.MathUtils.smoothstep(sampleMapField(layout,features.oasisMoisture,p.x,p.z),.10,.28)),
    }));
  }).catch(error => {
    dispose();
    throw error;
  });

  function dispose() {
    disposed = true;
    group.removeFromParent();
    batches.forEach(batch => batch.dispose());
    batches.clear();
    group.clear();
    releaseSources();
  }
  return { group, vegetation, ready, dispose };
}
