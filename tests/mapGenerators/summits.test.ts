import {test,expect} from 'bun:test';
import {createProceduralRegions} from '../../src/mapGenerators/proceduralRegions';

test('dominant summits retain elevation variation and preserve the map layout',()=>{
  const before=createProceduralRegions(56204,6,'reference');
  const after=createProceduralRegions(56204,6,'ridges');
  expect(after.signature).toBe(before.signature);
  expect(after.sites).toEqual(before.sites);
  // Broad tilted surfaces may be gentle; reject a single horizontal height cap,
  // rather than requiring the dense small-scale relief of the old crown style.
  const crown=Array.from(after.fields.heights).filter((h,i)=>h>26&&after.fields.blocked[i]).sort((a,b)=>a-b);
  expect(crown.length).toBeGreaterThan(100);
  expect(crown[Math.floor(crown.length*.95)]-crown[Math.floor(crown.length*.05)]).toBeGreaterThan(2);
},30000);

test('live mountains stay below 36 units across map sizes, with varied summits',()=>{
  for(const players of [2,4,6])for(const seed of [14446,56204,22236]){
    const map=createProceduralRegions(seed,players,'ridges');
    const peaks=Array.from(map.fields.heights).filter((height,i)=>map.fields.blocked[i]&&height>17);
    expect(peaks.length).toBeGreaterThan(100);
    expect(Math.max(...peaks)).toBeLessThan(36);
    expect(Math.max(...peaks)-Math.min(...peaks)).toBeGreaterThan(4);
  }
},60000);

test('blocked mountain faces exceed the ground-unit climbing slope',()=>{
  for(const players of [2,4,6]){
    const map=createProceduralRegions(56204,players,'ridges');
    const {heights,cells}=map.fields,row=cells+1,step=map.size/cells;
    let faceSamples=0,steepSamples=0;
    for(let z=1;z<cells;z++)for(let x=1;x<cells;x++){
      const i=z*row+x;
      const depth=map.rockBoundary(x*step-map.size/2,z*step-map.size/2);
      // Measure the main face, beyond the small sandy/rubble apron.
      if(depth<3||depth>5||heights[i]<8)continue;
      const reach=Math.ceil(8/step);
      if(x<reach||z<reach||x+reach>=cells||z+reach>=cells)continue;
      // A sandy shelf also has a material edge; only inspect the outer obstacle face.
      if([i-reach,i+reach,i-row*reach,i+row*reach].every(j=>map.fields.blocked[j]))continue;
      faceSamples++;
      const slope=Math.hypot(heights[i+1]-heights[i-1],heights[i+row]-heights[i-row])/(2*step);
      if(slope>Math.tan(40*Math.PI/180))steepSamples++;
    }
    expect(faceSamples).toBeGreaterThan(100);
    expect(steepSamples/faceSamples).toBeGreaterThan(.9);
  }
},30000);

test('sediment forms sandy crown floors without opening ground access',()=>{
  const map=createProceduralRegions(56204,4,'ridges');
  const {heights,blocked,cells}=map.fields,row=cells+1,step=map.size/cells;
  let shelves=0;
  for(let z=1;z<cells;z++)for(let x=1;x<cells;x++){
    const i=z*row+x;
    if(heights[i]<20||map.rockBoundary(x*step-map.size/2,z*step-map.size/2)>-2)continue;
    expect(blocked[i]).toBe(1);
    const slope=Math.hypot(heights[i+1]-heights[i-1],heights[i+row]-heights[i-row])/(2*step);
    if(slope<.1)shelves++;
  }
  expect(shelves).toBeGreaterThan(100);
},30000);

test('sand contact stays continuous across summit material boundaries',()=>{
  const map=createProceduralRegions(56204,4,'ridges');
  let checked=0;
  for(let z=-map.size/2+2;z<map.size/2-2;z+=2)for(let x=-map.size/2+2;x<map.size/2-2;x+=2){
    if(map.sample(x,z)<20||!map.blocked(x,z))continue;
    const edge=map.rockBoundary(x,z);
    // A hard depth gate used to jump from negative sand to >16 within a grid cell.
    expect(Math.abs(map.rockBoundary(x+.02,z)-edge)).toBeLessThan(1);
    expect(Math.abs(map.rockBoundary(x,z+.02)-edge)).toBeLessThan(1);
    checked++;
  }
  expect(checked).toBeGreaterThan(100);
},30000);
