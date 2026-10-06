import { createRockClusters, createOutcropSurface } from './rockClusters';
import type { Point, TerrainRegion } from './types';
import { inspectRoutes } from './navigation';
import type { Site } from './types';

type Region = Omit<TerrainRegion, 'neighbors'>;
type Connection = { a: number; b: number; crossing: Point };
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const t = clamp(x); return t * t * (3 - 2 * t); };
const distance = (a: Point,b: Point) => Math.hypot(a.x-b.x,a.z-b.z);
const levelHeight = 7;

function clip(polygon: Point[], a: Point, b: Point) {
  const value = (p: Point) => (p.x-a.x)**2+(p.z-a.z)**2-(p.x-b.x)**2-(p.z-b.z)**2;
  const result: Point[]=[];
  for(let i=0;i<polygon.length;i++) {
    const p=polygon[i],q=polygon[(i+1)%polygon.length],pv=value(p),qv=value(q);
    if(pv<=0)result.push(p);
    if((pv<0)!==(qv<0)) {
      const t=pv/(pv-qv); result.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t});
    }
  }
  return result;
}

/** Regenerates the region graph, sites, height assignments and entrances from the seed. */
function generateRegions(seed: number, playerCount: number, mountainProfile: 'reference' | 'ridges') {
  let state=seed>>>0;
  const random=()=>{state+=0x6D2B79F5;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  const hash=(x:number,z:number)=>{let h=Math.imul(x,374761393)^Math.imul(z,668265263)^seed;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;};
  const noise=(x:number,z:number)=>{
    const ix=Math.floor(x),iz=Math.floor(z),u=smooth(x-ix),v=smooth(z-iz);
    return (hash(ix,iz)*(1-u)+hash(ix+1,iz)*u)*(1-v)+(hash(ix,iz+1)*(1-u)+hash(ix+1,iz+1)*u)*v;
  };
  const size=220*Math.sqrt(playerCount/2),halfSize=size/2;
  const regions: Region[]=[];
  const add=(x:number,z:number)=>regions.push({id:regions.length,x,z,level:0,mountain:false,polygon:[]});
  const angle=random()*Math.PI*2;
  if(playerCount===2){
  const radius=69+random()*16;
  add(Math.cos(angle)*radius,Math.sin(angle)*radius);
  const opposite=angle+Math.PI+(random()-.5)*.55;
  const otherRadius=69+random()*16;
  add(Math.cos(opposite)*otherRadius,Math.sin(opposite)*otherRadius);
  }else{
    for(let player=0;player<playerCount;player++){
      const bearing=angle+player*Math.PI*2/playerCount+(random()-.5)*.12;
      const radius=size*(.35+random()*.025);
      add(Math.cos(bearing)*radius,Math.sin(bearing)*radius);
    }
  }
  const target=Math.round((16+Math.floor(random()*7))*playerCount/2);
  for(let attempt=0;regions.length<target && attempt<6000;attempt++) {
    const p={x:(random()-.5)*(size-42),z:(random()-.5)*(size-42)};
    if(regions.every(r=>distance(r,p)>(playerCount===2?(r.id<playerCount?47:36):(r.id<playerCount?60:47))))add(p.x,p.z);
  }
  for(const region of regions) {
    let polygon=[{x:-halfSize,z:-halfSize},{x:halfSize,z:-halfSize},{x:halfSize,z:halfSize},{x:-halfSize,z:halfSize}];
    for(const other of regions)if(other!==region)polygon=clip(polygon,region,other);
    region.polygon=polygon;
  }
  const connections:Connection[]=[];
  for(const region of regions)for(let i=0;i<region.polygon.length;i++) {
    const p=region.polygon[i],q=region.polygon[(i+1)%region.polygon.length];
    if(distance(p,q)<22)continue;
    const middle={x:(p.x+q.x)/2,z:(p.z+q.z)/2};
    const neighbor=regions.filter(r=>r!==region).reduce((a,b)=>distance(a,middle)<distance(b,middle)?a:b);
    if(region.id<neighbor.id && Math.abs(distance(region,middle)-distance(neighbor,middle))<.01)connections.push({a:region.id,b:neighbor.id,crossing:middle});
  }
  const connected=(edges:Connection[],omitted=-1)=>{
    const active=regions.filter(r=>!r.mountain && r.id!==omitted);
    const first=active[0];if(!first)return false;
    const visited=new Set([first.id]);
    for(const id of visited)for(const edge of edges) {
      if(edge.a===omitted||edge.b===omitted||regions[edge.a].mountain||regions[edge.b].mountain)continue;
      if(edge.a===id)visited.add(edge.b);if(edge.b===id)visited.add(edge.a);
    }
    return active.every(r=>visited.has(r.id));
  };
  const resilient=(edges:Connection[])=>connected(edges)&&regions.filter(r=>!r.mountain).every(r=>connected(edges,r.id));
  const naturalIds:number[]=[];
  for(let base=0;base<playerCount;base++){
    const adjacent=connections.filter(e=>e.a===base||e.b===base).map(e=>e.a===base?e.b:e.a);
    const candidates=(playerCount===2?adjacent:regions.map(r=>r.id)).filter(id=>id>=playerCount&&(playerCount===2||!naturalIds.includes(id)));
    candidates.sort((a,b)=>{
      if(playerCount>2&&adjacent.includes(a)!==adjacent.includes(b))return adjacent.includes(a)?-1:1;
      return distance(regions[a],regions[base])-distance(regions[b],regions[base]);
    });
    naturalIds.push(candidates[0]);
  }
  const mountainTarget=Math.round((2+Math.floor(random()*4))*playerCount/2);
  const candidates=regions.filter(r=>r.id>=playerCount&&!naturalIds.includes(r.id));
  // Shuffle once; random sorting comparators would destroy deterministic ordering.
  for(let i=candidates.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
  let mountains=0;
  for(const candidate of candidates) {
    if(mountains>=mountainTarget)break;
    candidate.mountain=true;
    if(resilient(connections))mountains++;else candidate.mountain=false;
  }
  for(const region of regions)region.level=noise(region.x*.017+13,region.z*.017+29)>.48?1:0;
  const baseLevel=Math.floor(random()*3);
  for(const base of regions.slice(0,playerCount))base.level=baseLevel;
  for(const r of regions)if(r.id>=playerCount&&!r.mountain&&random()<.22)r.level=2;
  // Neighboring floors differ by at most one step, so short borders never demand steep ramps.
  for(const edge of connections) {
    const a=regions[edge.a],b=regions[edge.b];
    if(Math.abs(a.level-b.level)>1){if(a.id<playerCount)b.level=1;else if(b.id<playerCount)a.level=1;else if(a.level===0)a.level=1;else b.level=1;}
  }
  let selected=connections.filter(e=>!regions[e.a].mountain&&!regions[e.b].mountain);
  for(const edge of [...selected]) {
    if(regions[edge.a].level===regions[edge.b].level||random()<.48)continue;
    const reduced=selected.filter(e=>e!==edge);
    if(resilient(reduced))selected=reduced;
  }
  const ramps=selected.filter(e=>regions[e.a].level!==regions[e.b].level).map(edge=>{
    const from=regions[edge.a],to=regions[edge.b],middle=edge.crossing;
    const length=distance(from,to),dx=(to.x-from.x)/length,dz=(to.z-from.z)/length;
    const half=15+hash(edge.a+71,edge.b)*4;
    const a={x:middle.x-dx*half,z:middle.z-dz*half};
    const b={x:middle.x+dx*half,z:middle.z+dz*half};
    const bend=(hash(edge.a+93,edge.b)-.5)*5;
    const pointAt=(t:number)=>({x:a.x+(b.x-a.x)*t-dz*bend*Math.sin(Math.PI*t),z:a.z+(b.z-a.z)*t+dx*bend*Math.sin(Math.PI*t)});
    return {a,b,middle,dx,dz,bend,pointAt,length:half*2,
      low:from.level*levelHeight,high:to.level*levelHeight,width:(playerCount===2?10:15)+hash(edge.a+117,edge.b)*5,height:levelHeight};
  });
  const sites:Site[]=regions.slice(0,playerCount).map((r,i)=>({x:r.x,z:r.z,label:`Base ${String.fromCharCode(65+i)}`,role:'base',player:i+1}));
  const siteIds=new Set(Array.from({length:playerCount},(_,i)=>i));
  for(const [index,id] of naturalIds.entries()) {
    if(siteIds.has(id))continue;siteIds.add(id);
    sites.push({x:regions[id].x,z:regions[id].z,label:`Natural ${String.fromCharCode(65+index)}`,role:'expansion',player:index+1});
  }
  const central=regions.filter(r=>!r.mountain&&!siteIds.has(r.id)).sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z));
  const focal=central[0];siteIds.add(focal.id);
  sites.push({x:focal.x,z:focal.z,label:'Contested ground',role:'contest',player:0});
  for(const r of central.slice(1,2+playerCount+Math.floor(random()*3))) {
    siteIds.add(r.id);sites.push({x:r.x,z:r.z,label:`Supply ${playerCount===2?sites.length-4:sites.length-playerCount*2}`,role:'expansion',player:0});
  }
  const mountainData=regions.filter(r=>r.mountain).map(r=>{
    let inset=Infinity;
    for(let i=0;i<r.polygon.length;i++){
      const a=r.polygon[i],b=r.polygon[(i+1)%r.polygon.length],dx=b.x-a.x,dz=b.z-a.z;
      const t=clamp(((r.x-a.x)*dx+(r.z-a.z)*dz)/(dx*dx+dz*dz));
      inset=Math.min(inset,Math.hypot(r.x-a.x-t*dx,r.z-a.z-t*dz));
    }
    return {region:r,inset,height:17+random()*13};
  });
  // Region centers are fixed: retain the original arithmetic, but calculate its denominator once.
  const depthNeighbors=regions.map(r=>regions.filter(other=>other!==r&&!other.mountain)
    .map(other=>({other,denominator:2*distance(r,other)})));
  const depth=(p:Point,r:Region)=>{
    let d=Infinity;
    // Adjacent mountain territories form one massif; no artificial paths divide them.
    for(const {other,denominator} of depthNeighbors[r.id])d=Math.min(d,((p.x-other.x)**2+(p.z-other.z)**2-(p.x-r.x)**2-(p.z-r.z)**2)/denominator);
    return Math.min(d,halfSize-Math.abs(p.x),halfSize-Math.abs(p.z));
  };
  // Broad contour displacement bends the territory edges without roughening their floors.
  const contour=(x:number,z:number)=>({
    x:x+(noise(x*.026+19,z*.026)-.5)*25+(noise(x*.065+41,z*.065)-.5)*8,
    z:z+(noise(x*.026,z*.026+23)-.5)*25+(noise(x*.065,z*.065+47)-.5)*8,
  });
  const mountainDepth=(p:Point,r:Region)=>depth(p,r)-(noise(p.x*.06+8,p.z*.06+7)-.5)*3;
  const terraces=(x:number,z:number,w:Point)=>{
    const distances=regions.map(r=>distance(w,r));
    const apron=3.5+noise(x*.08+61,z*.08+71)*4;
    const crest=3+noise(x*.07+37,z*.07+13)*2;
    let height=0;
    for(let level=1;level<=2;level++){
      let high=Infinity,low=Infinity;
      for(let i=0;i<regions.length;i++){
        if(regions[i].level>=level)high=Math.min(high,distances[i]);
        else low=Math.min(low,distances[i]);
      }
      if(!Number.isFinite(high))continue;
      if(!Number.isFinite(low)){height+=levelHeight;continue;}
      const d=(low-high)/2;
      // Broad shoulders keep erosion readable without a serrated lip.
      const ribs=(noise(x*.09+83,z*.09+17)-.5)*.9;
      const face=smooth((d+ribs+1.3)/3.2);
      const foot=smooth((d+apron)/apron);
      const lip=smooth((d-1)/crest);
      height+=levelHeight*(.24*foot+.64*face+.12*lip);
    }
    return height;
  };
  // Linear triangular interpolation gives fractured planes rather than rolling waves.
  const fracture=(x:number,z:number)=>{
    const ix=Math.floor(x),iz=Math.floor(z),u=x-ix,v=z-iz;
    return u+v<1
      ?hash(ix,iz)*(1-u-v)+hash(ix+1,iz)*u+hash(ix,iz+1)*v
      :hash(ix+1,iz+1)*(u+v-1)+hash(ix,iz+1)*(1-u)+hash(ix+1,iz)*(1-v);
  };
  // Summits belong to landforms, not a repeating noise grid. Each territory has
  // one dominant asymmetric ridge; joined territories naturally form a saddle.
  const summits=mountainData.map(({region,inset})=>{
    const farthest=region.polygon.reduce((a,b)=>distance(a,region)>distance(b,region)?a:b);
    const angle=Math.atan2(farthest.z-region.z,farthest.x-region.x);
    return {x:region.x,z:region.z,c:Math.cos(angle),s:Math.sin(angle),
      length:Math.max(20,inset*1.6),width:Math.max(14,inset),height:14+hash(region.id,941)*2};
  });
  const crown=(w:Point)=>{
    let relief=0;
    for(const peak of summits){
      const dx=w.x-peak.x,dz=w.z-peak.z;
      const along=(dx*peak.c+dz*peak.s)/peak.length;
      const across=(-dx*peak.s+dz*peak.c)/peak.width;
      const flank=Math.abs(across)*(across>0?1.25:.85);
      const shape=clamp(1-Math.sqrt(along*along+flank*flank+.006));
      relief=Math.max(relief,peak.height*shape);
    }
    const bedrock=19+relief+.8*fracture(w.x*.10+47,w.z*.10+97);
    // Low wind drifts give the fill volume; sparse buried fragments break its surface.
    const sand=20+3*smooth((noise(w.x*.024+83,w.z*.024+61)-.3)/.4)
      +.38*(noise(w.x*.18+37,w.z*.18+53)-.5);
    const fragment=smooth((fracture(w.x*.48+71,w.z*.48+29)-.72)/.20);
    const shore=1-smooth(Math.abs(bedrock-sand)/2.5);
    const rock=Math.max(bedrock,bedrock+(sand+.32-bedrock)*fragment*shore);
    return {rock,sand};
  };
  const sample=(x:number,z:number)=>{
    const w=contour(x,z);
    let height=terraces(x,z,w);
    // A bounded, varying roof keeps wide massifs low without slicing their tops.
    // Face width is independent of massif width: blocked mountains must not read as gentle hills.
    const top=mountainProfile==='reference'?{rock:0,sand:0}:crown(w);
    const summit=top.rock;
    let interior=-Infinity;
    for(const mountain of mountainData){
      const d=mountainDepth(w,mountain.region);
      interior=Math.max(interior,d);

      if(mountainProfile==='reference'&&d>-3){
        const rise=smooth((d+3)/Math.max(10,mountain.inset+3));
        const roof=mountain.region.level*levelHeight+mountain.height;
        height=Math.max(height,height+(roof-height)*rise);
      }
    }
    if(mountainProfile!=='reference'&&interior>-3){
      // Shape the union once; overlapping territories must not multiply the rise.
      // Keep summit fractures inland so they cannot turn a cliff edge into thin fins.
      const rise=.12*smooth((interior+3)/5)+.78*smooth((interior-.7)/6)+.10*smooth((interior-6)/6);
      const roof=22+(summit-22)*smooth((interior-2)/6);
      height=Math.max(height,height+(roof-height)*rise);
      height+=Math.max(0,top.sand-height)*smooth((interior-8)/6);
    }
    for(const ramp of ramps){
      const along=clamp(((x-ramp.a.x)*ramp.dx+(z-ramp.a.z)*ramp.dz)/ramp.length);
      const center=ramp.pointAt(along);
      const lateral=Math.hypot(x-center.x,z-center.z);
      // Entrances fan out into the terraces; a generous center stays clear for armies.
      const mouth=1+1.1*Math.pow(2*along-1,2);
      const width=ramp.width*mouth+(noise(x*.09+31,z*.09)-.5)*2;
      const influence=1-smooth((lateral-width/2)/3.5);
      const t=smooth(along);
      height=height*(1-influence)+(ramp.low+(ramp.high-ramp.low)*t)*influence;
    }
    return height+.06*noise(x*.025,z*.025);
  };
  const mountainBoundary=(x:number,z:number)=>{
    const w=contour(x,z);
    let boundary=-Infinity;
    for(const mountain of mountainData)boundary=Math.max(boundary,mountainDepth(w,mountain.region)+2);
    return boundary;
  };
  const mountainBlocked=(x:number,z:number)=>mountainBoundary(x,z)>0;
  const rocks=createRockClusters({sample,blocked:mountainBlocked,sites,ramps,hash,size});
  const outcrops=createOutcropSurface(rocks);
  const rockBoundary=(x:number,z:number)=>{
    let boundary=mountainBoundary(x,z);
    // Material follows deposited sediment, independently of the obstacle mask.
    if(mountainProfile!=='reference'&&boundary>8){
      const top=crown(contour(x,z));
      boundary=Math.min(boundary,Math.max((16-boundary)*2,(top.rock-top.sand)*3));
    }
    return Math.max(boundary,outcrops(x,z).boundary);
  };
  const blocked=(x:number,z:number)=>mountainBlocked(x,z)||outcrops(x,z).blocked;
  const terrainSample=(x:number,z:number)=>sample(x,z)+outcrops(x,z).height;
  const regionAt=(x:number,z:number)=>{
    const p=contour(x,z);
    let id=-1,nearest=Infinity;
    for(const region of regions){
      const squared=(p.x-region.x)**2+(p.z-region.z)**2;
      if(squared<nearest){nearest=squared;id=region.id;}
    }
    return id;
  };
  const territories=regions.map(region=>({...region,neighbors:connections
    .filter(edge=>edge.a===region.id||edge.b===region.id)
    .map(edge=>edge.a===region.id?edge.b:edge.a)}));
  const signature=regions.map(r=>`${r.id}:${r.level}:${Number(r.mountain)}`).join('|')+';'+selected.map(e=>`${e.a}-${e.b}`).join(',');
  return {sample:terrainSample,blocked,rockBoundary,rocks,hash,noise,sites,starts:sites.slice(0,playerCount),points:sites.map(({x,z})=>({x,z})),
    clearings:sites.map(({x,z})=>({x,z,radius:12})),ascents:ramps,channels:[],mode:'procedural' as const,seed,size,playerCount,
    focus:{x:focal.x,z:focal.z},bypassRadius:9,
    regions:territories,regionAt,connections:selected,signature,
    layout:`${regions.length} regions · ${mountains} massifs · ${ramps.length} ramps · base level ${regions[0].level}`};
}

