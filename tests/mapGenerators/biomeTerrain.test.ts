import {expect,test} from 'bun:test';
import {generateMapLayout,type PlayerCount} from '../../src/mapGenerators';
import {createBiomeTerrain} from '../../src/mapGenerators/biomeTerrain';
import {inspectRoutes} from '../../src/mapGenerators/navigation';

for(const [players,seed] of [[2,77],[2,56204],[4,77],[4,56204],[6,77],[6,56204]] satisfies [PlayerCount,number][])
test(`${players} players, seed ${seed}: sculpted biome terrain keeps pads, entrances and alternate routes`,()=>{
  const source=generateMapLayout({generator:'multiplayer',seed,players});
  const originalHeights=source.heights.slice(),originalBlocked=source.blocked.slice(),originalRock=source.rockEdges.slice();
  const {layout,talus}=createBiomeTerrain(source);
  const bases=layout.sites.filter(site=>site.role==='base'),row=layout.cells+1,step=layout.size/layout.cells;
  const routes=inspectRoutes(layout.heights,layout.cells,layout.size,bases[0],layout.blocked,3);
  for(const site of layout.sites)expect(routes.pathTo(site).length).toBeGreaterThan(0);
  for(const ramp of layout.ramps)for(const point of [ramp.a,ramp.b,{x:(ramp.a.x+ramp.b.x)/2,z:(ramp.a.z+ramp.b.z)/2}])
    expect(routes.pathTo(point).length).toBeGreaterThan(0);

  const bypass=layout.blocked.slice();
  let changedMountain=0,sediment=0;
  let preservedPads=true,finiteHeights=true;
  for(let i=0;i<layout.heights.length;i++){
    const x=i%row*step-layout.size/2,z=Math.floor(i/row)*step-layout.size/2;
    if(Math.hypot(x-layout.focus.x,z-layout.focus.z)<layout.bypassRadius)bypass[i]=1;
    if(bases.some(base=>Math.hypot(x-base.x,z-base.z)<18)){
      preservedPads&&=layout.heights[i]===source.heights[i]&&layout.blocked[i]===source.blocked[i];
    }
    finiteHeights&&=Number.isFinite(layout.heights[i]);
    if(source.blocked[i]&&Math.abs(layout.heights[i]-source.heights[i])>2)changedMountain++;
    if(talus[i]>.2&&!source.blocked[i]&&layout.heights[i]>source.heights[i]+.25)sediment++;
  }
  const alternate=inspectRoutes(layout.heights,layout.cells,layout.size,bases[0],bypass,3);
  for(const base of bases)expect(alternate.pathTo(base).length).toBeGreaterThan(0);
  expect(changedMountain).toBeGreaterThan(0);
  expect(sediment).toBeGreaterThan(0);
  expect(preservedPads).toBe(true);
  expect(finiteHeights).toBe(true);
  expect(source.heights).toEqual(originalHeights);
  expect(source.blocked).toEqual(originalBlocked);
  expect(source.rockEdges).toEqual(originalRock);
});

test('the optional sculpted surface is deterministic and leaves non-regional families unchanged',()=>{
  const source=generateMapLayout({generator:'multiplayer',seed:56204,players:4});
  const first=createBiomeTerrain(source),second=createBiomeTerrain(source);
  expect(first.layout.heights).toEqual(second.layout.heights);
  expect(first.layout.blocked).toEqual(second.layout.blocked);
  expect(first.talus).toEqual(second.talus);
  const other=generateMapLayout({generator:'mesas',seed:77,players:2});
  const unchanged=createBiomeTerrain(other);
  expect(unchanged.layout.heights).toEqual(other.heights);
  expect(unchanged.layout.blocked).toEqual(other.blocked);
  expect(unchanged.layout.rockEdges).toEqual(other.rockEdges);
  expect(unchanged.talus.some(Boolean)).toBe(false);
});

test('talus from a higher mountain foot does not stamp a cliff onto the lower terrace',()=>{
  const source=generateMapLayout({generator:'multiplayer',seed:56204,players:4});
  const {layout}=createBiomeTerrain(source),row=layout.cells+1,step=layout.size/layout.cells;
  let uplift=0,edge=0;
  // The curved terrace beside Base C previously acquired a straight,
  // seven-metre cliff where a neighboring talus fan's sampling window ended.
  for(let i=0;i<layout.heights.length;i++){
    const x=i%row*step-layout.size/2,z=Math.floor(i/row)*step-layout.size/2;
    if(x<-88||x>-60||z<-102||z>-72)continue;
    const delta=layout.heights[i]-source.heights[i];
    uplift=Math.max(uplift,delta);
    for(const neighbor of [i-1,i-row])
      edge=Math.max(edge,Math.abs(delta-(layout.heights[neighbor]-source.heights[neighbor])));
  }
  expect(uplift).toBeLessThan(.5);
  expect(edge).toBeLessThan(.25);
});
