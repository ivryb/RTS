import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {generateMapLayout,MAP_GENERATORS,type PlayerCount} from '../../src/mapGenerators';
import {createProceduralRegions} from '../../src/mapGenerators/proceduralRegions';
import {inspectRoutes} from '../../src/mapGenerators/navigation';
import reference from './frontiers-reference.json';

test('two-player reference keeps its exact terrain and sites',()=>{
  for(const item of reference){
    const l=generateMapLayout({generator:'procedural',seed:item.seed,players:2});
    expect(createHash('sha256').update(new Uint8Array(l.heights.buffer)).digest('hex')).toBe(item.hash);
    expect(l.sites).toEqual(item.sites);
  }
},60000);

test('all map families produce reachable sites through the common layout contract',()=>{
  for(const family of MAP_GENERATORS)for(const seed of [77,2026,3564,43942]){
    const l=generateMapLayout({generator:family.id,seed,players:2});
    const base=l.sites.find(s=>s.role==='base')!;
    const nav=inspectRoutes(l.heights,l.cells,l.size,base,l.blocked);
    for(const site of l.sites)expect(nav.pathTo(site).length,`${family.id}: ${site.label}`).toBeGreaterThan(0);
    expect([...l.rockEdges].every(Number.isFinite)).toBe(true);
  }
},120000);

for(const players of [4,6] satisfies PlayerCount[])test(`${players} players: usable bases, expansions, ramps and alternate approaches`,()=>{
  for(const seed of [43942,3564,77,2026,9153,33256]){
    const l=createProceduralRegions(seed,players),row=Math.round(l.size*240/220)+1,cells=row-1,step=l.size/cells;
    expect(l.starts.length).toBe(players);
    for(let player=1;player<=players;player++)expect(l.sites.filter(s=>s.player===player&&s.role==='expansion').length,`${seed} natural ${player}`).toBe(1);
    const heights=Float32Array.from({length:row*row},(_,i)=>l.sample(i%row*step-l.size/2,Math.floor(i/row)*step-l.size/2));
    const blocked=Uint8Array.from(heights,(_,i)=>Number(l.blocked(i%row*step-l.size/2,Math.floor(i/row)*step-l.size/2)));
    const nav=inspectRoutes(heights,cells,l.size,l.starts[0],blocked,3);
    for(const site of l.sites)expect(nav.pathTo(site).length,`${seed} ${site.label}`).toBeGreaterThan(0);
    for(const ramp of l.ascents)for(let i=0;i<=20;i++)expect(nav.pathTo(ramp.pointAt(i/20)).length,`${seed} ramp`).toBeGreaterThan(0);
    for(const base of l.starts){
      const samples=[-7,0,7].flatMap(dx=>[-7,0,7].map(dz=>l.sample(base.x+dx,base.z+dz)));
      expect(Math.max(...samples)-Math.min(...samples),`${seed} pad`).toBeLessThan(.2);
    }
    for(let i=0;i<blocked.length;i++)if(Math.hypot(i%row*step-l.size/2-l.focus.x,Math.floor(i/row)*step-l.size/2-l.focus.z)<l.bypassRadius)blocked[i]=1;
    const bypass=inspectRoutes(heights,cells,l.size,l.starts[0],blocked,3);
    for(const base of l.starts)expect(bypass.pathTo(base).length,`${seed} bypass`).toBeGreaterThan(0);
  }
},180000);
