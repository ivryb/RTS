import { expect, test } from 'bun:test';
import { createStrongholds, createCrossroads } from '../../src/mapGenerators/terrainStudies';
import { inspectRoutes } from '../../src/mapGenerators/navigation';

const cells=240,row=cells+1,step=220/cells;
const seeds=[77,2026,6857,32416,35750,86230,...Array.from({length:60},(_,i)=>(i*7919+1117)%100000)];
for(const generate of [createStrongholds,createCrossroads]) {
  test(`${generate.name}: bases, expansions, ramps and center bypass survive seed variation`,()=>{
    for(const seed of seeds){
      const l=generate(seed);
      const heights=Float32Array.from({length:row*row},(_,i)=>l.sample(i%row*step-110,Math.floor(i/row)*step-110));
      const blocked=Uint8Array.from({length:row*row},(_,i)=>Number(l.blocked(i%row*step-110,Math.floor(i/row)*step-110)));
      const nav=inspectRoutes(heights,cells,220,l.starts[0],blocked);
      for(const site of l.sites)expect(nav.pathTo(site).length,`${l.mode}/${seed}: ${site.label}`).toBeGreaterThan(0);
      for(const ramp of l.ascents){
        expect(nav.pathTo(ramp.a).length,`${l.mode}/${seed}: ramp start`).toBeGreaterThan(0);
        expect(nav.pathTo(ramp.b).length,`${l.mode}/${seed}: ramp end`).toBeGreaterThan(0);
        // Check the full entrance itself, not merely another way to its endpoints.
        for(let t=.1;t<1;t+=.1){
          const x=ramp.a.x+(ramp.b.x-ramp.a.x)*t,z=ramp.a.z+(ramp.b.z-ramp.a.z)*t;
          expect(nav.pathTo({x,z}).length,`${l.mode}/${seed}: ramp interior`).toBeGreaterThan(0);
        }
      }
      for(const base of l.starts){
        const samples=[];
        for(const dx of [-7,0,7])for(const dz of [-7,0,7])samples.push(l.sample(base.x+dx,base.z+dz));
        expect(Math.max(...samples)-Math.min(...samples),`${l.mode}/${seed}: building pad`).toBeLessThan(.2);
      }
      // Remove the entire center. An alternate physical approach must still reach the opponent.
      const bypass=blocked.slice();
      for(let i=0;i<bypass.length;i++)if(Math.hypot(i%row*step-110,Math.floor(i/row)*step-110)<(l.mode==='mesas'?28:49))bypass[i]=1;
      expect(inspectRoutes(heights,cells,220,l.starts[0],bypass).pathTo(l.starts[1]).length,`${l.mode}/${seed}: bypass`).toBeGreaterThan(0);
      const baseHeight=l.sample(l.starts[0].x,l.starts[0].z),centerHeight=l.sample(0,0);
      expect(l.mode==='mesas'?baseHeight-centerHeight:centerHeight-baseHeight).toBeGreaterThan(8);
    }
  },60000);
}
