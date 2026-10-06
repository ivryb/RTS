// Legacy Old-terrain diagnostic. Use capture-multiplayer.mjs for recorded visual comparisons.
import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,args:['--use-angle=metal']});
try{
 const page=await browser.newPage({viewport:{width:1700,height:1150}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const seed of [56204,22236,43942]){
  const start=performance.now();
  await page.goto(`http://localhost:5173/prototypes/terrain-playground/?variant=old&camera=inspect&quality=balanced&mode=multiplayer&players=6&seed=${seed}`);
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForLoadState('networkidle');
  if(await page.locator('body').getAttribute('data-connected')!=='true')throw new Error(`Disconnected ${seed}`);
  await page.screenshot({path:`art/workbench/renders/terrain-playground/summits-${seed}.png`});
  console.log(seed,Math.round(performance.now()-start),await page.locator('#status').textContent());
 }
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
