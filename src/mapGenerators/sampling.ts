import type {MapLayout} from './types';

/** Bilinear sampling of a field on the layout grid, clamped to its boundary. */
export function sampleMapField(layout:Pick<MapLayout,'size'|'cells'>,field:Float32Array,x:number,z:number){
  const row=layout.cells+1;
    const u=Math.max(0,Math.min(layout.cells-.0001,(x/layout.size+.5)*layout.cells));
    const v=Math.max(0,Math.min(layout.cells-.0001,(z/layout.size+.5)*layout.cells));
    const ix=Math.floor(u),iz=Math.floor(v),tx=u-ix,tz=v-iz,i=iz*row+ix;
    return (field[i]*(1-tx)+field[i+1]*tx)*(1-tz)+(field[i+row]*(1-tx)+field[i+row+1]*tx)*tz;
}
