// Experimental terrain studies. Deliberately independent of production generation.
import * as THREE from 'three';
import { DEFAULT_ZOOM, MapCamera } from '../../src/camera';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import {createMapTerrainMaterial,createMapTerrainGeometry} from '../../src/terrainRendering';
import {createEnvironmentMaterial} from '../../src/terrainRendering/environmentMaterial';
import { generateMapLayout, type PlayerCount, type Point } from '../../src/mapGenerators';
import { createDemoLayout } from './demoLayout';
import { inspectRoutes } from '../../src/mapGenerators/navigation';
import { TERRAINS, type TerrainVersion } from './directions';
import { createCompositeScene } from './compositeScene';
import { createDirectionControls, type TerrainView } from './directionControls';
import { createTerrainProfiler } from './profiling';

const params = new URLSearchParams(location.search);
const inspectionCamera=params.get('camera')==='inspect'||params.get('view')==='plan';
// Keep existing Oxide wilds links useful without retaining the rejected studies.
let terrainVersion: TerrainVersion = ['new', 'oxide-wilds'].includes(params.get('variant') ?? '') ? 'new' : 'old';
let study: ReturnType<typeof createCompositeScene> | undefined;
let focusedView: TerrainView = 'landscape';
const requestedSeed=Number(params.get('seed')??77);
let seed=Number.isSafeInteger(requestedSeed)?requestedSeed:77;
let overlay = false;
let close = terrainVersion === 'new';
let topDown = params.get('view')==='plan';
let highQuality=params.get('quality')==='high';
const requestedPlayers=Number(params.get('players')??4);
let players:PlayerCount=requestedPlayers===6?6:requestedPlayers===2?2:4;
let size=220,cells=240,step=size/cells,row=cells+1;
const title = document.querySelector<HTMLElement>('#title')!;
const description = document.querySelector<HTMLElement>('#description')!;
const status = document.querySelector<HTMLElement>('#status')!;
const seedInput = document.querySelector<HTMLInputElement>('#seed')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#353c38');
const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.shadowMap.enabled = true;
// The landscape and sun are static while orbiting. Rebuild shadows only when
// assets, visibility, terrain or the lighting view changes.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
document.querySelector('#viewport')!.append(renderer.domElement);
const mapCamera=inspectionCamera?undefined:new MapCamera(renderer.domElement,size);
const camera=mapCamera?.camera??new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.1,1500);
const controls=mapCamera?undefined:new OrbitControls(camera,renderer.domElement);
const cameraTarget=mapCamera?.focusPoint??controls!.target;
if(controls){
  controls.maxPolarAngle=Math.PI*.47;
  controls.minDistance=30;
  controls.maxDistance=600;
}
document.body.dataset.camera=inspectionCamera?'inspect':'game';
const cameraMode=document.querySelector<HTMLSelectElement>('#camera-mode')!;
cameraMode.value=inspectionCamera?'inspect':'game';
cameraMode.onchange=()=>{
  const url=new URL(location.href);
  if(cameraMode.value==='inspect')url.searchParams.set('camera','inspect');
  else{url.searchParams.delete('camera');url.searchParams.delete('view');}
  location.assign(url);
};
document.querySelector<HTMLElement>('#topdown')!.hidden=!inspectionCamera;
document.querySelector('#camera-help')!.textContent=inspectionCamera
  ?'Drag to orbit · Scroll to zoom · Right-drag to pan'
  :'WASD / arrows to move · Middle-drag to pan · Scroll to zoom';
