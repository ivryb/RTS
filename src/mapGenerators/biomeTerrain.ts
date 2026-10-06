import type {MapLayout, Point} from './types';
import {inspectRoutes} from './navigation';
import {sampleMapField} from './sampling';

type MountainFoot = Point & {nx:number;nz:number;floor:number;relief:number};

const smooth=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};

/** World-space distance to a sampled mask, including diagonal neighbors. */
function distances(mask:Uint8Array,cells:number,step:number){
  const row=cells+1,diagonal=step*Math.SQRT2;
  const field=Float32Array.from(mask,value=>value?0:1e6);
  for(let z=0;z<=cells;z++)for(let x=0;x<=cells;x++){
    const i=z*row+x;
    if(x>0)field[i]=Math.min(field[i],field[i-1]+step);
    if(z>0){
      field[i]=Math.min(field[i],field[i-row]+step);
      if(x>0)field[i]=Math.min(field[i],field[i-row-1]+diagonal);
      if(x<cells)field[i]=Math.min(field[i],field[i-row+1]+diagonal);
    }
  }
  for(let z=cells;z>=0;z--)for(let x=cells;x>=0;x--){
    const i=z*row+x;
    if(x<cells)field[i]=Math.min(field[i],field[i+1]+step);
    if(z<cells){
      field[i]=Math.min(field[i],field[i+row]+step);
      if(x>0)field[i]=Math.min(field[i],field[i+row-1]+diagonal);
      if(x<cells)field[i]=Math.min(field[i],field[i+row+1]+diagonal);
    }
  }
  return field;
}

