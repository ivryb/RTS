import type { Point } from './types';

/** Prototype reachability uses sampled terrain edges, with clearance in world units (one grid cell by default). */
export function inspectRoutes(heights: Float32Array, cells: number, size: number, start: Point, blocked?: Uint8Array, clearance = size/cells) {
  const row=cells+1,step=size/cells;
  const traversable=new Uint8Array(row*row);
  for(let z=1;z<cells;z++)for(let x=1;x<cells;x++) {
    const i=z*row+x;
    const gradientX=(heights[i+1]-heights[i-1])/(2*step);
    const gradientZ=(heights[i+row]-heights[i-row])/(2*step);
    traversable[i]=Number(!blocked?.[i] && Math.hypot(gradientX,gradientZ)<.577);
  }
  const clear=traversable.slice();
  const radius=Math.ceil(clearance/step);
  const offsets: number[]=[];
  for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++) {
    if(Math.hypot(dx,dz)*step<=clearance+.001)offsets.push(dz*row+dx);
  }
  for(let z=1;z<cells;z++)for(let x=1;x<cells;x++) {
    const i=z*row+x;
    if(x<radius||z<radius||x>cells-radius||z>cells-radius||offsets.some(offset=>!traversable[i+offset]))clear[i]=0;
  }
  const indexOf=(p:Point)=>Math.round((p.z+size/2)/step)*row+Math.round((p.x+size/2)/step);
  const origin=indexOf(start);
  const parents=new Int32Array(row*row).fill(-1);
  const queue=new Int32Array(row*row);
  let end=0;
  if(clear[origin]){queue[0]=origin;parents[origin]=origin;end=1;}
  for(let cursor=0;cursor<end;cursor++) {
    const i=queue[cursor];
    for(const next of [i-1,i+1,i-row,i+row]) {
      if(!clear[next]||parents[next]!==-1||Math.abs(heights[next]-heights[i])/step>.577)continue;
      parents[next]=i;queue[end++]=next;
    }
  }
  const pointAt=(i:number)=>({x:(i%row)*step-size/2,z:Math.floor(i/row)*step-size/2});
  const pathTo=(p:Point) => {
    let i=indexOf(p);
    if(i<0||i>=parents.length||parents[i]<0)return [];
    const path:Point[]=[];
    while(i!==origin){path.push(pointAt(i));i=parents[i];}
    path.push(pointAt(origin));return path.reverse();
  };
  return {pathTo,reachable:end,traversable:clear,parents};
}
