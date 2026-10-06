import type {Point} from './types';
type Clearing = Point & { radius: number };
type Channel = { a: Point; b: Point; width: number };
type Ascent = Channel & { height: number };
export const mapSize = 220;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x-a)/(b-a)); return t*t*(3-2*t); };

export function createWeatheredHighlands(seed: number) {
  const mode = 'ridges';
  let state = seed >>> 0;
  const random = () => { state += 0x6D2B79F5; let t=state; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; };
  const hash = (x: number, z: number) => { let h=Math.imul(x,374761393)^Math.imul(z,668265263)^seed; h=Math.imul(h^(h>>>13),1274126177); return ((h^(h>>>16))>>>0)/4294967296; };
  const noise = (x: number,z: number) => {
    const ix=Math.floor(x), iz=Math.floor(z), u=smooth(0,1,x-ix),v=smooth(0,1,z-iz);
    const a=hash(ix,iz)*(1-u)+hash(ix+1,iz)*u,b=hash(ix,iz+1)*(1-u)+hash(ix+1,iz+1)*u;
    return a*(1-v)+b*v;
  };
  const angle=random()*Math.PI*2;
  const transform = (x: number,z: number):Point => ({x:x*Math.cos(angle)-z*Math.sin(angle),z:x*Math.sin(angle)+z*Math.cos(angle)});
  const clearings: Clearing[]=[];
  const channels: Channel[]=[];
  const ascents: Ascent[]=[];
  const points: Point[]=[];
  const room = (x:number,z:number,radius:number) => {const p={...transform(x,z),radius}; clearings.push(p);points.push(p);return p;};
  const connect = (a:Point,b:Point,width:number,bend:number) => {
    const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
    let previous=a;
    for(let i=1;i<=12;i++) {
      const t=i/12,offset=Math.sin(t*Math.PI)*bend;
      const next={x:a.x+dx*t-dz/length*offset,z:a.z+dz*t+dx/length*offset};
      channels.push({a:previous,b:next,width:width*(1+.12*Math.sin(t*Math.PI*2))});previous=next;
    }
  };
  const start=room(-76,0,18+random()*4),end=room(76,0,18+random()*4);
  random(); random(); // Preserve the seed sequence of the approved highlands study.
    const chain=[start];
    for(let i=0;i<4;i++)chain.push(room(-46+i*30,(random()-.5)*70,16+random()*9));
    chain.push(end);
    for(let i=1;i<chain.length;i++)connect(chain[i-1],chain[i],10+random()*6,(random()-.5)*25);
    for(const side of [-1,1]) {
      const a=room(-34+(random()-.5)*30,side*(49+random()*15),12+random()*7);
      const b=room(33+(random()-.5)*30,side*(48+random()*18),11+random()*7);
      connect(start,a,6+random()*3,side*12);connect(a,b,5+random()*4,-side*15);connect(b,end,6+random()*3,side*12);
    }
  const segment = (p:Point,a:Point,b:Point) => {
    const dx=b.x-a.x,dz=b.z-a.z,t=clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz));
    return {distance:Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t),t};
  };
  const distance = (x:number,z:number) => {
    let d=Infinity;
    for(const r of clearings)d=Math.min(d,Math.hypot(x-r.x,z-r.z)-r.radius);
    for(const c of channels) {
      const dx=c.b.x-c.a.x,dz=c.b.z-c.a.z;
      const t=clamp(((x-c.a.x)*dx+(z-c.a.z)*dz)/(dx*dx+dz*dz));
      d=Math.min(d,Math.hypot(x-c.a.x-dx*t,z-c.a.z-dz*t)-c.width);
    }
    return d;
  };
  const plateau=13+random()*5;
  // An ascent is a local cut through the cliff, not a wedge applied to the whole mountain.
  for(const r of clearings.slice(2)) {
    if(random()>.65)continue;
    let best: Point | undefined;let clearance=0;
    for(let k=0;k<16;k++) {
      const a=k*Math.PI/8;
      const p={x:r.x+Math.cos(a)*(r.radius+34),z:r.z+Math.sin(a)*(r.radius+34)};
      if(Math.abs(p.x)>94||Math.abs(p.z)>94)continue;
      const d=distance(p.x,p.z);
      if(d>clearance){clearance=d;best=p;}
    }
    if(best && clearance>10)ascents.push({a:r,b:best,width:5,height:plateau});
  }
  const sample = (x:number,z:number) => {
    const broad=noise(x*.032,z*.032),detail=noise(x*.13,z*.13);
    const warpX=(noise(x*.028+19,z*.028)-.5)*8;
    const warpZ=(noise(x*.028,z*.028+47)-.5)*8;
    const rawDistance=distance(x,z);
    // Keep authored route interiors clear; vary only their banks.
    const d=distance(x+warpX,z+warpZ)+(detail-.5)*1.4;
    const ground=.18*noise(x*.09,z*.09);
    let height:number;
    const ridge=1-Math.abs(noise(x*.024+11,z*.024+31)*2-1);
    const ridgeDetail=1-Math.abs(noise(x*.061,z*.061)*2-1);
    const massif=9+26*ridge*ridge+6*ridgeDetail;
    height=massif*smooth(-1,23+12*broad,d);
    height*=smooth(-3,1,rawDistance);
    for(const ramp of ascents) {
      const {distance:d,t}=segment({x,z},ramp.a,ramp.b);
      const target=23*smooth(.12,1,t);
      const cut=(1-smooth(ramp.width,ramp.width+3,d))*(1-smooth(.78,1,t));
      height=height*(1-cut)+Math.min(height,target)*cut;
    }
    return height+ground;
  };
  return {sample,noise,hash,clearings,channels,ascents,starts:[start,end],points,seed,mode};
}
