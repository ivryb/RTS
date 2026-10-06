// Fetch the five CC0 scans into the local workbench and prepare tintable study maps.
// Run from the repository root: node prototypes/terrain-playground/prepare-directions.mjs
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const sources=JSON.parse(await readFile(new URL('./texture-sources.json',import.meta.url),'utf8'));
const root='art/workbench/terrain-directions/textures';
await mkdir(root,{recursive:true});
for(const source of sources) {
  const original=`${root}/${source.id}.jpg`;
  let bytes;
  try{bytes=await readFile(original);}catch{bytes=null;}
  if(!bytes||createHash('md5').update(bytes).digest('hex')!==source.md5) {
    execFileSync('curl',['-fsSL','-A','Dune77 terrain concept study',source.url,'-o',original]);
    bytes=await readFile(original);
    if(createHash('md5').update(bytes).digest('hex')!==source.md5)throw new Error(`Source checksum mismatch: ${source.id}`);
  }
  execFileSync('python3',['tools/assets/grade_ground_texture.py',original,`${root}/${source.id}.webp`,'--target-mean','190','--chroma','0.2'],{stdio:'inherit'});
}
await writeFile(`${root}/sources.json`,JSON.stringify(sources,null,2)+'\n');

const models=JSON.parse(await readFile(new URL('./model-sources.json',import.meta.url),'utf8'));
for(const model of models)for(const [path,source] of Object.entries(model.files)) {
  const destination=`art/workbench/terrain-directions/models/${model.id}/${path}`;
  await mkdir(destination.slice(0,destination.lastIndexOf('/')),{recursive:true});
  let bytes;
  try{bytes=await readFile(destination);}catch{bytes=null;}
  if(!bytes||createHash('md5').update(bytes).digest('hex')!==source.md5) {
    execFileSync('curl',['-fsSL','-A','Dune77 terrain concept study',source.url,'-o',destination]);
    bytes=await readFile(destination);
    if(createHash('md5').update(bytes).digest('hex')!==source.md5)throw new Error(`Source checksum mismatch: ${destination}`);
  }
}
console.log('Source scans ready. Authored mineral atlases and concept sheets remain local art-workbench assets.');
