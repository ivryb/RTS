import {expect,test} from 'bun:test';
import {generateMapLayout,type PlayerCount} from '../../src/mapGenerators';
import {createBiomeTerrain} from '../../src/mapGenerators/biomeTerrain';
import {createTitaniumDeposits} from '../../src/mapGenerators/titaniumDeposits';
import {inspectRoutes} from '../../src/mapGenerators/navigation';
import {sampleMapField} from '../../src/mapGenerators/sampling';

for(const [players,seed] of [[2,77],[2,56204],[4,77],[4,56204],[6,77],[6,56204]] satisfies [PlayerCount,number][])
test(`${players} players, seed ${seed}: titanium leaves Command Centers, entrances and alternate routes accessible`,()=>{
  const source=generateMapLayout({generator:'multiplayer',seed,players});
  const {layout}=createBiomeTerrain(source);
  const originalBlocked=layout.blocked.slice();
  const {deposits,blocked}=createTitaniumDeposits(layout);
  const bases=layout.sites.filter(site=>site.role==='base');
  expect(deposits.map(deposit=>deposit.site)).toEqual(layout.sites);
  expect(new Set(deposits.map(deposit=>deposit.id)).size).toBe(deposits.length);
  const routes=inspectRoutes(layout.heights,layout.cells,layout.size,bases[0],blocked,3);
  for(const site of layout.sites)expect(routes.pathTo(site).length).toBeGreaterThan(0);
  for(const ramp of layout.ramps)for(const point of [ramp.a,ramp.b,{x:(ramp.a.x+ramp.b.x)/2,z:(ramp.a.z+ramp.b.z)/2}])
    expect(routes.pathTo(point).length).toBeGreaterThan(0);
  for(const deposit of deposits){
    expect(deposit.amount).toBeGreaterThan(0);
    expect(Number.isFinite(deposit.amount)).toBe(true);
    expect(routes.pathTo(deposit.commandCenterPad).length).toBeGreaterThan(0);
    const mine=deposit.commandCenterPad;
    const heights=[sampleMapField(layout,layout.heights,mine.x,mine.z)];
    for(let ray=0;ray<16;ray++){
      const angle=ray*Math.PI/8;
      const x=mine.x+Math.cos(angle)*mine.radius,z=mine.z+Math.sin(angle)*mine.radius;
      const i=Math.round((z/layout.size+.5)*layout.cells)*(layout.cells+1)+Math.round((x/layout.size+.5)*layout.cells);
      expect(blocked[i]).toBe(0);
      heights.push(sampleMapField(layout,layout.heights,x,z));
    }
    expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(.75);
    expect(Math.hypot(deposit.x-mine.x,deposit.z-mine.z)).toBeGreaterThan(deposit.radius+mine.radius);
  }
  const bypass=blocked.slice();
  for(let i=0;i<bypass.length;i++){
    const x=i%(layout.cells+1)/layout.cells*layout.size-layout.size/2;
    const z=Math.floor(i/(layout.cells+1))/layout.cells*layout.size-layout.size/2;
    if(Math.hypot(x-layout.focus.x,z-layout.focus.z)<layout.bypassRadius)bypass[i]=1;
  }
  const alternate=inspectRoutes(layout.heights,layout.cells,layout.size,bases[0],bypass,3);
  for(const base of bases)expect(alternate.pathTo(base).length).toBeGreaterThan(0);
  expect(layout.blocked).toEqual(originalBlocked);
});

test('titanium placement is deterministic, with no mutable resource state shared between calls',()=>{
  const layout=generateMapLayout({generator:'multiplayer',seed:56204,players:4});
  const first=createTitaniumDeposits(layout),second=createTitaniumDeposits(layout);
  expect(first).toEqual(second);
  expect(first.deposits).not.toBe(second.deposits);
  expect(first.blocked).not.toBe(layout.blocked);
});
