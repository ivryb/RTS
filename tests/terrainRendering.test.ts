import {test,expect} from 'bun:test';
import {rockContactDistances} from '../src/terrainRendering/rockContact';

test('rock deposits measure world distance without wrapping across map edges',()=>{
  const mask=new Uint8Array(81);mask[4*9]=1;
  const field=rockContactDistances(mask,8,16);
  expect(field[4*9]).toBe(0);
  expect(field[4*9+1]).toBe(2);
  expect(field[5*9+1]).toBeCloseTo(2*Math.SQRT2);
  expect(field[3*9+8]).toBeGreaterThan(16);
  const empty=rockContactDistances(new Uint8Array(81),8,16);
  expect([...empty].every(distance=>distance>100)).toBe(true);
});

test('indexed terrain keeps sampled heights, triangle diagonals and per-face walkability',async()=>{
  const {generateMapLayout}=await import('../src/mapGenerators');
  const {createMapTerrainGeometry}=await import('../src/terrainRendering/geometry');
  const layout=generateMapLayout({generator:'multiplayer',seed:56204,players:2});
  const {geometry,walkGeometry}=createMapTerrainGeometry(layout);
  const positions=geometry.attributes.position,index=geometry.getIndex()!,row=layout.cells+1;
  expect(positions.count).toBe(layout.heights.length);
  expect(index.count).toBe(layout.cells*layout.cells*6);
  expect(Array.from(index.array.slice(0,6))).toEqual([0,row,1,row,row+1,1]);
  let matchingHeights=true,matchingOverlay=true,upwardTriangles=true;
  for(let i=0;i<positions.count;i++)matchingHeights&&=positions.getY(i)===layout.heights[i];
  for(let i=0;i<index.count;i++){
    const vertex=index.getX(i),overlay=walkGeometry.attributes.position;
    matchingOverlay&&=overlay.getX(i)===positions.getX(vertex)&&overlay.getZ(i)===positions.getZ(vertex)
      &&Math.abs(overlay.getY(i)-positions.getY(vertex)-.12)<.00001;
  }
  for(let i=0;i<index.count;i+=3){
    const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);
    const winding=(positions.getZ(b)-positions.getZ(a))*(positions.getX(c)-positions.getX(a))
      -(positions.getX(b)-positions.getX(a))*(positions.getZ(c)-positions.getZ(a));
    upwardTriangles&&=winding>0;
  }
  expect(matchingHeights).toBe(true);expect(matchingOverlay).toBe(true);expect(upwardTriangles).toBe(true);
  expect(walkGeometry.attributes.color.count).toBe(index.count);
  geometry.dispose();walkGeometry.dispose();
});
