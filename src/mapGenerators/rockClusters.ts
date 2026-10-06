import type { Point } from './types';

export type Rock = Point & { sx:number; sy:number; sz:number; angle:number; obstacle:boolean };

export function createRockClusters({sample,blocked,sites,ramps,hash,size=220}:{
  size?:number;
  sample:(x:number,z:number)=>number;
  blocked:(x:number,z:number)=>boolean;
  sites:Point[];
  ramps:{pointAt:(t:number)=>Point;width:number}[];
  hash:(x:number,z:number)=>number;
}) {
  const rocks:Rock[]=[];
  const centers:Point[]=[];
  const entrances=ramps.flatMap(r=>Array.from({length:9},(_,i)=>({...r.pointAt(i/8),radius:r.width/2+7})));
  for(let i=0;i<900&&centers.length<65;i++){
    const x=(hash(i,801)-.5)*(size-20),z=(hash(i,802)-.5)*(size-20);
    if(sites.some(p=>Math.hypot(p.x-x,p.z-z)<19)||entrances.some(p=>Math.hypot(p.x-x,p.z-z)<p.radius))continue;
    if(centers.some(p=>Math.hypot(p.x-x,p.z-z)<9))continue;
    const gx=(sample(x+1,z)-sample(x-1,z))/2,gz=(sample(x,z+1)-sample(x,z-1))/2;
    const slope=Math.hypot(gx,gz),onMountain=blocked(x,z);
    const atFoot=!onMountain&&[[9,0],[-9,0],[0,9],[0,-9]].some(([dx,dz])=>blocked(x+dx,z+dz));
    if(onMountain ? slope<.25||slope>1.6 : !atFoot||slope>.35)continue;
    centers.push({x,z});
    const angle=Math.atan2(gz,gx)+Math.PI/2;
    const count=3+Math.floor(hash(i,803)*3);
    for(let j=0;j<count;j++){
      const scale=j===0?2.4+hash(i,804)*1.7:.6+hash(i,j+810)*1.4;
      const offset=j===0?0:(hash(i,j+830)-.5)*7;
      const px=x+Math.cos(angle)*offset,pz=z+Math.sin(angle)*offset;
      const sy=scale*(onMountain?.65:.85),sx=scale*(1.1+hash(i,j+840)*.5),sz=scale*.72;
      rocks.push({x:px,z:pz,sx,sy,sz,angle:angle+(hash(i,j+850)-.5)*.6,
        obstacle:!onMountain});
    }
  }
  return rocks;
}

/** Local outcrops share the height field and material, including their buried sandy shoulders. */
export function createOutcropSurface(rocks:Rock[]){
  const buckets=new Map<string,Rock[]>();
  const cellSize=12;
  for(const rock of rocks){
    const radius=Math.max(rock.sx,rock.sz)*1.6;
    for(let z=Math.floor((rock.z-radius)/cellSize);z<=Math.floor((rock.z+radius)/cellSize);z++)
      for(let x=Math.floor((rock.x-radius)/cellSize);x<=Math.floor((rock.x+radius)/cellSize);x++){
        const key=`${x},${z}`,bucket=buckets.get(key)??[];bucket.push(rock);buckets.set(key,bucket);
      }
  }
  return (x:number,z:number)=>{
    let height=0,boundary=-Infinity,blocked=false;
    for(const rock of buckets.get(`${Math.floor(x/cellSize)},${Math.floor(z/cellSize)}`)??[]){
      const dx=x-rock.x,dz=z-rock.z,c=Math.cos(rock.angle),s=Math.sin(rock.angle);
      const r=Math.hypot((dx*c-dz*s)/rock.sx,(dx*s+dz*c)/rock.sz);
      if(r>=1.6)continue;
      const t=Math.max(0,1-r/1.6),rise=t*t*(3-2*t);
      height=Math.max(height,rock.sy*rise);
      // Rock shows at the core; the outer shoulder inherits the surrounding sand.
      boundary=Math.max(boundary,(.8-r)*Math.min(rock.sx,rock.sz));
      blocked ||= rock.obstacle&&r<.9;
    }
    return {height,boundary,blocked};
  };
}
