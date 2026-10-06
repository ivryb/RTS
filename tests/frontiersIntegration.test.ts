import {beforeAll,expect,test} from 'bun:test';
import {canPlaceAt,generateMap,sampleHeight} from '../src/map';
import {createCombatProofEncounter} from '../src/combatProofEncounter';
import {initializeNavigation,RecastNavigation} from '../src/sim/navigation';
import {LocalUnitSimulation,toSimPoint,type UnitState} from '../src/sim/units';
import {UNIT_DEFINITIONS} from '../src/sim/unitDefinitions';
import {constructionPlacementIsValid} from '../src/sim/construction';

beforeAll(()=>initializeNavigation());

test('six-player combat proof has usable nearby bases and a route around their buildings',()=>{
 for(const seed of [14446,56204,77]){
  const map=generateMap(seed,6),encounter=createCombatProofEncounter(map);
  const buildings=encounter.buildings.map(b=>({position:toSimPoint(b.x,b.z),radius:b.radius*1000,health:b.health}));
  const units=encounter.units.map(u=>({position:toSimPoint(u.x,u.z),radius:u.radius*1000,health:u.health}));
  const navigation=new RecastNavigation(map);
  try{
   for(const site of map.layout.sites)expect(navigation.plan(units[0].position,toSimPoint(site.x,site.z),1524),`${seed} ${site.label}`).toBeDefined();
   navigation.setObstacles(buildings);
   for(const [i,b] of encounter.buildings.entries())expect(constructionPlacementIsValid(map,b.kind,buildings[i].position,buildings.filter((_,j)=>i!==j),units),`${seed} ${b.id}`).toBe(true);
   const start=units[0].position,goal=units[encounter.units.findIndex(unit=>unit.id==='enemy-ghostrunner-1')].position;
   expect(navigation.plan(start,goal,450),`${seed} combat route`).toBeDefined();
   for(const [i,unit] of encounter.units.entries())expect(navigation.plan(units[i].position,units[i].position,unit.radius*1000),`${seed} ${unit.id}`).toBeDefined();
   const {trees,rubble,grass}=map.environment.features;
   for(const prop of [...trees,...rubble.filter(rock=>rock.size>1.5)])
    expect(constructionPlacementIsValid(map,'command-center',toSimPoint(prop.x,prop.z),[],[]),`${seed} solid prop`).toBe(false);
   if(seed===77){
    // A clear grass floor must stay traversable, while the actual trunks in
    // that same habitat must force a detour rather than being decorative.
    const floor=grass.find(p=>canPlaceAt(map,p.x,p.z,1));
    expect(floor).toBeDefined();
    const floorGoal=toSimPoint(floor!.x,floor!.z),floorPath=navigation.plan(start,floorGoal,306);
    expect(floorPath).toBeDefined();
    expect(Math.hypot(floorPath!.at(-1)!.x-floorGoal.x,floorPath!.at(-1)!.z-floorGoal.z)).toBeLessThan(500);
    const tree=trees.find(p=>[-5,5].every(dx=>canPlaceAt(map,p.x+dx,p.z,.6)
      &&Math.abs(sampleHeight(map,p.x+dx,p.z)-sampleHeight(map,p.x,p.z))<.25));
    expect(tree).toBeDefined();
    const first=toSimPoint(tree!.x-5,tree!.z),last=toSimPoint(tree!.x+5,tree!.z);
    const path=navigation.plan(first,last,306);
    expect(path).toBeDefined();
    expect(Math.hypot(path!.at(-1)!.x-last.x,path!.at(-1)!.z-last.z)).toBeLessThan(500);
    let previous=first;
    for(const point of path!){
     const dx=point.x-previous.x,dz=point.z-previous.z;
     const t=Math.max(0,Math.min(1,((tree!.x*1000-previous.x)*dx+(tree!.z*1000-previous.z)*dz)/(dx*dx+dz*dz||1)));
     expect(Math.hypot(previous.x+dx*t-tree!.x*1000,previous.z+dz*t-tree!.z*1000))
      .toBeGreaterThan(tree!.size*.03*1000+306);
     previous=point;
    }
   }
  }finally{navigation.destroy();}
 }
// Three full maps each build two real Recast radius layers; shared art-rendering load can triple wall time.
},120000);

for(const kind of ['scout-drone','hornet'] as const)test(`${kind} follows ground routes around a blocked mountain`,()=>{
 const size=40,segments=80,row=segments+1,heights=new Float32Array(row*row),mountainMask=new Float32Array(row*row);
 for(let z=0;z<=segments;z++)for(let x=0;x<=segments;x++){
  if(Math.abs(x/2-20)<3&&Math.abs(z/2-20)<8){heights[z*row+x]=12;mountainMask[z*row+x]=1;}
 }
 const definition=UNIT_DEFINITIONS[kind],position=toSimPoint(-15,0);
 const unit:UnitState={id:kind,kind,ownerId:'p',position,target:{...position},health:definition.maxHealth,maxHealth:definition.maxHealth,
  radius:definition.radius*1000,speed:definition.speed*1000,pushable:true,attackCooldownTicks:0,path:[],order:'idle',moving:false,attacking:false};
 const simulation=new LocalUnitSimulation([unit],[],{size,segments,heights,mountainMask});
 try{
  expect(simulation.dispatch('p',{type:'move',unitIds:[kind],target:toSimPoint(15,0)}).accepted).toBe(true);
  let detoured=false;
  for(let tick=0;tick<120;tick++){
   simulation.step();const p=simulation.snapshot()[0].position;
   if(Math.abs(p.z)>8000)detoured=true;
   expect(Math.abs(p.x)<3000&&Math.abs(p.z)<8000).toBe(false);
  }
  expect(detoured).toBe(true);
  expect(simulation.snapshot()[0].position.x).toBeGreaterThan(14000);
 }finally{simulation.dispose();}
});


test.each(['flat ground','Shifting Frontiers'] as const)('ground-routed Scout completes construction on %s',kind=>{
 const map=kind==='Shifting Frontiers'?generateMap(77,6):undefined;
 const site=map?.startingLocations[0]??{x:0,z:0};
 const definition=UNIT_DEFINITIONS['scout-drone'],position=toSimPoint(site.x-12,site.z);
 const scout:UnitState={id:'builder',kind:'scout-drone',ownerId:'p',position,target:{...position},
  health:definition.maxHealth,maxHealth:definition.maxHealth,radius:definition.radius*1000,
  speed:definition.speed*1000,pushable:true,attackCooldownTicks:0,path:[],order:'idle',moving:false,attacking:false};
 const terrain=map??{size:40,segments:80,heights:new Float32Array(81*81)};
 const simulation=new LocalUnitSimulation([scout],[],terrain);
 try{
  expect(simulation.dispatch('p',{type:'build',unitIds:[scout.id],kind:'command-center',
   target:toSimPoint(site.x,site.z),rotation:0}).accepted).toBe(true);
  for(let tick=0;tick<700;tick++)simulation.step();
  expect(simulation.buildingSnapshot()[0]).toMatchObject({lifecycle:'active',constructionProgress:1,health:2500});
  expect(simulation.snapshot()[0]).toMatchObject({order:'idle',constructionTargetId:undefined});
 }finally{simulation.dispose();}
},30000);