const ambient = new THREE.HemisphereLight(0xfff4e4, 0x8b765d, 1.25);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffedda, 2.65);
sun.position.set(-95, 145, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, near: 1, far: 400 });
sun.shadow.normalBias = 0.18;
scene.add(sun);
const root = new THREE.Group();
scene.add(root);
const labelsRoot=document.createElement('div');labelsRoot.id='site-labels';document.body.append(labelsRoot);
let siteLabels: {element:HTMLElement;position:THREE.Vector3}[]=[];
const siteMaterial=new THREE.MeshStandardMaterial({color:'#72d8d0',roughness:.75});
function drawSites(){
  labelsRoot.replaceChildren();siteLabels=[];
  for(const site of landscape.sites){
    const element=document.createElement('span');element.className=`site-label ${site.role}`;element.textContent=site.label;labelsRoot.append(element);
    const h=surface(site.x,site.z);
    siteLabels.push({element,position:new THREE.Vector3(site.x,h+3,site.z)});
    if(site.role==='base'&&terrainVersion==='old'){
      const pad=new THREE.Mesh(new THREE.CylinderGeometry(4.3,5,1.3,6),siteMaterial);
      pad.position.set(site.x,h+.65,site.z);pad.castShadow=true;root.add(pad);
      const tower=new THREE.Mesh(new THREE.BoxGeometry(3,2.5,3),siteMaterial);tower.position.set(site.x,h+2,site.z);tower.castShadow=true;root.add(tower);
    }
  }
}
function placeLabels(){
  for(const label of siteLabels){
    const p=label.position.clone().project(camera);
    label.element.style.transform=`translate(-50%,-100%) translate(${(p.x+1)*innerWidth/2}px,${(1-p.y)*innerHeight/2-7}px)`;
    label.element.hidden=p.z>1;
  }
}
let continuousRockMaterial: THREE.MeshStandardMaterial | undefined;
let assetsLoading=false,environmentReady=false;
function finishLoading(){
  if(assetsLoading||!environmentReady||document.body.dataset.ready==='error')return;
  // Capture readiness covers terrain textures as well as models, after their
  // final render. Model completion alone can expose a partially textured frame.
  invalidateScene();
  document.body.dataset.ready='true';
}
THREE.DefaultLoadingManager.onStart=()=>{assetsLoading=true;document.body.dataset.ready='false';};
THREE.DefaultLoadingManager.onLoad=()=>{assetsLoading=false;finishLoading();};
THREE.DefaultLoadingManager.onError=url=>{
  document.body.dataset.ready='error';
  console.error(`Terrain asset could not load: ${url}`);
};
const baseMaterial = new THREE.MeshStandardMaterial({ color: '#86684b', roughness: 1, side: THREE.DoubleSide });
const overlayMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false });
let walkMesh: THREE.Mesh | undefined;
let heights:Float32Array = new Float32Array(row * row);
let blocked:Uint8Array = new Uint8Array(row * row);
let landscape:ReturnType<typeof createDemoLayout>;
let navigation: ReturnType<typeof inspectRoutes>;
let terrainMesh: THREE.Mesh;
const routeRoot = new THREE.Group();
scene.add(routeRoot);
let showRoutes = topDown;
const routeMaterial = new THREE.LineBasicMaterial({ color: '#9de4d8', depthTest: false });
const flankMaterial = new THREE.LineBasicMaterial({ color: '#f7c96d', depthTest: false });
const markerMaterial = new THREE.MeshBasicMaterial({ color: '#9de4d8', side: THREE.DoubleSide, depthTest: false });
const surface = (x: number,z: number) => landscape.sample(x,z);
function clearRoutes() {
  routeRoot.traverse(object => { if(object instanceof THREE.Mesh || object instanceof THREE.Line) object.geometry.dispose(); });
  routeRoot.clear();
}
function drawRoute(path: Point[], material=routeMaterial) {
  if(!path.length)return;
  const geometry = new THREE.BufferGeometry().setFromPoints(path.map(p=>new THREE.Vector3(p.x,surface(p.x,p.z)+.6,p.z)));
  const line = new THREE.Line(geometry,material);line.renderOrder=5;routeRoot.add(line);
}
function drawPlan() {
  clearRoutes();
  for(const [index,p] of landscape.clearings.entries()) {
    const ring=new THREE.Mesh(new THREE.RingGeometry(index<2?3:1.6,index<2?3.6:2,32),markerMaterial);
    ring.rotation.x=-Math.PI/2;ring.position.set(p.x,surface(p.x,p.z)+.6,p.z);ring.renderOrder=6;routeRoot.add(ring);
  }
  {
    const center=landscape.focus;
    const fromCenter=inspectRoutes(heights,cells,size,center,blocked);
    for(const base of landscape.starts.slice(1))drawRoute([...navigation.pathTo(center),...fromCenter.pathTo(base).slice(1)]);
    const bypass=blocked.slice();
    for(let i=0;i<bypass.length;i++){
      const x=i%row*step-size/2,z=Math.floor(i/row)*step-size/2;
      if(Math.hypot(x-center.x,z-center.z)<landscape.bypassRadius)bypass[i]=1;
    }
    const alternate=inspectRoutes(heights,cells,size,landscape.starts[0],bypass);
    for(const base of landscape.starts.slice(1))drawRoute(alternate.pathTo(base),flankMaterial);
  }
  routeRoot.visible=showRoutes;
  const key=document.querySelector<HTMLElement>('#route-key')!;
  key.hidden=!showRoutes;
}
function rebuild() {
  environmentReady=false;
  study?.dispose();study=undefined;focusedView='landscape';
  delete document.body.dataset.environmentAssets;
  delete document.body.dataset.environmentCounts;
  delete document.body.dataset.biomeRegions;
  delete document.body.dataset.grassUnits;
  root.traverse(object => { if (object instanceof THREE.Mesh) {
    object.geometry.dispose();
    if(object instanceof THREE.InstancedMesh&&object.material instanceof THREE.Material)object.material.dispose();
  } });
  root.clear();
  document.body.dataset.ready='false';
  continuousRockMaterial?.map?.dispose();continuousRockMaterial?.dispose();

  landscape = createDemoLayout(generateMapLayout({seed,generator:'multiplayer',players}));
  if(terrainVersion==='new'){study=createCompositeScene(landscape);landscape=study.layout;scene.add(study.group);}
  size=landscape.size;cells=landscape.cells;row=cells+1;step=size/cells;
  continuousRockMaterial=terrainVersion==='new'?createEnvironmentMaterial(size,seed):createMapTerrainMaterial(size,seed);
  heights=landscape.heights;blocked=study?.blocked??landscape.blocked;
  mapCamera?.setTerrain(landscape);
  sun.shadow.camera.left=sun.shadow.camera.bottom=-size*.72;
  sun.shadow.camera.right=sun.shadow.camera.top=size*.72;
  sun.shadow.camera.updateProjectionMatrix();
  navigation=inspectRoutes(heights,cells,size,landscape.starts[0],blocked);
  const {geometry,walkGeometry}=createMapTerrainGeometry({...landscape,blocked},study?.ground);
  const terrain=new THREE.Mesh(geometry,continuousRockMaterial);
  terrain.name='terrain-surface';
  terrain.receiveShadow=true;terrain.castShadow=true;root.add(terrain);terrainMesh=terrain;
  walkMesh=new THREE.Mesh(walkGeometry,overlayMaterial);walkMesh.visible=overlay;root.add(walkMesh);
  const skirtPositions:number[]=[];
  for(let i=0;i<cells;i++)for(const [a,b] of [[i,i+1],[cells*row+i,cells*row+i+1],[i*row,(i+1)*row],[i*row+cells,(i+1)*row+cells]]) {
    const ax=(a%row)*step-size/2,az=Math.floor(a/row)*step-size/2,bx=(b%row)*step-size/2,bz=Math.floor(b/row)*step-size/2;
    skirtPositions.push(ax,heights[a],az,bx,heights[b],bz,ax,-3,az,bx,heights[b],bz,bx,-3,bz,ax,-3,az);
  }
  const skirtGeometry=new THREE.BufferGeometry();skirtGeometry.setAttribute('position',new THREE.Float32BufferAttribute(skirtPositions,3));skirtGeometry.computeVertexNormals();
  root.add(new THREE.Mesh(skirtGeometry,baseMaterial));
  drawPlan();
  drawSites();
  directionControls.refresh(terrainVersion,study);
  title.textContent=TERRAINS[terrainVersion].name;description.textContent=TERRAINS[terrainVersion].description;
  const destinations=landscape.clearings.filter(p=>navigation.pathTo(p).length>0).length;
  status.textContent=`${'layout' in landscape ? landscape.layout+'. ' : ''}Seed ${seed} · ${destinations}/${landscape.clearings.length} sites connected · ${landscape.ascents.length} passes. Click the ground to probe a route from the first base.`;
  document.body.dataset.connected=String(destinations===landscape.clearings.length);
  document.body.dataset.heightSignature=String(heights.reduce((sum,h,i)=>sum+h*((i%17)+1),0).toFixed(2));
  seedInput.value=String(seed);
  document.querySelector('#routes')!.setAttribute('aria-pressed',String(showRoutes));
  document.querySelector('#topdown')!.setAttribute('aria-pressed',String(topDown));
  history.replaceState(null,'',`?mode=multiplayer&seed=${seed}&players=${players}&variant=${terrainVersion}${topDown?'&view=plan':''}${highQuality?'&quality=high':''}${inspectionCamera?'&camera=inspect':''}`);
  document.querySelector<HTMLSelectElement>('#players')!.value=String(players);
  const currentStudy=study;
  if(currentStudy){
    currentStudy.ready.then(()=>{
      if(study!==currentStudy)return;
      environmentReady=true;finishLoading();
    }).catch(error=>{
      if(study!==currentStudy)return;
      document.body.dataset.ready='error';
      status.textContent='Terrain assets could not load. Check the local environment assets.';
      console.error(error);
    });
  }else{environmentReady=true;finishLoading();}
  invalidateScene();
}
function setCamera() {
  if(mapCamera){
    document.querySelector('#camera')!.textContent=focusedView==='units'?(close?'Regular view':'Closer view'):'Reset view';
    const target=focusedView!=='landscape'&&study?study.views[focusedView].position:landscape.starts[0];
    if(focusedView==='units'&&study){
      // MapCamera focuses on y=0. Project the elevated units along its view
      // direction so they stay centered at every regular gameplay zoom.
      const offset=camera.position.clone().sub(mapCamera.focusPoint);
      const height=study.views.units.position.y;
      mapCamera.focus({x:target.x-height*offset.x/offset.y,z:target.z-height*offset.z/offset.y});
    }else mapCamera.focus(target);
    if(focusedView==='units'&&close){camera.zoom=DEFAULT_ZOOM*1.8;camera.updateProjectionMatrix();}
    render();return;
  }
  if(!controls)return;
  document.querySelector('#camera')!.textContent=close?'Overview':'Closer view';
  document.querySelector('#topdown')!.setAttribute('aria-pressed',String(topDown));
  const scale=size/220;
  controls.minDistance=terrainVersion==='new'?16:30;
  controls.maxDistance=600*scale;
  if(topDown)camera.position.set(0,420*scale,.01);
  else camera.position.set((close?110:230)*scale,(close?95:220)*scale,(close?125:260)*scale);
  if(terrainVersion==='new'&&!close&&!topDown)camera.position.set(size*.86,size*.92,size*.98);
  controls.target.set(0,close?8:0,0);
  const view=study?.views[focusedView];
  if(view&&(close||focusedView==='units')&&!topDown){
    controls.target.copy(view.position).add(new THREE.Vector3(2,1,1));
    camera.position.copy(controls.target).add(focusedView==='units'
      ?new THREE.Vector3(38,48,38).multiplyScalar(close?.6:1)
      :focusedView==='grove'?new THREE.Vector3(-87,77,-45):new THREE.Vector3(-98,124,126));
  }
  const shadowSpan=terrainVersion==='new'&&close?95:size*.72;
  sun.target.position.copy(controls.target);scene.add(sun.target);
  sun.position.copy(controls.target).add(new THREE.Vector3(-95,145,60));
  Object.assign(sun.shadow.camera,{left:-shadowSpan,right:shadowSpan,top:shadowSpan,bottom:-shadowSpan});
  sun.shadow.camera.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate=true;
  controls.update();
  render();
}
const directionControls=createDirectionControls({
  change(version){
    if(version===terrainVersion)return;
    terrainVersion=version;
    // Keep the inspected mountain at the same angle and scale for Old/New comparisons.
    rebuild();
  },
  focus(view,detail){focusedView=view;close=detail;topDown=false;setCamera();},
  render:invalidateScene,
});
seedInput.onchange=()=>{const value=Number(seedInput.value);seed=Number.isSafeInteger(value)?value:77;rebuild();setCamera();};
document.querySelector<HTMLButtonElement>('#regenerate')!.onclick=()=>{seed=Math.floor(Math.random()*100000);rebuild();setCamera();};
document.querySelector<HTMLButtonElement>('#camera')!.onclick=()=>{close=!close;setCamera();};
document.querySelector<HTMLButtonElement>('#walk')!.onclick=event=>{overlay=!overlay;if(event.currentTarget instanceof HTMLButtonElement)event.currentTarget.setAttribute('aria-pressed',String(overlay));if(walkMesh)walkMesh.visible=overlay;render();};
function resize(){
  if(camera instanceof THREE.PerspectiveCamera)camera.aspect=innerWidth/innerHeight;
  else mapCamera?.resize();
  camera.updateProjectionMatrix();
  // Cap render pixels on laptop/Retina screens; model and texture detail stay
  // identical. High keeps the original 1.5x sampling for larger GPUs.
  renderer.setPixelRatio(highQuality?Math.min(devicePixelRatio,1.5):Math.min(devicePixelRatio,1,Math.sqrt(1_440_000/(innerWidth*innerHeight))));
  renderer.setSize(innerWidth,innerHeight);render();
}
const qualitySelect=document.querySelector<HTMLSelectElement>('#quality')!;
qualitySelect.value=highQuality?'high':'balanced';
qualitySelect.onchange=()=>{
  highQuality=qualitySelect.value==='high';
  const url=new URL(location.href);
  if(highQuality)url.searchParams.set('quality','high');else url.searchParams.delete('quality');
  history.replaceState(null,'',url);resize();
};
window.addEventListener('resize',resize);resize();rebuild();
setCamera();
function render(){
  renderer.render(scene,camera);placeLabels();
  document.querySelector<HTMLOutputElement>('#camera-zoom')!.textContent=mapCamera?`${(camera.zoom/DEFAULT_ZOOM).toFixed(2)}×`:'';
}
function invalidateScene(){renderer.shadowMap.needsUpdate=true;render();}
controls?.addEventListener('change',render);
render();

