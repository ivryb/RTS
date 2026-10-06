import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {createProceduralRegions} from '../../src/mapGenerators/proceduralRegions';

// Captured before optimizing boundary sampling and reusing validation fields.
// Include collision and contact fields: a visual-only comparison would miss a mutated bypass mask.
const baselines=[
  [22236,'e2d7488bb795e6647de4b3318ef2b185e4f9c399ac7af7f373463e430f235317'],
  [43942,'f66c2ef5a228e3947cb1d1582fd4e3322547a3d6b0eeac850ccd9abb5c33c99a'],
  [3564,'5f9543537db6feea4b5f1aaaae602473cc8b55d3f150e1a88c4491be3478e2f8'],
] as const;

test('optimized reference profile preserves terrain, collision, rock contact and sites',()=>{
  for(const [seed,expected] of baselines){
    const source=createProceduralRegions(seed,6,'reference');
    const {heights,blocked,cells}=source.fields,row=cells+1,step=source.size/cells;
    const rockEdges=Float32Array.from(heights,(_,i)=>{
      const edge=source.rockBoundary(i%row*step-source.size/2,Math.floor(i/row)*step-source.size/2);
      return Number.isFinite(edge)?edge:-100;
    });
    const layout={heights,blocked,rockEdges,sites:source.sites};
    const hash=createHash('sha256');
    hash.update(new Uint8Array(layout.heights.buffer));
    hash.update(layout.blocked);
    hash.update(new Uint8Array(layout.rockEdges.buffer));
    hash.update(JSON.stringify(layout.sites));
    expect(hash.digest('hex'),String(seed)).toBe(expected);
  }
},60000);
