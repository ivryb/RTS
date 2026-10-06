/** Distance in world units from exposed rock. Two grid sweeps include diagonal neighbors. */
export function rockContactDistances(rock:Uint8Array,cells:number,size:number){
  const row=cells+1,step=size/cells,diagonal=step*Math.SQRT2;
  const distances=Float32Array.from(rock,value=>value?0:1e6);
  for(let z=0;z<=cells;z++)for(let x=0;x<=cells;x++){
    const i=z*row+x;
    if(x>0)distances[i]=Math.min(distances[i],distances[i-1]+step);
    if(z>0){
      distances[i]=Math.min(distances[i],distances[i-row]+step);
      if(x>0)distances[i]=Math.min(distances[i],distances[i-row-1]+diagonal);
      if(x<cells)distances[i]=Math.min(distances[i],distances[i-row+1]+diagonal);
    }
  }
  for(let z=cells;z>=0;z--)for(let x=cells;x>=0;x--){
    const i=z*row+x;
    if(x<cells)distances[i]=Math.min(distances[i],distances[i+1]+step);
    if(z<cells){
      distances[i]=Math.min(distances[i],distances[i+row]+step);
      if(x>0)distances[i]=Math.min(distances[i],distances[i+row-1]+diagonal);
      if(x<cells)distances[i]=Math.min(distances[i],distances[i+row+1]+diagonal);
    }
  }
  return distances;
}
