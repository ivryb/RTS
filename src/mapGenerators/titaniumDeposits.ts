import type {MapLayout, Point, Site} from './types';
import {sampleMapField} from './sampling';
import {inspectRoutes} from './navigation';
import type {BiomePlacement} from './biomeFeatures';

/** Finite ore and a neighboring construction clearing; extraction belongs to the match simulation. */
export type TitaniumDeposit = Point & {
  id:string;
  resource:'titanium';
  amount:number;
  radius:number;
  angle:number;
  site:Site;
  commandCenterPad:Point & {radius:number};
};

/** Ore occupies the edge of a base or expansion, leaving its reachable center available for a Command Center. */
export function createTitaniumDeposits(layout:MapLayout,trees:readonly Pick<BiomePlacement,'x'|'z'|'size'>[]=[]){
  const {size,cells,heights}=layout,row=cells+1,step=size/cells;
  const index=(p:Point)=>Math.round((p.z+size/2)/step)*row+Math.round((p.x+size/2)/step);
  const point=(i:number)=>({x:i%row*step-size/2,z:Math.floor(i/row)*step-size/2});
  const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.z-b.z);
  const height=(p:Point)=>sampleMapField(layout,heights,p.x,p.z);
  const start=layout.sites.find(site=>site.role==='base')??layout.focus;
  const routes=inspectRoutes(heights,cells,size,start,layout.blocked,3);
  const destinations=[...layout.sites,...layout.ramps.flatMap(ramp=>[ramp.a,ramp.b,{x:(ramp.a.x+ramp.b.x)/2,z:(ramp.a.z+ramp.b.z)/2}])];
  const bases=layout.sites.filter(site=>site.role==='base');
  const centerMask=Uint8Array.from(heights,(_,i)=>Number(distance(point(i),layout.focus)<layout.bypassRadius));
  const bypass=layout.blocked.map((value,i)=>Math.max(value,centerMask[i]));
  let primary=routes,alternate=inspectRoutes(heights,cells,size,start,bypass,3);
  const routePoints=()=>Array.from(new Set([
    ...destinations.flatMap(destination=>primary.pathTo(destination)),
    ...bases.flatMap(base=>alternate.pathTo(base)),
  ].map(index)),point);
  let corridors=routePoints();
  const blockFootprint=(mask:Uint8Array,p:Point,radius:number)=>{
    const xmin=Math.max(0,Math.floor((p.x-radius+size/2)/step)),xmax=Math.min(cells,Math.ceil((p.x+radius+size/2)/step));
    const zmin=Math.max(0,Math.floor((p.z-radius+size/2)/step)),zmax=Math.min(cells,Math.ceil((p.z+radius+size/2)/step));
    for(let z=zmin;z<=zmax;z++)for(let x=xmin;x<=xmax;x++)
      if(Math.hypot(x*step-size/2-p.x,z*step-size/2-p.z)<=radius)mask[z*row+x]=1;
  };
  const blocked=layout.blocked.slice();
  const preservesRoutes=(p:Point,radius:number)=>{
    const candidate=blocked.slice();
    blockFootprint(candidate,p,radius);
    const nextPrimary=inspectRoutes(heights,cells,size,start,candidate,3);
    if(destinations.some(destination=>!nextPrimary.pathTo(destination).length))return false;
    for(let i=0;i<candidate.length;i++)if(centerMask[i])candidate[i]=1;
    const nextAlternate=inspectRoutes(heights,cells,size,start,candidate,3);
    if(bases.some(base=>!nextAlternate.pathTo(base).length))return false;
    primary=nextPrimary;alternate=nextAlternate;corridors=routePoints();
    return true;
  };
  const clear=(center:Point,radius:number,tolerance:number)=>{
    if(Math.abs(center.x)+radius>size/2-3||Math.abs(center.z)+radius>size/2-3)return false;
    let minimum=Infinity,maximum=-Infinity;
    for(let dz=-radius;dz<=radius;dz+=step*2)for(let dx=-radius;dx<=radius;dx+=step*2){
      if(dx*dx+dz*dz>radius*radius)continue;
      const p={x:center.x+dx,z:center.z+dz};
      if(layout.blocked[index(p)])return false;
      const value=height(p);minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);
      if(maximum-minimum>tolerance)return false;
    }
    return true;
  };
  const nearRamp=(p:Point,radius:number)=>layout.ramps.some(ramp=>{
    const dx=ramp.b.x-ramp.a.x,dz=ramp.b.z-ramp.a.z;
    const t=Math.max(0,Math.min(1,((p.x-ramp.a.x)*dx+(p.z-ramp.a.z)*dz)/(dx*dx+dz*dz)));
    return Math.hypot(p.x-ramp.a.x-dx*t,p.z-ramp.a.z-dz*t)<radius+3;
  });
  const deposits:TitaniumDeposit[]=[];
  for(const [siteIndex,site] of layout.sites.entries()){
    const commandCenterPad={x:site.x,z:site.z,radius:6};
    if(!clear(commandCenterPad,commandCenterPad.radius,.75)||!routes.pathTo(commandCenterPad).length)continue;
    const angle=(layout.seed*.61803398875+siteIndex*2.39996322973)%(Math.PI*2);
    const candidates:(Point & {radius:number})[]=[];
    for(const radius of [5.5,5]){
      for(const offset of [25,23,29,21,19.5,17.5,33,37]){
        for(let ray=0;ray<32;ray++){
          const bearing=angle+ray*Math.PI/16;
          const p={x:site.x+Math.cos(bearing)*offset,z:site.z+Math.sin(bearing)*offset};
          if(!clear(p,radius+1,1.4)||nearRamp(p,radius)
            ||layout.sites.some(other=>distance(p,other)<radius+(other.role==='base'?18:12.5))
            ||deposits.some(other=>distance(p,other)<radius+other.radius+5))continue;
          if(trees.some(tree=>distance(p,tree)<radius+tree.size*.75+1))continue;
          candidates.push({...p,radius});
        }
      }
    }
    // Keep known clear routes when possible. At a junction, a bounded search
    // proves a local reroute instead of excluding an otherwise usable expansion.
    const clearCandidate=candidates.find(p=>corridors.every(c=>distance(p,c)>=p.radius+4.25));
    const ranked=(clearCandidate?[]:candidates).map(p=>({p,crossings:corridors.reduce((sum,c)=>sum+Number(distance(p,c)<p.radius+4.25),0)}))
      .sort((a,b)=>a.crossings-b.crossings);
    const candidate=clearCandidate
      ??ranked.slice(0,8).find(({p})=>preservesRoutes(p,p.radius))?.p;
    if(!candidate)continue;
    const placement:TitaniumDeposit={...candidate,id:`titanium-${siteIndex}`,resource:'titanium',amount:site.role==='contest'?24000:16000,
      angle:Math.atan2(site.x-candidate.x,site.z-candidate.z),site,commandCenterPad};
    deposits.push(placement);blockFootprint(blocked,placement,placement.radius);
  }
  return {deposits,blocked};
}
