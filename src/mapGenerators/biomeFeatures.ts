import type { MapLayout, Point } from './types';
import type { TerrainBiomes } from './biomeRegions';
import { sampleMapField } from './sampling';
import { inspectRoutes } from './navigation';
import type { createBiomeTerrain } from './biomeTerrain';

export type BiomePlacement = Point & { size: number; angle: number; burial: number };
type Shoulder = Point & { distance: number; bearing: number };
type Grove = Point & { bearing: number; length: number; width: number; phase: number };

/** Exposed joints, deposited rubble and sheltered vegetation follow the shaped geology. */
export function createBiomeFeatures(layout: MapLayout, biomes: TerrainBiomes, terrain: Pick<ReturnType<typeof createBiomeTerrain>,'talus'>) {
  const {size,cells,heights}=layout,row=cells+1,step=size/cells;
  const sample=(field:Float32Array,x:number,z:number)=>sampleMapField(layout,field,x,z);
  const height=(x:number,z:number)=>sample(heights,x,z);
  const index=(x:number,z:number)=>Math.round((z+size/2)/step)*row+Math.round((x+size/2)/step);
  const blocked=(x:number,z:number)=>Boolean(layout.blocked[index(x,z)]);
  const inside=(x:number,z:number,margin=2)=>Math.abs(x)<size/2-margin&&Math.abs(z)<size/2-margin;
  const hash=(x:number,z:number)=>{
    let h=Math.imul(x,374761393)^Math.imul(z,668265263)^layout.seed;
    h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;
  };
  const smooth=(t:number)=>{const v=Math.max(0,Math.min(1,t));return v*v*(3-2*v);};
  const noise=(x:number,z:number)=>{
    const ix=Math.floor(x),iz=Math.floor(z),u=smooth(x-ix),v=smooth(z-iz);
    return (hash(ix,iz)*(1-u)+hash(ix+1,iz)*u)*(1-v)+(hash(ix,iz+1)*(1-u)+hash(ix+1,iz+1)*u)*v;
  };
  const nearSite=(x:number,z:number,radius:number)=>layout.sites.some(s=>Math.hypot(x-s.x,z-s.z)<radius);
  const flat=(x:number,z:number,radius:number,tolerance:number)=>
    [[radius,0],[-radius,0],[0,radius],[0,-radius]].every(([dx,dz])=>Math.abs(height(x+dx,z+dz)-height(x,z))<tolerance);
  const nearRamp=(x:number,z:number,radius:number)=>layout.ramps.some(r=>{
    const dx=r.b.x-r.a.x,dz=r.b.z-r.a.z;
    const t=Math.max(0,Math.min(1,((x-r.a.x)*dx+(z-r.a.z)*dz)/(dx*dx+dz*dz)));
    return Math.hypot(x-r.a.x-dx*t,z-r.a.z-dz*t)<r.width/2+radius;
  });
  const trees:BiomePlacement[]=[],shrubs:BiomePlacement[]=[],grass:BiomePlacement[]=[],rubble:BiomePlacement[]=[];
  const start=layout.sites.find(s=>s.role==='base')??layout.focus;
  const routes=inspectRoutes(heights,cells,size,start,layout.blocked,3);
  const bypass=layout.blocked.slice();
  for(let i=0;i<bypass.length;i++){
    const x=i%row*step-size/2,z=Math.floor(i/row)*step-size/2;
    if(Math.hypot(x-layout.focus.x,z-layout.focus.z)<layout.bypassRadius)bypass[i]=1;
  }
  const alternate=inspectRoutes(heights,cells,size,start,bypass,3);
  // Reserve actual primary and alternate routes before composing solid rock.
  // Site reachability alone does not prove that the center bypass survived.
  const routeCells=new Set(layout.sites.flatMap(site=>routes.pathTo(site)).map(p=>index(p.x,p.z)));
  for(const ramp of layout.ramps)for(const p of [ramp.a,ramp.b,{x:(ramp.a.x+ramp.b.x)/2,z:(ramp.a.z+ramp.b.z)/2}])
    for(const step of routes.pathTo(p))routeCells.add(index(step.x,step.z));
  for(const base of layout.sites.filter(s=>s.role==='base'))for(const p of alternate.pathTo(base))routeCells.add(index(p.x,p.z));
  const corridors=Array.from(routeCells,i=>({x:i%row*step-size/2,z:Math.floor(i/row)*step-size/2}));
  const shoulder=(x:number,z:number):Shoulder=>{
    const floor=height(x,z);
    for(const distance of [9,15,23,33,43])for(let ray=0;ray<16;ray++){
      const a=ray*Math.PI/8,px=x+Math.cos(a)*distance,pz=z+Math.sin(a)*distance;
      if(inside(px,pz)&&blocked(px,pz)&&height(px,pz)>floor+3)
        return {x,z,distance,bearing:a+Math.PI/2};
    }
    return {x,z,distance:54,bearing:Math.atan2(z-layout.focus.z,x-layout.focus.x)};
  };
  const floorCandidates:Shoulder[]=[];
  for(let gx=-size/2+15;gx<size/2-15;gx+=4)for(let gz=-size/2+15;gz<size/2-15;gz+=4){
    const x=gx+(hash(Math.round(gx),Math.round(gz)+89)-.5)*3;
    const z=gz+(hash(Math.round(gx)+173,Math.round(gz))-.5)*3;
    if(nearSite(x,z,16))continue;
    if(blocked(x,z)||height(x,z)>16||!flat(x,z,3,1.4))continue;
    if(sample(biomes.oasis,x,z)>.25)floorCandidates.push(shoulder(x,z));
  }
  const navigationBlocked=layout.blocked.slice();
  const groves:Grove[]=[];
  for(const region of biomes.regions.filter(r=>r.biome==='oasis')){
    const candidates=floorCandidates.filter(p=>layout.regionIds[index(p.x,p.z)]===region.id&&sample(biomes.oasis,p.x,p.z)>.5);
    candidates.sort((a,b)=>(a.distance+hash(Math.round(a.x),Math.round(a.z)+137)*14)-(b.distance+hash(Math.round(b.x),Math.round(b.z)+137)*14));
    let count=0;
    for(const p of candidates){
      if(nearSite(p.x,p.z,22)||nearRamp(p.x,p.z,3)||groves.some(g=>Math.hypot(p.x-g.x,p.z-g.z)<34))continue;
      groves.push({x:p.x,z:p.z,bearing:p.bearing+(hash(region.id,count+17)-.5)*.7,
        length:42+hash(region.id,count+59)*13,width:22+hash(region.id,count+83)*9,phase:hash(region.id,count+197)*Math.PI*2});
      if(++count===2)break;
    }
  }
  const oasisMoisture=new Float32Array(heights.length);
  for(let i=0;i<oasisMoisture.length;i++){
    if(layout.blocked[i]||heights[i]>16||biomes.oasis[i]===0)continue;
    const x=i%row*step-size/2,z=Math.floor(i/row)*step-size/2;
    let moisture=0;
    for(const grove of groves){
      const dx=x-grove.x,dz=z-grove.z,c=Math.cos(grove.bearing),s=Math.sin(grove.bearing);
      const along=dx*c+dz*s,across=-dx*s+dz*c;
      const bend=Math.sin(along*.075+grove.phase)*grove.width*.45;
      const pocket=Math.exp(-((along/grove.length*1.8)**2+(across/grove.width)**2));
      const strand=Math.exp(-(((across-bend)/(grove.width*.38))**2))*smooth(1-Math.abs(along)/grove.length);
      const gaps=.35+.65*noise(x*.07+83,z*.07+37);
      moisture=Math.max(moisture,Math.max(pocket,strand*.82)*gaps);
    }
    oasisMoisture[i]=moisture*biomes.oasis[i];
  }
  // Compose solid rubble before planting so every root can avoid its footprint.
  // Keep the seeded scatter and route exclusions unchanged for navigation.
  for(let i=0;i<22000;i++){
    const x=(hash(i,71)-.5)*(size-8),z=(hash(i,95)-.5)*(size-8),boundary=sample(layout.rockEdges,x,z);
    const talus=sample(terrain.talus,x,z);
    // Deposit into foothills and channels. Loose summit stones were visually
    // unrelated to the cliff and obscured the continuous parent-rock silhouette.
    if(height(x,z)>17||nearSite(x,z,15)||!flat(x,z,1,.9))continue;
    if((talus>.06||boundary> -7&&boundary<1)&&hash(i,812)<.55){
      const width=.3+hash(i,26)**4*(talus>.2?5.8:1.6);
      if(width>1.5&&(nearRamp(x,z,width+2)||corridors.some(p=>Math.hypot(x-p.x,z-p.z)<width+4.25)))continue;
      rubble.push({x,z,size:width,angle:i*2.4,burial:width*.12});
    }
  }
  const plantable=(x:number,z:number,radius:number)=>{
    if(!inside(x,z,radius+1))return false;
    for(const [dx,dz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[.71,.71],[-.71,.71],[.71,-.71],[-.71,-.71]]){
      const px=x+dx*radius,pz=z+dz*radius;
      if(blocked(px,pz)||sample(layout.rockEdges,px,pz)>=-.6)return false;
    }
    // Scanned rocks rotate about their bounds' center. Enclose both horizontal
    // extents, then leave room for the trunk or tussock base, not the canopy.
    return rubble.every(p=>{
      const dx=x-p.x,dz=z-p.z,clearance=p.size*Math.SQRT1_2+radius;
      return dx*dx+dz*dz>clearance*clearance;
    });
  };
  const wetArea=oasisMoisture.reduce((sum,w)=>sum+w*step*step,0);
  const treeTarget=Math.min(18+layout.playerCount*3,Math.max(groves.length*4,Math.round(wetArea/110)));
  for(let i=0;groves.length&&i<20000;i++){
    const grove=groves[i%groves.length],along=(hash(i,203)-.5)*grove.length*2,across=(hash(i,509)-.5)*grove.width*3.4;
    const x=grove.x+Math.cos(grove.bearing)*along-Math.sin(grove.bearing)*across;
    const z=grove.z+Math.sin(grove.bearing)*along+Math.cos(grove.bearing)*across;
    const moisture=sample(oasisMoisture,x,z);
    if(!inside(x,z)||moisture<.1||blocked(x,z)||nearSite(x,z,13)||!flat(x,z,1.5,.8))continue;
    const angle=hash(i,34)*Math.PI*2;
    if(moisture>.27&&trees.length<treeTarget&&!nearSite(x,z,20)&&!nearRamp(x,z,2)&&flat(x,z,3,1.1)
      &&trees.every(p=>Math.hypot(x-p.x,z-p.z)>10+hash(i,379)*4)&&plantable(x,z,.75)){
      trees.push({x,z,size:(trees.length%3===0?12:7.5)+hash(i,89)*3,angle,burial:.06});
    }
  }
  // Habitat moisture already describes curved washes and open alluvial floors.
  // Fill that continuous cover instead of attaching isolated bundles to trees.
  let cover:BiomePlacement[]=[];
  const spacing=2;
  for(let gz=0;gz*spacing<size-8;gz++)for(let gx=0;gx*spacing<size-8;gx++){
    const x=-size/2+4+gx*spacing+(hash(gx+311,gz+577)-.5)*1.2;
    const z=-size/2+4+gz*spacing+(hash(gx+733,gz+997)-.5)*1.2;
    const moisture=sample(oasisMoisture,x,z),edge=.10+.06*noise(x/12+179,z/12+263);
    if(moisture<edge||nearSite(x,z,14)||!flat(x,z,1,1))continue;
    const grassSize=1.5+hash(gx+421,gz+823)*.7;
    // The grass bed spreads its roots across the surface, unlike the old
    // single-root tussock. Reserve its full base and avoid uneven rock toes.
    const rootRadius=grassSize*.75;
    if(flat(x,z,rootRadius,.45)&&plantable(x,z,rootRadius))
      cover.push({x,z,size:grassSize,angle:hash(gx+613,gz+941)*Math.PI*2,burial:.08});
  }
  const hasGrass=(point:Point,plants:BiomePlacement[],radius:number,count:number)=>{
    let neighbors=0;
    for(const other of plants){
      const dx=other.x-point.x,dz=other.z-point.z;
      if(other!==point&&dx*dx+dz*dz<=radius*radius&&++neighbors>=count)return true;
    }
    return false;
  };
  // Obstructions can sever a bed's thin edge. Remove those isolated remnants
  // without thinning the connected interior with per-plant random rejection.
  while(cover.length){
    // At the driest fringe, a narrow chain can hold a round, planted-looking
    // cap. Require a fuller bed there without eroding the moist interior.
    const connected=cover.filter(plant=>hasGrass(plant,cover,4.5,2)
      &&(sample(oasisMoisture,plant.x,plant.z)>=.14||hasGrass(plant,cover,3.3,4)));
    if(connected.length===cover.length)break;
    cover=connected;
  }
  // A detached handful of plants can satisfy the neighbor rule itself. Keep
  // beds at the grass's physical spread, not tiny islands across empty sand.
  const remaining=new Set(cover),fragments=new Set<BiomePlacement>();
  for(const first of remaining){
    const bed=[first];remaining.delete(first);
    for(let i=0;i<bed.length;i++)for(const candidate of remaining){
      const dx=candidate.x-bed[i].x,dz=candidate.z-bed[i].z;
      if(dx*dx+dz*dz<=3.3*3.3){bed.push(candidate);remaining.delete(candidate);}
    }
    if(bed.length<8)for(const plant of bed)fragments.add(plant);
  }
  grass.push(...cover.filter(plant=>!fragments.has(plant)));
  for(const [i,plant] of grass.entries()){
    if(hash(i,1279)>.055||!plantable(plant.x,plant.z,.4)
      ||shrubs.some(other=>Math.hypot(other.x-plant.x,other.z-plant.z)<5)
      ||!hasGrass(plant,grass,3,3))continue;
    shrubs.push({x:plant.x,z:plant.z,size:1.4+hash(i,1423)*.8,angle:hash(i,1693)*Math.PI*2,burial:.06});
  }
  for(const p of rubble)if(p.size>1.5){
    const radius=p.size*.56;
    for(let gz=Math.max(0,Math.floor((p.z-radius+size/2)/step));gz<=Math.min(cells,Math.ceil((p.z+radius+size/2)/step));gz++)
      for(let gx=Math.max(0,Math.floor((p.x-radius+size/2)/step));gx<=Math.min(cells,Math.ceil((p.x+radius+size/2)/step));gx++)
        if(Math.hypot(gx*step-size/2-p.x,gz*step-size/2-p.z)<radius)navigationBlocked[gz*row+gx]=1;
  }
  return {trees,shrubs,grass,rubble,oasisMoisture,blocked:navigationBlocked};
}