/** An optional terrain study. Its visible ledges, talus and bedrock are also its navigation surface. */
export function createBiomeTerrain(source:MapLayout){
  const {cells,size}=source,row=cells+1,step=size/cells;
  const heights=source.heights.slice(),blocked=source.blocked.slice(),rockEdges=source.rockEdges.slice();
  const talus=new Float32Array(heights.length);
  const layout={...source,heights,blocked,rockEdges};
  const mountains=new Set(source.regions.filter(region=>region.mountain).map(region=>region.id));
  if(!mountains.size)return {layout,talus};
  const index=(x:number,z:number)=>Math.round((z+size/2)/step)*row+Math.round((x+size/2)/step);
  const point=(i:number)=>({x:i%row*step-size/2,z:Math.floor(i/row)*step-size/2});
  const sample=(field:Float32Array,x:number,z:number)=>sampleMapField(source,field,x,z);
  const height=(x:number,z:number)=>sample(source.heights,x,z);
  const hash=(x:number,z:number)=>{
    let h=Math.imul(x,374761393)^Math.imul(z,668265263)^source.seed;
    h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;
  };
  const noise=(x:number,z:number)=>{
    const ix=Math.floor(x),iz=Math.floor(z),u=smooth(x-ix),v=smooth(z-iz);
    return (hash(ix,iz)*(1-u)+hash(ix+1,iz)*u)*(1-v)+(hash(ix,iz+1)*(1-u)+hash(ix+1,iz+1)*u)*v;
  };

  // The same primary and center-avoiding paths remain broad, unchanged corridors.
  // Protecting only site disks would let a new shoulder close a distant entrance.
  const reserved=new Uint8Array(heights.length),bypass=source.blocked.slice();
  for(let i=0;i<heights.length;i++){
    const p=point(i);
    if(Math.hypot(p.x-source.focus.x,p.z-source.focus.z)<source.bypassRadius)bypass[i]=1;
    if(source.sites.some(site=>Math.hypot(p.x-site.x,p.z-site.z)<(site.role==='base'?13:7)))reserved[i]=1;
    for(const ramp of source.ramps){
      const dx=ramp.b.x-ramp.a.x,dz=ramp.b.z-ramp.a.z;
      const t=Math.max(0,Math.min(1,((p.x-ramp.a.x)*dx+(p.z-ramp.a.z)*dz)/(dx*dx+dz*dz)));
      if(Math.hypot(p.x-ramp.a.x-dx*t,p.z-ramp.a.z-dz*t)<ramp.width/2+3)reserved[i]=1;
    }
  }
  const start=source.sites.find(site=>site.role==='base')??source.focus;
  const routes=inspectRoutes(source.heights,cells,size,start,source.blocked,3);
  const alternate=inspectRoutes(source.heights,cells,size,start,bypass,3);
  for(const site of source.sites)for(const p of routes.pathTo(site))reserved[index(p.x,p.z)]=1;
  for(const site of source.sites.filter(site=>site.role==='base'))
    for(const p of alternate.pathTo(site))reserved[index(p.x,p.z)]=1;
  const routeDistance=distances(reserved,cells,step);
  const permission=Float32Array.from(routeDistance,distance=>smooth((distance-7)/10));
  const mountainTerritory=Uint8Array.from(source.regionIds,id=>Number(mountains.has(id)));
  const mountainDistance=distances(mountainTerritory,cells,step);
  const massif=Uint8Array.from(blocked,(value,i)=>Number(Boolean(value)&&mountainDistance[i]<5));
  const inside=distances(Uint8Array.from(massif,value=>1-value),cells,step);

  // Fractures form joined drainage cuts at landform scale, rather than surface grain.
  const joint=(x:number,z:number)=>{
    const gx=x/19,gz=z/19,ix=Math.floor(gx),iz=Math.floor(gz);
    let first=Infinity,second=Infinity;
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      const cx=ix+dx,cz=iz+dz;
      const distance=Math.hypot(gx-cx-.15-hash(cx,cz)*.7,gz-cz-.15-hash(cx+379,cz+719)*.7);
      if(distance<first){second=first;first=distance;}else second=Math.min(second,distance);
    }
    return 1-smooth((second-first)/.17);
  };
  for(let i=0;i<heights.length;i++)if(massif[i]){
    const {x,z}=point(i),weight=smooth((inside[i]-1)/6)*permission[i];
    // Weathering breaks the cliff outline by moving its contours, rather than
    // punching pointed height pits into otherwise horizontal shelves.
    const wx=x+(noise(x/5.5+113,z/5.5)-.5)*3.4;
    const wz=z+(noise(x/5.5,z/5.5+197)-.5)*3.4;
    const wornHeight=height(wx,wz);
    const phase=(noise(x/28+53,z/28)-.5)*3.4;
    const layer=(wornHeight+phase)/5.5,level=Math.floor(layer),fraction=layer-level;
    const ledge=(level+smooth(fraction/.48))*5.5-phase-wornHeight;
    // Keep drainage cuts subordinate to the shelves; deep continuous trenches
    // made every cap read as a separate rounded block.
    const cut=joint(x+(noise(x/40,z/40)-.5)*9,z)*3.2;
    heights[i]+=weight*(wornHeight-source.heights[i]+ledge*.82-cut+(noise(x/16+29,z/16)-.5)*1.8);
    if(weight>.3&&(cut>1.2||ledge>1))rockEdges[i]=Math.max(rockEdges[i],weight*2.6);
  }

  const candidates:MountainFoot[]=[];
  for(let z=3;z<cells-3;z+=3)for(let x=3;x<cells-3;x+=3){
    const i=z*row+x;
    if(!massif[i]||inside[i]>3.4||permission[i]<.25)continue;
    const p=point(i),dx=height(p.x+5,p.z)-height(p.x-5,p.z),dz=height(p.x,p.z+5)-height(p.x,p.z-5);
    const magnitude=Math.hypot(dx,dz);
    if(magnitude<2)continue;
    const nx=dx/magnitude,nz=dz/magnitude;
    const floor=height(p.x-nx*8,p.z-nz*8);
    const relief=height(p.x+nx*14,p.z+nz*14)-floor;
    if(relief<7||source.blocked[index(p.x-nx*8,p.z-nz*8)])continue;
    candidates.push({...p,nx,nz,floor,relief});
  }
  candidates.sort((a,b)=>hash(Math.round(a.x),Math.round(a.z))-hash(Math.round(b.x),Math.round(b.z)));
  const feet:MountainFoot[]=[];
  for(const candidate of candidates)if(feet.every(foot=>Math.hypot(candidate.x-foot.x,candidate.z-foot.z)>27))feet.push(candidate);

  const visit=(foot:MountainFoot,radius:number,apply:(i:number,x:number,z:number,u:number,v:number)=>void)=>{
    const xmin=Math.max(1,Math.floor((foot.x-radius+size/2)/step)),xmax=Math.min(cells-1,Math.ceil((foot.x+radius+size/2)/step));
    const zmin=Math.max(1,Math.floor((foot.z-radius+size/2)/step)),zmax=Math.min(cells-1,Math.ceil((foot.z+radius+size/2)/step));
    for(let z=zmin;z<=zmax;z++)for(let x=xmin;x<=xmax;x++){
      const i=z*row+x,px=x*step-size/2,pz=z*step-size/2,dx=px-foot.x,dz=pz-foot.z;
      if(permission[i]>0)apply(i,px,pz,-dx*foot.nz+dz*foot.nx,dx*foot.nx+dz*foot.nz);
    }
  };
  for(const foot of feet){
    const variation=hash(Math.round(foot.x)+31,Math.round(foot.z));
    const length=29+variation*14,width=11+variation*7;
    visit(foot,49,(i,x,z,u,v)=>{
      if(v>13||v<-length)return;
      const outward=Math.max(0,-v),spread=width+outward*.34;
      const fan=smooth((1-Math.abs(u+(noise(x/17,z/17)-.5)*4)/spread)*2);
      const toe=smooth(1-outward/length),back=smooth((13-v)/10);
      const sediment=fan*toe*back*permission[i];
      const fanHeight=foot.floor+(5+variation*2)*fan*toe;
      // Blend the whole deposit, including its parent floor, to zero at the fan
      // boundary. Otherwise a high foot stamps its floor onto lower terraces.
      const deposit=Math.max(0,fanHeight-heights[i])*sediment;
      if(deposit>.06){heights[i]+=deposit;talus[i]=Math.max(talus[i],sediment);}
      // A narrow buttress connects the fan to its parent cliff, leaving sand
      // between neighboring spurs rather than inflating the whole mountain.
      const spine=smooth((1-Math.abs(u)/(.52*width))*2);
      const rise=smooth((v+10)/15),connection=smooth((16-v)/9);
      const target=foot.floor+Math.min(foot.relief*.68,14)*spine*rise;
      const uplift=Math.max(0,target-heights[i])*spine*rise*connection*permission[i];
      if(uplift>.2){heights[i]+=uplift;rockEdges[i]=Math.max(rockEdges[i],spine*3);}
      if(uplift>1.2)blocked[i]=1;
    });
  }

  return {layout,talus};
}