// Reject a candidate if its rendered entrances fail the same clearance test used by the demo.
export function createProceduralRegions(seed: number, playerCount = 2, mountainProfile: 'reference' | 'ridges' = playerCount===2?'reference':'ridges') {
  if(![2,4,6].includes(playerCount))throw new RangeError("Shifting Frontiers supports 2, 4 or 6 players");
  for(let attempt=0;attempt<24;attempt++) {
    const candidate=generateRegions(seed+attempt*104729,playerCount,mountainProfile);
    if(candidate.starts.some(base=>{
      const samples=[-7,0,7].flatMap(dx=>[-7,0,7].map(dz=>candidate.sample(base.x+dx,base.z+dz)));
      return Math.max(...samples)-Math.min(...samples)>.2;
    }))continue;
    const size=candidate.size,cells=Math.round(240*Math.sqrt(playerCount/2)),row=cells+1,step=size/cells;
    const heights=Float32Array.from({length:row*row},(_,i)=>candidate.sample(i%row*step-size/2,Math.floor(i/row)*step-size/2));
    const blocked=Uint8Array.from(heights,(_,i)=>Number(candidate.blocked(i%row*step-size/2,Math.floor(i/row)*step-size/2)));
    const nav=inspectRoutes(heights,cells,size,candidate.starts[0],blocked,3);
    if(candidate.regions.some(r=>!r.mountain&&!nav.pathTo(r).length))continue;
    const entrances=candidate.ascents.flatMap(r=>Array.from({length:21},(_,i)=>r.pointAt(i/20)));
    if(entrances.some(p=>!nav.pathTo(p).length))continue;
    const bypass=blocked.slice();
    for(let i=0;i<blocked.length;i++)if(Math.hypot(i%row*step-size/2-candidate.focus.x,Math.floor(i/row)*step-size/2-candidate.focus.z)<candidate.bypassRadius)bypass[i]=1;
    const alternate=inspectRoutes(heights,cells,size,candidate.starts[0],bypass,3);
    if(candidate.starts.some(base=>!alternate.pathTo(base).length))continue;
    return {...candidate,seed,fields:{heights,blocked,cells}};
  }
  throw new Error(`Could not generate a traversable map for seed ${seed}`);
}
