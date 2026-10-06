import * as THREE from 'three';

type ProfileView = {position:[number,number,number];target:[number,number,number]};
type ProfileOptions = {
  frames?:number; shadows?:boolean; vegetation?:boolean; pixelRatio?:number;
  refreshShadows?:boolean; terrain?:boolean; flatTerrain?:boolean;
  view?:ProfileView;
  pacing?:'animation-frame'|'gpu-complete';
};
const summary=(values:number[])=>{
  const sorted=values.slice().sort((a,b)=>a-b);
  return {mean:values.reduce((sum,value)=>sum+value,0)/values.length,
    median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)]};
};

/** DevTools-only repeatable camera sweep; reports submitted work and real GPU timings. */
export function createTerrainProfiler(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera|THREE.OrthographicCamera,
  target:THREE.Vector3,getVegetation:()=>THREE.Object3D|undefined,render:()=>void){
  const context=renderer.getContext();
  if(!(context instanceof WebGL2RenderingContext))throw new Error('Terrain GPU profiling requires WebGL2');
  const gl=context;
  const timerExtension:unknown=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const timer=typeof timerExtension==='object'&&timerExtension!==null
    &&'TIME_ELAPSED_EXT' in timerExtension&&typeof timerExtension.TIME_ELAPSED_EXT==='number'
    &&'GPU_DISJOINT_EXT' in timerExtension&&typeof timerExtension.GPU_DISJOINT_EXT==='number'
    ?{elapsed:timerExtension.TIME_ELAPSED_EXT,disjoint:timerExtension.GPU_DISJOINT_EXT}:undefined;
  const tick=()=>new Promise<number>(resolve=>requestAnimationFrame(resolve));
  let running=false;
  function inspect(){
    const byObject:{name:string;triangles:number;instances:number;castsShadow:boolean}[]=[];
    const geometries=new Set<THREE.BufferGeometry>();
    scene.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      const triangles=(object.geometry.index?.count??object.geometry.attributes.position.count)/3;
      const instances=object instanceof THREE.InstancedMesh?object.count:1;
      geometries.add(object.geometry);
      byObject.push({name:object.name||object.parent?.name||object.type,triangles:triangles*instances,instances,castsShadow:object.castShadow});
    });
    return {view:{position:camera.position.toArray(),target:target.toArray()},
      projection:camera.type,zoom:camera.zoom,
      viewport:{width:innerWidth,height:innerHeight,pixelRatio:renderer.getPixelRatio()},
      shaderErrors:renderer.info.programs?.flatMap(program=>[program.vertexShader,program.fragmentShader]
        .filter(shader=>!gl.getShaderParameter(shader,gl.COMPILE_STATUS)).map(shader=>gl.getShaderInfoLog(shader))),
      drawingBuffer:renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(),
      gpuTimer:!!timer,renderer:gl.getParameter(gl.RENDERER),
      draw:{...renderer.info.render},memory:{...renderer.info.memory},
      sceneTriangles:byObject.reduce((sum,object)=>sum+object.triangles,0),
      objects:byObject.length,uniqueGeometries:geometries.size,
      largest:byObject.sort((a,b)=>b.triangles-a.triangles).slice(0,15)};
  }
  async function run(options:ProfileOptions={}){
    if(running)throw new Error('A terrain profile is already running');
    running=true;
    const frames=Math.max(5,Math.min(120,Math.trunc(options.frames??45))),warmup=8,plant=getVegetation(),pacing=options.pacing??'gpu-complete';
    const surface=scene.getObjectByName('terrain-surface');
    const terrain=surface instanceof THREE.Mesh?surface:undefined;
    const flatMaterial=options.flatTerrain?new THREE.MeshBasicMaterial({color:'#ad8254'}):undefined;
    const saved={position:camera.position.clone(),quaternion:camera.quaternion.clone(),
      shadows:renderer.shadowMap.enabled,vegetation:plant?.visible,pixelRatio:renderer.getPixelRatio(),
      terrainVisible:terrain?.visible,terrainMaterial:terrain?.material};
    const focus=options.view?new THREE.Vector3(...options.view.target):target.clone();
    const origin=options.view?new THREE.Vector3(...options.view.position):saved.position;
    const offset=origin.clone().sub(focus),up=new THREE.Vector3(0,1,0);
    const cpu:number[]=[],completed:number[]=[],intervals:number[]=[],queries:WebGLQuery[]=[],draws:number[]=[],triangles:number[]=[];
    let previous=0;
    try{
      if(options.shadows!==undefined)renderer.shadowMap.enabled=options.shadows;
      if(plant&&options.vegetation!==undefined)plant.visible=options.vegetation;
      if(options.pixelRatio!==undefined)renderer.setPixelRatio(options.pixelRatio);
      if(terrain&&options.terrain!==undefined)terrain.visible=options.terrain;
      if(terrain&&flatMaterial)terrain.material=flatMaterial;
      renderer.shadowMap.needsUpdate=true;
      for(let i=-warmup;i<frames;i++){
        const timestamp=pacing==='animation-frame'?await tick():performance.now();
        camera.position.copy(offset).applyAxisAngle(up,Math.sin(i/frames*Math.PI*2)*.10).add(focus);
        camera.lookAt(focus);
        if(options.refreshShadows)renderer.shadowMap.needsUpdate=true;
        const query=i>=0&&timer?gl.createQuery():null;
        if(query&&timer)gl.beginQuery(timer.elapsed,query);
        const start=performance.now();render();const elapsed=performance.now()-start;
        if(query&&timer){gl.endQuery(timer.elapsed);queries.push(query);}
        if(pacing==='gpu-complete'){
          // ANGLE may defer finish while its view is offscreen. A one-pixel
          // readback forces the submitted frame to complete on the actual GPU.
          gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));
        }
        if(i>=0){cpu.push(elapsed);completed.push(performance.now()-start);intervals.push(timestamp-previous);draws.push(renderer.info.render.calls);triangles.push(renderer.info.render.triangles);}
        previous=timestamp;
      }
      // Native previews can throttle rAF even while reporting visible. GPU-complete
      // mode measures conservative render throughput, never presented display FPS.
      gl.finish();
      await new Promise(resolve=>setTimeout(resolve,30));
      if(gl.isContextLost()||gl.getError()!==gl.NO_ERROR)throw new Error('WebGL render failed; discard this profile and inspect shader diagnostics');
      const disjoint=timer?Boolean(gl.getParameter(timer.disjoint)):false;
      const gpu=queries.filter(query=>gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))
        .map(query=>Number(gl.getQueryParameter(query,gl.QUERY_RESULT))/1e6);
      return {url:location.href,recordedAt:new Date().toISOString(),frames,options,
        visibility:document.visibilityState,viewport:inspect().viewport,pacing,
        view:{position:origin.toArray(),target:focus.toArray()},drawingBuffer:inspect().drawingBuffer,
        frameMs:pacing==='animation-frame'?summary(intervals):null,
        fps:pacing==='animation-frame'?1000/summary(intervals).mean:null,cpuMs:summary(cpu),
        gpuCompleteMs:pacing==='gpu-complete'?summary(completed):null,
        gpuMs:gpu.some(value=>value>0)&&!disjoint?summary(gpu):null,
        drawCalls:summary(draws),triangles:summary(triangles),memory:{...renderer.info.memory}};
    }finally{
      for(const query of queries)gl.deleteQuery(query);
      camera.position.copy(saved.position);camera.quaternion.copy(saved.quaternion);
      renderer.shadowMap.enabled=saved.shadows;renderer.setPixelRatio(saved.pixelRatio);
      if(plant&&saved.vegetation!==undefined)plant.visible=saved.vegetation;
      if(terrain&&saved.terrainVisible!==undefined)terrain.visible=saved.terrainVisible;
      if(terrain&&saved.terrainMaterial)terrain.material=saved.terrainMaterial;
      flatMaterial?.dispose();renderer.shadowMap.needsUpdate=true;
      running=false;render();
    }
  }
  /** Reproduce close-angle visual defects with the same camera after a reload. */
  function setView(view:ProfileView){
    camera.position.fromArray(view.position);target.fromArray(view.target);
    camera.lookAt(target);render();
  }
  return {inspect,run,setView,get running(){return running;}};
}

declare global {interface Window {terrainProfiler:ReturnType<typeof createTerrainProfiler>}}
