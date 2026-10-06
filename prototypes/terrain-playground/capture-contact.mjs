// Legacy Old-terrain diagnostic. Use capture-multiplayer.mjs for recorded visual comparisons.
import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,args:['--use-angle=metal']});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://localhost:5173/prototypes/terrain-playground/?variant=old&camera=inspect&quality=balanced&mode=multiplayer&seed=56204&players=4');
 await page.waitForSelector('body[data-ready="true"]');await page.waitForLoadState('networkidle');
 await page.locator('#camera').click();
 await page.screenshot({path:'art/workbench/renders/terrain-playground/contact-gameplay.png'});
 await page.mouse.move(800,550);await page.mouse.wheel(0,-1100);await page.evaluate(()=>window.terrainProfiler.setView(window.terrainProfiler.inspect().view));
 await page.screenshot({path:'art/workbench/renders/terrain-playground/contact-detail.png'});
 await page.mouse.move(1200,810);await page.mouse.down({button:'right'});await page.mouse.move(800,550,{steps:10});await page.mouse.up({button:'right'});
 await page.mouse.wheel(0,-1100);await page.evaluate(()=>window.terrainProfiler.setView(window.terrainProfiler.inspect().view));
 await page.screenshot({path:'art/workbench/renders/terrain-playground/contact-close.png'});
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
