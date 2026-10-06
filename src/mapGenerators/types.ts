export type Point = { x:number; z:number };
export type PlayerCount = 2 | 4 | 6;
export type Site = Point & {label:string;role:'base'|'expansion'|'contest';player:number};
export type MapGeneratorId = 'mesas' | 'ridges' | 'canyons' | 'procedural' | 'multiplayer';
export type MapRequest = {generator:MapGeneratorId;seed:number;players:PlayerCount};
/** Strategic territory polygon before contour warping; regionIds follows its rendered boundary. */
export type TerrainRegion = Point & {
  id:number;
  level:number;
  mountain:boolean;
  polygon:Point[];
  neighbors:number[];
};

/** Engine-neutral data. Row-major fields run from -size/2 to +size/2 on both axes. */
export interface MapLayout {
  generator:MapGeneratorId;
  seed:number;
  playerCount:PlayerCount;
  size:number;
  cells:number;
  heights:Float32Array;
  blocked:Uint8Array;
  rockEdges:Float32Array;
  regions:TerrainRegion[];
  /** Contour-warped territory identity at each height sample; -1 for unsegmented families. */
  regionIds:Int16Array;
  sites:Site[];
  ramps:{a:Point;b:Point;width:number;height:number}[];
  focus:Point;
  bypassRadius:number;
  description:string;
}
