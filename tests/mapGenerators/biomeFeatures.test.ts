import {expect,test} from 'bun:test';
import {generateMapLayout,createTerrainBiomes,type PlayerCount} from '../../src/mapGenerators';
import {createBiomeFeatures} from '../../src/mapGenerators/biomeFeatures';
import {inspectRoutes} from '../../src/mapGenerators/navigation';
import {createBiomeTerrain} from '../../src/mapGenerators/biomeTerrain';
import {createTitaniumDeposits} from '../../src/mapGenerators/titaniumDeposits';
import {sampleMapField} from '../../src/mapGenerators/sampling';

for(const [players,seed] of [[2,77],[2,56204],[4,77],[4,56204],[6,77],[6,56204]] satisfies [PlayerCount,number][])
test(`${players} players, seed ${seed}: vegetation and titanium preserve sites and center bypass routes`,()=>{
  const source=generateMapLayout({generator:'multiplayer',seed,players});
  const originalHeights=source.heights.slice(),originalBlocked=source.blocked.slice(),originalRock=source.rockEdges.slice();
  const biomes=createTerrainBiomes(source),terrain=createBiomeTerrain(source),layout=terrain.layout;
  const features=createBiomeFeatures(layout,biomes,terrain);
  // All planting passes, including habitat edges and canopy understory, must
  // anchor in soil. The old scatter could place a plant and rock at one point.
  let rootsOnRock=0,rootsInRubble=0,sharedRockPositions=0;
  // Conservative base-radius/height ratios measured from the runtime assets.
  // Grass has several stems across a broad root cluster, not one central root.
  for(const {plants,footprint} of [
    {plants:features.trees,footprint:.03},
    {plants:features.shrubs,footprint:.105}, {plants:features.grass,footprint:.75},
  ]){
    expect(plants.length).toBeGreaterThan(0);
    for(const plant of plants){
      const radius=Math.max(.15,plant.size*footprint),diagonal=Math.SQRT1_2;
      for(const [dx,dz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],
        [diagonal,diagonal],[-diagonal,diagonal],[diagonal,-diagonal],[-diagonal,-diagonal]]){
        const x=plant.x+dx*radius,z=plant.z+dz*radius;
        const i=Math.round((z/layout.size+.5)*layout.cells)*(layout.cells+1)+Math.round((x/layout.size+.5)*layout.cells);
        if(layout.blocked[i]||sampleMapField(layout,layout.rockEdges,x,z)>=0)rootsOnRock++;
      }
      for(const rock of features.rubble){
        const distance=Math.hypot(plant.x-rock.x,plant.z-rock.z);
        if(distance<rock.size*.5+radius)rootsInRubble++;
        if(distance<1e-6)sharedRockPositions++;
      }
    }
  }
  expect(sharedRockPositions).toBe(0);
  expect(rootsInRubble).toBe(0);
  expect(rootsOnRock).toBe(0);
  // Rock rejection must keep complete patches, rather than leaving individual
  // shrubs or tufts stranded along the soft habitat boundary.
  for(const shrub of features.shrubs)
    expect(features.grass.filter(tuft=>Math.hypot(tuft.x-shrub.x,tuft.z-shrub.z)<=3).length).toBeGreaterThanOrEqual(3);
  for(const tuft of features.grass)
    expect(features.grass.filter(other=>other!==tuft&&Math.hypot(other.x-tuft.x,other.z-tuft.z)<=4.5).length).toBeGreaterThanOrEqual(2);
  // This four-tuft island sat 14 m from its bed despite every tuft having
  // enough immediate neighbors. It must not survive as an isolated decoration.
  if(players===4&&seed===56204){
    expect(features.grass.some(tuft=>Math.hypot(tuft.x+72.08,tuft.z-49.29)<6)).toBe(false);
    // A second round cap remained attached by a thin neck to the main bed.
    expect(features.grass.some(tuft=>Math.hypot(tuft.x+114.7,tuft.z+10.5)<2.5)).toBe(false);
  }
  // Coverage must extend into open oasis floors as an actual bed, rather than
  // passing density checks with small bundles hidden beneath tree crowns.
  const openGrass=features.grass.filter(plant=>features.trees.every(tree=>
    Math.hypot(plant.x-tree.x,plant.z-tree.z)>tree.size+1));
  expect(openGrass.length).toBeGreaterThanOrEqual(12);
  const remaining=new Set(openGrass);
  let broadOpenBed=false;
  for(const first of remaining){
    const bed=[first];remaining.delete(first);
    for(let i=0;i<bed.length;i++)for(const candidate of remaining)
      if(Math.hypot(candidate.x-bed[i].x,candidate.z-bed[i].z)<=4.5){bed.push(candidate);remaining.delete(candidate);}
    const width=Math.max(...bed.map(p=>p.x))-Math.min(...bed.map(p=>p.x));
    const depth=Math.max(...bed.map(p=>p.z))-Math.min(...bed.map(p=>p.z));
    if(bed.length>=12&&Math.max(width,depth)>12)broadOpenBed=true;
  }
  // Small maps can have overlapping tree crowns over most suitable soil;
  // larger fixtures must also retain a connected bed across the open floor.
  if(players>2)expect(broadOpenBed).toBe(true);
  expect(features.grass.some(tuft=>sampleMapField(layout,features.oasisMoisture,tuft.x,tuft.z)<.2)).toBe(true);
  const bases=layout.sites.filter(s=>s.role==='base');
  const resources=createTitaniumDeposits({...layout,blocked:features.blocked},features.trees);
  for(const site of layout.sites.filter(site=>site.role==='contest'||site.role==='expansion'&&site.player>0))
    expect(resources.deposits.some(deposit=>deposit.site===site)).toBe(true);
  const routes=inspectRoutes(layout.heights,layout.cells,layout.size,bases[0],resources.blocked,3);
  for(const site of layout.sites)expect(routes.pathTo(site).length).toBeGreaterThan(0);
  for(const ramp of layout.ramps)for(const point of [ramp.a,ramp.b,{x:(ramp.a.x+ramp.b.x)/2,z:(ramp.a.z+ramp.b.z)/2}])
    expect(routes.pathTo(point).length).toBeGreaterThan(0);
  const bypass=resources.blocked.slice();
  for(let i=0;i<bypass.length;i++){
    const x=i%(layout.cells+1)/layout.cells*layout.size-layout.size/2;
    const z=Math.floor(i/(layout.cells+1))/layout.cells*layout.size-layout.size/2;
    if(Math.hypot(x-layout.focus.x,z-layout.focus.z)<layout.bypassRadius)bypass[i]=1;
  }
  const alternate=inspectRoutes(layout.heights,layout.cells,layout.size,bases[0],bypass,3);
  for(const base of bases)expect(alternate.pathTo(base).length).toBeGreaterThan(0);
  const treeRegions=new Set<number>();
  let treeSpan=0;
  for(const p of features.trees){
    const i=Math.round((p.z/layout.size+.5)*layout.cells)*(layout.cells+1)+Math.round((p.x/layout.size+.5)*layout.cells);
    expect(biomes.oasis[i]).toBeGreaterThan(0);
    treeRegions.add(layout.regionIds[i]);
    for(const other of features.trees)treeSpan=Math.max(treeSpan,Math.hypot(p.x-other.x,p.z-other.z));
  }
  expect(treeRegions.size).toBeGreaterThanOrEqual(2);
  expect(treeSpan).toBeGreaterThan(layout.size*.55);
  for(const deposit of resources.deposits)for(const tree of features.trees)
    expect(Math.hypot(deposit.x-tree.x,deposit.z-tree.z)).toBeGreaterThan(deposit.radius+tree.size*.75);
  expect(source.heights).toEqual(originalHeights);
  expect(source.blocked).toEqual(originalBlocked);
  expect(source.rockEdges).toEqual(originalRock);
});
