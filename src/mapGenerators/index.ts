import {createWeatheredHighlands} from './weatheredHighlands';
import {createStrongholds,createCrossroads} from './terrainStudies';
import {createProceduralRegions} from './proceduralRegions';
import {createRockClusters,createOutcropSurface} from './rockClusters';
import type {MapLayout,MapRequest,MapGeneratorId,PlayerCount,Site} from './types';
export type {MapLayout,MapRequest,MapGeneratorId,PlayerCount,Site,Point,TerrainRegion} from './types';
export {createTerrainBiomes} from './biomeRegions';
export type {TerrainBiomes,TerrainBiome} from './biomeRegions';

export const MAP_GENERATORS = [
  {id:'mesas',name:'Frontier strongholds',players:[2],description:'Elevated mains overlook a natural expansion. A central attack route and outer expansion loops offer different approaches to the enemy.'},
  {id:'ridges',name:'Weathered highlands',players:[2],description:'Branching valleys run between irregular mountain spines. Broad slopes and exposed faces grow from one continuous landscape.'},
  {id:'canyons',name:'Crossroads plateau',players:[2],description:'Lowland bases face a contested central plateau. Take its ramps, expand onto the outer heights, or use the low flanks to bypass the center.'},
  {id:'multiplayer',name:'Shifting frontiers',players:[2,4,6],description:'Free-for-all territories for two, four or six players. Each start has a nearby expansion; shared high ground and alternate approaches connect the battlefield.'},
] as const satisfies readonly {id:MapGeneratorId;name:string;description:string;players:readonly PlayerCount[]}[];

const sources={mesas:createStrongholds,ridges:createWeatheredHighlands,canyons:createCrossroads,
  procedural:(seed:number)=>createProceduralRegions(seed,2),multiplayer:(seed:number,players:number)=>createProceduralRegions(seed,players,'ridges')};

/** Pure seeded generation. No rendering, browser state, or simulation objects. */
export function generateMapLayout({generator,seed,players}:MapRequest):MapLayout {
  if(!Number.isSafeInteger(seed))throw new RangeError('Seed must be an integer');
  if(generator!=='multiplayer'&&players!==2)throw new RangeError('This map family currently supports two players');
  const source=sources[generator](seed,players);
  const size='size' in source?source.size:220,cells=Math.round(size*240/220),row=cells+1,step=size/cells;
  const sites:Site[]='sites' in source?source.sites:source.clearings.map((p,i)=>({...p,
    label:i<2?`Base ${String.fromCharCode(65+i)}`:`Supply ${i-1}`,role:i<2?'base':'expansion',player:i<2?i+1:0}));
  // Legacy highland clearings are interleaved; identify starts by position rather than array order.
  if(!('sites' in source))for(const site of sites){
    const player=source.starts.findIndex(p=>Math.hypot(p.x-site.x,p.z-site.z)<.01);
    site.player=player+1;site.role=player>=0?'base':'expansion';
    if(player>=0)site.label=`Base ${String.fromCharCode(65+player)}`;
  }
  const originalBlocked='blocked' in source?source.blocked:(x:number,z:number)=>source.sample(x,z)>18;
  const ramps=source.ascents.map(r=>({...r,pointAt:'pointAt' in r?r.pointAt:(t:number)=>({x:r.a.x+(r.b.x-r.a.x)*t,z:r.a.z+(r.b.z-r.a.z)*t})}));
  const outcrops='rocks' in source?undefined:createOutcropSurface(createRockClusters({sample:source.sample,
    blocked:originalBlocked,sites,ramps,hash:source.hash,size}));
  // Procedural acceptance already sampled these exact fields; preserve them for the renderer.
  const fields='fields' in source?source.fields:undefined;
  const heights=fields?.heights??new Float32Array(row*row),blocked=fields?.blocked??new Uint8Array(row*row),rockEdges=new Float32Array(row*row);
  const regions='regions' in source?source.regions:[];
  const regionIds=new Int16Array(row*row).fill(-1);
  for(let i=0;i<heights.length;i++){
    const x=i%row*step-size/2,z=Math.floor(i/row)*step-size/2,detail=outcrops?.(x,z);
    if(!fields){
      heights[i]=source.sample(x,z)+(detail?.height??0);
      blocked[i]=Number(originalBlocked(x,z)||detail?.blocked);
    }
    const edge='rockBoundary' in source?source.rockBoundary(x,z):Math.max(originalBlocked(x,z)?1:-2,detail?.boundary??-2);
    rockEdges[i]=Number.isFinite(edge)?edge:-100;
    if('regionAt' in source)regionIds[i]=source.regionAt(x,z);
  }
  return {generator,seed,playerCount:players,size,cells,heights,blocked,rockEdges,regions,regionIds,sites,
    ramps:source.ascents.map(({a,b,width,height})=>({a,b,width,height})),focus:'focus' in source?source.focus:{x:0,z:0},
    bypassRadius:'bypassRadius' in source?source.bypassRadius:generator==='mesas'?28:49,
    description:'layout' in source?source.layout:`${sites.length} sites · ${source.ascents.length} entrances`};
}
