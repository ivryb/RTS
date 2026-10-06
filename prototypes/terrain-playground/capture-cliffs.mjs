// Legacy Old-terrain diagnostic. Use capture-multiplayer.mjs for recorded visual comparisons.
import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true,args:['--use-angle=metal']});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 for(const seed of [3564,33256,9153]){
  await page.goto(`http://localhost:5173/prototypes/terrain-playground/?variant=old&camera=inspect&quality=balanced&mode=multiplayer&players=2&seed=${seed}`);
  await page.waitForSelector('body[data-ready="true"]');await page.waitForLoadState('networkidle');
  await page.locator('#camera').click();
  await page.screenshot({path:`art/workbench/renders/terrain-playground/cliffs-${seed}-gameplay.png`});
  await page.mouse.move(800,550);await page.mouse.wheel(0,-1400);await page.evaluate(()=>window.terrainProfiler.setView(window.terrainProfiler.inspect().view));
  await page.screenshot({path:`art/workbench/renders/terrain-playground/cliffs-${seed}-detail.png`});
  if(seed===33256){
   await page.mouse.move(1250,650);await page.mouse.down({button:'right'});
   await page.mouse.move(800,650,{steps:12});await page.mouse.up({button:'right'});
   await page.mouse.wheel(0,-800);await page.evaluate(()=>window.terrainProfiler.setView(window.terrainProfiler.inspect().view));
   await page.screenshot({path:'art/workbench/renders/terrain-playground/cliffs-33256-contact.png'});
  }
  console.log(seed,await page.locator('#status').textContent());
 }
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
