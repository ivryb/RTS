import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,args:['--use-angle=metal']});
try {
  const page=await browser.newPage({viewport:{width:1700,height:1150}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const started=performance.now();
  await page.goto('http://localhost:5173/prototypes/terrain-playground/?mode=multiplayer&players=6&seed=22236');
  await page.waitForSelector('body[data-ready="true"]');
  console.log(`Six-player demo ready: ${Math.round(performance.now()-started)} ms (includes page load and mesh construction)`);
  await page.screenshot({path:'art/workbench/renders/terrain-playground/multiplayer-performance-22236.png'});
  const signature=await page.locator('body').getAttribute('data-height-signature');
  await page.locator('#walk').click();
  if(await page.locator('#walk').getAttribute('aria-pressed')!=='true')throw new Error('Walkability toggle failed');
  if(await page.locator('body').getAttribute('data-height-signature')!==signature)throw new Error('Walkability changed the map');
  await page.locator('#walk').click();
  for(const seed of [22236,43942,3564]) {
    console.log(await page.evaluate(async seed=>{
      const {generateMapLayout}=await import('/src/mapGenerators/index.ts');
      const start=performance.now();
      const layout=generateMapLayout({generator:'multiplayer',seed,players:6});
      return {seed,generationMs:Math.round(performance.now()-start),sites:layout.sites.length};
    },seed));
  }
  if(errors.length)throw new Error(errors.join('\n'));
} finally {await browser.close();}
