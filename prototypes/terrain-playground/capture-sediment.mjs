// Legacy Old-terrain diagnostic. Use capture-multiplayer.mjs for recorded visual comparisons.
import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,args:['--use-angle=metal']});
try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 // Set a reproducible close camera over actual summit sediment, without adding demo globals.
 await page.route('**/prototypes/terrain-playground/main.ts*',async route=>{
  const response=await route.fetch();let body=await response.text();
  body+=`\nconst captureMap=landscape;
 let captureIndex=-1;
 for(let i=0;i<captureMap.heights.length;i++)if(captureMap.blocked[i]&&captureMap.heights[i]>20&&(captureIndex<0||captureMap.rockEdges[i]<captureMap.rockEdges[captureIndex]))captureIndex=i;
 const captureRow=captureMap.cells+1,captureX=(captureIndex%captureRow)/captureMap.cells*captureMap.size-captureMap.size/2,captureZ=Math.floor(captureIndex/captureRow)/captureMap.cells*captureMap.size-captureMap.size/2,captureY=captureMap.heights[captureIndex];
 controls.target.set(captureX,captureY,captureZ);camera.position.set(captureX+17,captureY+28,captureZ+20);controls.update();render();document.body.dataset.sedimentCapture="ready";`;
  await route.fulfill({response,body});
 });
 await page.goto('http://localhost:5173/prototypes/terrain-playground/?variant=old&camera=inspect&quality=balanced&mode=multiplayer&seed=56204&players=4');
 await page.waitForSelector('body[data-sediment-capture="ready"]');
 await page.waitForSelector('body[data-ready="true"]',{timeout:90000});await page.waitForLoadState('networkidle');
 await page.screenshot({path:'art/workbench/renders/terrain-playground/summit-sediment-close.png'});
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close()}
