import {sampleMapField} from '../../src/mapGenerators/sampling';
import type {MapLayout} from '../../src/mapGenerators';

export function createDemoLayout(data:MapLayout){
  const {seed}=data;
  const hash=(x:number,z:number)=>{let h=Math.imul(x,374761393)^Math.imul(z,668265263)^seed;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;};
  return {...data,sample:(x:number,z:number)=>sampleMapField(data,data.heights,x,z),
    rockBoundary:(x:number,z:number)=>sampleMapField(data,data.rockEdges,x,z),hash,noise:hash,
    starts:data.sites.filter(s=>s.role==='base').sort((a,b)=>a.player-b.player),
    clearings:data.sites.map(s=>({...s,radius:12})),ascents:data.ramps,layout:data.description};
}
