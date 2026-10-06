import { expect, test } from 'bun:test';
import {createWeatheredHighlands, mapSize} from '../../src/mapGenerators/weatheredHighlands';
import {createStrongholds,createCrossroads} from '../../src/mapGenerators/terrainStudies';
const families={mesas:createStrongholds,ridges:createWeatheredHighlands,canyons:createCrossroads};
type Mode=keyof typeof families;
const createLandscape=(seed:number,mode:Mode)=>families[mode](seed);
import { inspectRoutes } from '../../src/mapGenerators/navigation';
import highlandsBaseline from './ridges-baseline.json';

const cells=240;
const row=cells+1;
const sampleGrid=(landscape:ReturnType<typeof createLandscape>)=>Float32Array.from({length:row*row},(_,i)=>landscape.sample((i%row)*mapSize/cells-mapSize/2,Math.floor(i/row)*mapSize/cells-mapSize/2));
for(const mode of ['mesas','ridges','canyons'] satisfies Mode[]) {
  test(`${mode}: routes connect clearings and seeds change large-scale terrain`,()=>{
    let previous:Float32Array | undefined;
    let previousSites: ReturnType<typeof createLandscape>["points"] | undefined;
    for(const seed of [77,2026,6857,32416]) {
      const landscape=createLandscape(seed,mode);
      const heights=sampleGrid(landscape);
      const blocked=Uint8Array.from({length:row*row},(_,i)=>Number('blocked' in landscape && landscape.blocked(i%row*mapSize/cells-mapSize/2,Math.floor(i/row)*mapSize/cells-mapSize/2)));
      const navigation=inspectRoutes(heights,cells,mapSize,landscape.starts[0],blocked);
      for(const clearing of landscape.clearings)expect(navigation.pathTo(clearing).length).toBeGreaterThan(0);
      if(previous) {
        let changed=0;
        for(let i=0;i<heights.length;i++)if(Math.abs(heights[i]-previous[i])>4)changed++;
        if(mode==='ridges')expect(changed/heights.length).toBeGreaterThan(.2);
        else {
          expect(changed/heights.length).toBeGreaterThan(.1);
          expect(landscape.points.some((p,i)=>previousSites && Math.hypot(p.x-previousSites[i].x,p.z-previousSites[i].z)>15)).toBe(true);
        }
      }
      const repeat=createLandscape(seed,mode);
      for(const p of landscape.points)expect(repeat.sample(p.x,p.z)).toBe(landscape.sample(p.x,p.z));
      previous=heights;
      previousSites=landscape.points;
    }
  });
}

test('option 2 retains its exact terrain and landmarks', () => {
  for (const baseline of highlandsBaseline) {
    const landscape = createLandscape(baseline.seed, 'ridges');
    const heights = sampleGrid(landscape);
    expect(new Bun.CryptoHasher('sha256').update(heights).digest('hex')).toBe(baseline.hash);
    expect(landscape.points).toEqual(baseline.points);
  }
});

// Tiny disconnected islands are the movement noise these studies are intended to remove.
for (const mode of ['mesas', 'canyons'] satisfies Mode[]) {
  test(`${mode}: walkability is made of broad regions, not tiny scattered pockets`, () => {
    for (const seed of [77, 2026, 6857, 32416]) {
      const landscape = createLandscape(seed, mode);
      const heights = sampleGrid(landscape);
      const blocked=Uint8Array.from({length:row*row},(_,i)=>Number('blocked' in landscape && landscape.blocked(i%row*mapSize/cells-mapSize/2,Math.floor(i/row)*mapSize/cells-mapSize/2)));
      const navigation = inspectRoutes(heights, cells, mapSize, landscape.starts[0], blocked);
      const unseen = navigation.traversable.slice();
      let smallPocketCells = 0;
      for (let i = 0; i < unseen.length; i++) {
        if (!unseen[i]) continue;
        const queue = [i]; unseen[i] = 0;
        for (let cursor = 0; cursor < queue.length; cursor++) {
          const cell = queue[cursor];
          for (const next of [cell - 1, cell + 1, cell - row, cell + row]) {
            if (!unseen[next] || Math.abs(heights[next] - heights[cell]) / (mapSize / cells) > .577) continue;
            unseen[next] = 0; queue.push(next);
          }
        }
        if (queue.length < 25) smallPocketCells += queue.length;
      }
      expect(smallPocketCells / heights.length).toBeLessThan(.005);
    }
  });
}
