import { expect, test } from 'bun:test';
import { createProceduralRegions } from '../../src/mapGenerators/proceduralRegions';
import { inspectRoutes } from '../../src/mapGenerators/navigation';

test('generated territories have usable sites, entrances, building pads and alternate routes',()=>{
  const cells=240,row=cells+1,step=220/cells;
  const signatures=new Set<string>();
  for(const seed of [77,2026,6857,86230,81164,91945,9153,...Array.from({length:26},(_,i)=>1117+i*7919)]){
    const l=createProceduralRegions(seed);signatures.add(l.signature);
    const heights=Float32Array.from({length:row*row},(_,i)=>l.sample(i%row*step-110,Math.floor(i/row)*step-110));
    const blocked=Uint8Array.from(heights,(_,i)=>Number(l.blocked(i%row*step-110,Math.floor(i/row)*step-110)));
    const nav=inspectRoutes(heights,cells,220,l.starts[0],blocked,3);
    for(const r of l.regions.filter(r=>!r.mountain))expect(nav.pathTo(r).length,`${seed} region ${r.id}`).toBeGreaterThan(0);
    for(const ramp of l.ascents)for(let t=0;t<=1;t+=.05){
      expect(nav.pathTo(ramp.pointAt(t)).length,`${seed} curved ramp at ${t}`).toBeGreaterThan(0);
    }
    for(const base of l.starts){
      const samples=[];
      for(const dx of [-7,0,7])for(const dz of [-7,0,7])samples.push(l.sample(base.x+dx,base.z+dz));
      expect(Math.max(...samples)-Math.min(...samples),`${seed} base pad`).toBeLessThan(.2);
    }
    for(let i=0;i<blocked.length;i++)if(Math.hypot(i%row*step-110-l.focus.x,Math.floor(i/row)*step-110-l.focus.z)<l.bypassRadius)blocked[i]=1;
    expect(inspectRoutes(heights,cells,220,l.starts[0],blocked,3).pathTo(l.starts[1]).length,`${seed} bypass`).toBeGreaterThan(0);
  }
  expect(signatures.size).toBe(33);
},120000);