document.querySelector<HTMLButtonElement>('#routes')!.onclick=event=>{showRoutes=!showRoutes;drawPlan();if(event.currentTarget instanceof HTMLButtonElement)event.currentTarget.setAttribute('aria-pressed',String(showRoutes));render();};
let pointerDown={x:0,y:0};
renderer.domElement.addEventListener('pointerdown',event=>{pointerDown={x:event.clientX,y:event.clientY};});
renderer.domElement.addEventListener('pointerup',event=>{
  if(event.button!==0||Math.hypot(event.clientX-pointerDown.x,event.clientY-pointerDown.y)>5)return;
  const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(event.clientX/innerWidth*2-1,1-event.clientY/innerHeight*2),camera);
  const hit=ray.intersectObject(terrainMesh)[0];if(!hit)return;
  const path=navigation.pathTo({x:hit.point.x,z:hit.point.z});
  clearRoutes();drawRoute(path);routeRoot.visible=true;
  status.textContent=path.length ? `Route found · ${Math.round((path.length-1)*step)} m from the first base. Clearance and 30° slope checked on this terrain.` : 'No ground route from the first base to that point with the prototype clearance and slope limits.';
  render();
});

document.querySelector<HTMLButtonElement>('#topdown')!.onclick=event=>{topDown=!topDown;setCamera();if(event.currentTarget instanceof HTMLButtonElement)event.currentTarget.setAttribute('aria-pressed',String(topDown));render();};

const playerSelect=document.querySelector<HTMLSelectElement>('#players')!;
playerSelect.onchange=()=>{const n=Number(playerSelect.value);players=n===6?6:n===4?4:2;rebuild();setCamera();};
window.terrainProfiler=createTerrainProfiler(renderer,scene,camera,cameraTarget,()=>study?.vegetation,render);

// MapCamera owns the same input behavior as the game. Keep this static preview
// idle on the GPU; only redraw when its position or zoom actually changes.
if(mapCamera){
  const position=camera.position.clone();
  let zoom=camera.zoom,previous=performance.now();
  const update=(now:number)=>{
    const delta=Math.min((now-previous)/1000,.1);previous=now;
    if(!window.terrainProfiler.running){
      mapCamera.update(delta);
      if(!position.equals(camera.position)||zoom!==camera.zoom){
        position.copy(camera.position);zoom=camera.zoom;render();
      }
    }
    requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}
