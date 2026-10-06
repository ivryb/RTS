import {expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {generateMapLayout,createTerrainBiomes} from '../../src/mapGenerators';

const layout=generateMapLayout({generator:'multiplayer',seed:56204,players:4});

test('exposing territories and assigning biomes preserves the established battlefield',()=>{
  const biomes=createTerrainBiomes(layout);
  const hash=(array:Float32Array|Uint8Array)=>createHash('sha256')
    .update(new Uint8Array(array.buffer,array.byteOffset,array.byteLength)).digest('hex');
  // Captured before exposing territory metadata: navigation and the approved
  // mountain shape must not change when the visual biome study is enabled.
  expect(hash(layout.heights)).toBe('6045546304257dc99f82ab133d88e2a0e83550d1db55389ef5421dd4243511a3');
  expect(hash(layout.blocked)).toBe('c4c7d8b8abc75a4d99f5407ae39ee5b4a820fb24bb45ce611bc7b892f32c3102');
  expect(hash(layout.rockEdges)).toBe('b31df021b0ad4a18fb470aad6f0b7be5ee9ec92d19bf4caa592f08d63ceb8468');
  expect(layout.regionIds.length).toBe(layout.heights.length);
  expect(new Set(layout.regionIds).size).toBe(layout.regions.length);
  for(const region of biomes.regions){
    if(region.mountain||layout.sites.some(site=>site.role==='base'&&site.x===region.x&&site.z===region.z))
      expect(region.biome).toBe('desert');
  }
});

test('seeded groves retain joined soft borders and reach a separate part of the map',()=>{
  const biomes=createTerrainBiomes(layout),again=createTerrainBiomes(layout),row=layout.cells+1;
  expect(biomes).toEqual(again);
  for(const kind of ['oasis'] as const){
    const regions=biomes.regions.filter(region=>region.biome===kind);
    expect(regions.length).toBeGreaterThanOrEqual(3);
    expect(regions.some(a=>regions.some(b=>a.neighbors.includes(b.id)))).toBe(true);
    expect(regions.some(a=>regions.every(b=>a===b||Math.hypot(a.x-b.x,a.z-b.z)>layout.size*.2))).toBe(true);
    const ids=new Set(regions.map(region=>region.id)),field=biomes[kind];
    let spills=0,core=0,transition=0,maxStep=0,joinedCore=0;
    for(let i=0;i<field.length;i++){
      if(field[i]>0&&!ids.has(layout.regionIds[i]))spills++;
      if(field[i]===1)core++;
      if(field[i]>0&&field[i]<1)transition++;
      for(const j of [i+1,i+row])if(j<field.length){
        maxStep=Math.max(maxStep,Math.abs(field[j]-field[i]));
        if(layout.regionIds[j]!==layout.regionIds[i]&&field[i]>.9&&field[j]>.9)joinedCore++;
      }
    }
    expect(spills).toBe(0);
    expect(core).toBeGreaterThan(500);
    expect(transition).toBeGreaterThan(500);
    expect(joinedCore).toBeGreaterThan(0);
    expect(maxStep).toBeLessThan(.16);
  }
  const ordinary=biomes.oasis.reduce((count,value)=>count+Number(value===0),0);
  expect(ordinary/biomes.oasis.length).toBeGreaterThan(.65);
});

test('unsegmented terrain families retain an empty biome study',()=>{
  const map=generateMapLayout({generator:'ridges',seed:77,players:2});
  const biomes=createTerrainBiomes(map);
  expect(map.regions).toEqual([]);
  expect(map.regionIds.every(id=>id===-1)).toBe(true);
  expect(biomes.regions).toEqual([]);
  expect(biomes.oasis.every(value=>value===0)).toBe(true);
});
