import * as THREE from 'three';
import type {MapLayout} from '../mapGenerators';
import type {BiomeGround} from '../mapGenerators/biomeGround';
import {rockContactDistances} from './rockContact';
import {createPatchWeights} from './patchWeights';

/** Shared terrain surface and optional diagnostic overlay. Caller owns/disposes both geometries. */
export function createMapTerrainGeometry(layout:MapLayout,biomes?:BiomeGround){
  const {size,cells,heights,blocked,seed}=layout;
  // Keep the heightfield indexed: adjacent triangles share the same height,
  // normal and material weights. Expanding them costs six times the vertex work.
  const geometry=new THREE.PlaneGeometry(size,size,cells,cells);
  geometry.rotateX(-Math.PI/2);
  const positions=geometry.attributes.position;
  for(let i=0;i<heights.length;i++)positions.setY(i,heights[i]);
  geometry.computeVertexNormals();
  const normals=geometry.attributes.normal;
  const gradients=Float32Array.from(heights,(_,i)=>
    Math.hypot(normals.getX(i),normals.getZ(i))/Math.max(.001,normals.getY(i)));
  const exposed=Uint8Array.from(heights,(_,i)=>Number(layout.rockEdges[i]>=0||gradients[i]>.48));
  geometry.setAttribute('rockDistance',new THREE.BufferAttribute(rockContactDistances(exposed,cells,size),1));
  geometry.setAttribute('rockEdge',new THREE.BufferAttribute(Float32Array.from(heights,(_,i)=>
    Math.max(layout.rockEdges[i],(gradients[i]-.48)*4)),1));
  if(biomes){
    const weights=new Float32Array(heights.length*2);
    for(let i=0;i<heights.length;i++){weights[i*2]=biomes.oasis[i];weights[i*2+1]=biomes.talus[i];}
    geometry.setAttribute('biomeWeight',new THREE.BufferAttribute(weights,2));
  }
  geometry.setAttribute('patchWeight',createPatchWeights({seed},positions));
  for(const name of ['mountainWeight','mountainFoundationWeight'])
    geometry.setAttribute(name,new THREE.Float32BufferAttribute(heights.length,1));

  // Walkability is a per-face diagnostic, so only this hidden overlay needs
  // separate corners. Its triangle order exactly matches the terrain index.
  const walkGeometry=new THREE.BufferGeometry();
  const indices=geometry.getIndex()!;
  const vertices=new Float32Array(indices.count*3),colors=new Float32Array(indices.count*3);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
  for(let i=0;i<indices.count;i+=3){
    const ia=indices.getX(i),ib=indices.getX(i+1),ic=indices.getX(i+2);
    a.fromBufferAttribute(positions,ia);b.fromBufferAttribute(positions,ib);c.fromBufferAttribute(positions,ic);
    normal.subVectors(b,a).cross(c.sub(a)).normalize();
    const passable=!(blocked[ia]||blocked[ib]||blocked[ic])
      &&Math.hypot(normal.x,normal.z)/Math.max(.001,normal.y)<.58;
    for(let j=0;j<3;j++){
      const index=indices.getX(i+j),offset=(i+j)*3;
      vertices.set([positions.getX(index),positions.getY(index)+.12,positions.getZ(index)],offset);
      colors.set(passable?[.20,.85,.62]:[.95,.19,.10],offset);
    }
  }
  walkGeometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));
  walkGeometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  return {geometry,walkGeometry};
}
