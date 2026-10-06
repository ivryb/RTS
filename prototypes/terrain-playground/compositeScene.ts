import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { demoAssets, loadDemoAsset } from '../../src/modelAssets';
import { UNIT_DEFINITIONS, type UnitKind } from '../../src/sim/unitDefinitions';
import { createDemoLayout } from './demoLayout';
import type { Point } from '../../src/mapGenerators';
import { createTerrainEnvironment } from '../../src/mapGenerators/environment';
import { createEnvironmentProps } from '../../src/environmentProps';

type Landscape = ReturnType<typeof createDemoLayout>;
let assets: ReturnType<typeof loadAssets> | undefined;
async function loadAssets() {
  const models = await Promise.all(demoAssets.map(async asset => ({asset,...await loadDemoAsset(asset)})));
  const buildings=['Command Center','Turret','Scout Drone'].map(name=>{
    const model=models.find(({asset})=>asset.name===name);
    if(!model)throw new Error(`Missing scene reference: ${name}`);
    return model.instance;
  });
  return { buildings, models };
}

/** The new terrain study: weathered mountains, dry washes and sheltered groves. */
export function createCompositeScene(base: Landscape) {
  const environment = createTerrainEnvironment(base);
  const props = createEnvironmentProps(environment);
  const { group, vegetation } = props;
  const reference = new THREE.Group();
  group.add(reference);
  const layout = createDemoLayout(environment.layout);
  const { features, ground } = environment;
  let disposed = false;
  const center=(points: {x:number;z:number}[],fallback=layout.focus)=>points.length
    ? {x:points.reduce((n,p)=>n+p.x,0)/points.length,z:points.reduce((n,p)=>n+p.z,0)/points.length}
    : fallback;
  // Disconnected groves can average to bare sand. Focus one actual grove.
  const anchor=features.trees[0];
  const oasisCenter=center(anchor?features.trees.filter(tree=>Math.hypot(tree.x-anchor.x,tree.z-anchor.z)<35):[],
    layout.focus);
  const focal=layout.focus;
  const landscapeCenter={x:focal.x*.35+oasisCenter.x*.65,z:focal.z*.35+oasisCenter.z*.65};
  const formation=[
    {kind:'behemoth',x:-2.2,z:-2.2},{kind:'ghostrunner',x:-2.2,z:2.2},
    {kind:'hornet',x:2.2,z:-2.2},{kind:'scout-drone',x:2.2,z:2.2},
  ] satisfies (Point&{kind:UnitKind})[];
  const clearance=Math.max(...formation.map(({kind})=>UNIT_DEFINITIONS[kind].radius))+.75;
  // Stage the scale reference on existing grass, leaving the authored habitat
  // intact. A clear patch keeps tree crowns and loose rock off the units.
  const unitCandidates=features.grass.filter(p=>
    features.trees.every(tree=>Math.hypot(p.x-tree.x,p.z-tree.z)>tree.size*.7+clearance)
    &&features.rubble.every(rock=>Math.hypot(p.x-rock.x,p.z-rock.z)>rock.size*Math.SQRT1_2+clearance)
    &&[[-1,0],[1,0],[0,-1],[0,1],[-.71,-.71],[-.71,.71],[.71,-.71],[.71,.71]].every(([dx,dz])=>{
      const x=p.x+dx*clearance,z=p.z+dz*clearance;
      const index=Math.round((z/layout.size+.5)*layout.cells)*(layout.cells+1)+Math.round((x/layout.size+.5)*layout.cells);
      return !features.blocked[index]&&Math.abs(layout.sample(x,z)-layout.sample(p.x,p.z))<.3;
    }));
  const unitAnchors=unitCandidates.map(point=>({point,
    neighbors:unitCandidates.filter(p=>Math.hypot(p.x-point.x,p.z-point.z)<7).length,
  })).sort((a,b)=>b.neighbors-a.neighbors);
  let unitSites:(Point&{kind:UnitKind})[]=[];
  for(const {point:anchor} of unitAnchors){
    const sites:typeof unitSites=[];
    for(const offset of formation){
      const point=unitCandidates.filter(p=>Math.hypot(p.x-anchor.x,p.z-anchor.z)<7
        &&sites.every(other=>Math.hypot(p.x-other.x,p.z-other.z)
          >UNIT_DEFINITIONS[offset.kind].radius+UNIT_DEFINITIONS[other.kind].radius+.9))
        .sort((a,b)=>Math.hypot(a.x-anchor.x-offset.x,a.z-anchor.z-offset.z)
          -Math.hypot(b.x-anchor.x-offset.x,b.z-anchor.z-offset.z))[0];
      if(point)sites.push({kind:offset.kind,x:point.x,z:point.z});
    }
    if(sites.length===formation.length){unitSites=sites;break;}
  }
  const view=(name:string,p:{x:number;z:number})=>({name,position:new THREE.Vector3(p.x,layout.sample(p.x,p.z),p.z)});
  const views={landscape:view('Desert landscape',landscapeCenter),grove:view('Oasis',oasisCenter),
    units:view('Units in grass',center(unitSites,oasisCenter))};
  views.units.position.y+=1;

  document.body.dataset.environmentAssets = 'loading';
  delete document.body.dataset.environmentCounts;
  const ready = Promise.all([assets ??= loadAssets(), props.ready]).then(([sources]) => {
    if (disposed) return;
    for (const base of layout.starts) {
      sources.buildings.forEach((source, index) => {
        const object = source.clone(true), x = base.x + (index === 1 ? -13 : index === 2 ? 8 : 0), z = base.z + (index ? 8 : 0);
        object.position.set(x, layout.sample(x, z), z); object.rotation.y = .6;
        reference.add(object);
      });
    }
    const scoutingSite=layout.sites.filter(s=>s.role!=='base').sort((a,b)=>Math.hypot(a.x-focal.x,a.z-focal.z)-Math.hypot(b.x-focal.x,b.z-focal.z))[0]??layout.focus;
    sources.buildings.slice(1).forEach((source,i)=>{
      const object=source.clone(true),x=scoutingSite.x+i*6-5,z=scoutingSite.z+5;
      object.position.set(x,layout.sample(x,z),z);object.rotation.y=-.5;reference.add(object);
    });
    const grassUnits=unitSites.map(({kind,x,z})=>{
      const source=sources.models.find(({asset})=>asset.unitKind===kind);
      if(!source)throw new Error(`Missing grass reference unit: ${kind}`);
      const object=cloneSkeleton(source.instance);
      object.name=`${source.asset.name} in grass`;
      object.position.set(x,layout.sample(x,z),z);
      object.rotation.y=Math.PI/4;
      const presentation=source.asset.presentation;
      if(presentation?.terrainAlignment){
        const distance=Math.max(layout.size/layout.cells/2,presentation.selectionRing.radius);
        const normal=new THREE.Vector3(layout.sample(x-distance,z)-layout.sample(x+distance,z),distance*2,
          layout.sample(x,z-distance)-layout.sample(x,z+distance)).normalize()
          .lerp(THREE.Object3D.DEFAULT_UP,1-presentation.terrainAlignment).normalize();
        object.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(THREE.Object3D.DEFAULT_UP,normal));
      }
      const idle=source.animations.find(clip=>/idle/i.test(clip.name))??source.animations[0];
      if(idle){
        const pose=new THREE.AnimationMixer(object);pose.clipAction(idle).play();pose.update(.35);
      }
      reference.add(object);
      return {name:source.asset.name,kind,x,y:object.position.y,z};
    });
    reference.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
    document.body.dataset.environmentAssets = 'ready';
    document.body.dataset.environmentCounts=JSON.stringify(Object.fromEntries(Object.entries(features).filter(([,value])=>Array.isArray(value)).map(([key,value])=>[key,value.length])));
    document.body.dataset.grassUnits=JSON.stringify(grassUnits);

  });
  return { layout, group, vegetation, reference, views, ready, blocked:layout.blocked,ground,
    dispose() { disposed = true; props.dispose(); },
  };
}
