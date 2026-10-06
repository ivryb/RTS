import type {MapLayout, TerrainRegion} from './types';

export type TerrainBiome = 'desert' | 'oasis';
export interface TerrainBiomes {
  regions:(TerrainRegion & {biome:TerrainBiome;name:string})[];
  oasis:Float32Array;
}

/** Soft inset of a territory union; shared borders between like biomes disappear. */
function regionField(layout:MapLayout, members:Set<number>) {
  const field=new Float32Array(layout.regionIds.length);
  const row=layout.cells+1,step=layout.size/layout.cells,diagonal=step*Math.SQRT2,width=10;
  for(let z=1;z<layout.cells;z++)for(let x=1;x<layout.cells;x++){
    const i=z*row+x;
    if(members.has(layout.regionIds[i]))field[i]=width;
  }
  for(let z=1;z<layout.cells;z++)for(let x=1;x<layout.cells;x++){
    const i=z*row+x;
    field[i]=Math.min(field[i],field[i-1]+step,field[i-row]+step,field[i-row-1]+diagonal,field[i-row+1]+diagonal);
  }
  for(let z=layout.cells-1;z>0;z--)for(let x=layout.cells-1;x>0;x--){
    const i=z*row+x;
    field[i]=Math.min(field[i],field[i+1]+step,field[i+row]+step,field[i+row-1]+diagonal,field[i+row+1]+diagonal);
  }
  for(let i=0;i<field.length;i++){
    const t=field[i]/width;
    field[i]=t*t*(3-2*t);
  }
  return field;
}

/** Seeded floor biomes follow existing territories; terrain and navigation stay unchanged. */
export function createTerrainBiomes(layout:MapLayout):TerrainBiomes {
  const baseRegions=new Set(layout.regions.filter(region=>layout.sites.some(site=>
    site.role==='base'&&site.x===region.x&&site.z===region.z)).map(region=>region.id));
  const candidates=layout.regions.filter(region=>!region.mountain&&!baseRegions.has(region.id));
  const selected=new Map<number,TerrainBiome>();
  const variation=(id:number,salt:number)=>{
    let value=Math.imul(id+salt,374761393)^layout.seed;
    value=Math.imul(value^(value>>>13),1274126177);
    return ((value^(value>>>16))>>>0)/4294967296;
  };
  const count=layout.playerCount===2?1:2;
  // Keep the seeded dry-valley spacing that established the approved groves.
  // Removing a rock type must not move the entire vegetation habitat.
  for(const biome of ['desert','oasis'] as const){
    const available=candidates.filter(region=>!selected.has(region.id));
    const ids=new Set(available.map(region=>region.id));
    const scores=new Map(available.map(region=>{
      const separation=biome==='oasis'?Math.min(...candidates.filter(r=>selected.has(r.id))
        .map(r=>Math.hypot(r.x-region.x,r.z-region.z)),layout.size)/layout.size:0;
      return [region.id,variation(region.id,biome==='desert'?173:619)+(region.level===2?.3:0)-separation];
    }));
    available.sort((a,b)=>(scores.get(a.id)??0)-(scores.get(b.id)??0));
    const anchor=available.find(region=>count===1||region.neighbors.some(id=>ids.has(id)))??available[0];
    if(!anchor)continue;
    selected.set(anchor.id,biome);
    if(count>1){
      const neighbor=available.find(region=>anchor.neighbors.includes(region.id));
      if(neighbor)selected.set(neighbor.id,biome);
    }
  }
  // Retain the established grove, then seed separate sheltered territories.
  // Expanding one connected patch leaves the rest of the battlefield barren.
  for(let n=0;n<(layout.playerCount===6?2:1);n++){
    const habitat=candidates.filter(region=>selected.get(region.id)==='oasis');
    const separation=(region:TerrainRegion)=>Math.min(layout.size,...habitat.map(other=>
      Math.hypot(region.x-other.x,region.z-other.z)));
    const available=candidates.filter(region=>!selected.has(region.id));
    available.sort((a,b)=>(separation(b)/layout.size+variation(b.id,947)*.06)
      -(separation(a)/layout.size+variation(a.id,947)*.06));
    const anchor=available.find(region=>separation(region)>layout.size*.2);
    if(anchor)selected.set(anchor.id,'oasis');
  }
  const regions=layout.regions.map(region=>{
    const biome=selected.get(region.id)??'desert';
    const label=region.mountain?'Oxide ridge':biome==='oasis'?'Oasis':'Desert';
    return {...region,biome,name:`${label} ${region.id+1}`};
  });
  const members=(biome:TerrainBiome)=>new Set(regions.filter(region=>region.biome===biome).map(region=>region.id));
  return {regions,oasis:regionField(layout,members('oasis'))};
}
