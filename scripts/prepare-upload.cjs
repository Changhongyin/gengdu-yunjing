// Generate upload exclusions without deleting design sources or originals.
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');process.chdir(root);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name).split(path.sep).join('/')]);
const config=JSON.parse(fs.readFileSync('project.config.json','utf8'));
const cloud=require('../utils/cloud-assets.config');
const fallbacks=require('../utils/asset-fallbacks');
const runtime=require('../utils/asset-runtime');
const sources=[...walk('pages'),...walk('components'),...walk('utils'),'app.js','app.json','app.wxss'];
const assets=new Set();
for(const file of sources){if(!/\.(js|json|wxml|wxss)$/.test(file))continue;const source=fs.readFileSync(file,'utf8');for(const m of source.matchAll(/\/assets\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif|svg)/g))assets.add((runtime[m[0]]||m[0]).slice(1));}
for(const file of assets)if(!fs.existsSync(file))throw Error('Missing runtime image: '+file);
const ignore=(config.packOptions?.ignore||[]).filter(e=>!(e.type==='file'&&e.value.startsWith('assets/')));
for(const folder of ['docs','output','web','.git','.agents','.codex'])if(!ignore.some(e=>e.type==='folder'&&e.value===folder))ignore.push({type:'folder',value:folder});
if(!ignore.some(e=>e.type==='file'&&e.value==='.DS_Store'))ignore.push({type:'file',value:'.DS_Store'});
const isCloud=file=>cloud.enabled&&fallbacks['/'+file]!=='/'+file&&typeof cloud.files['/'+file]==='string'&&cloud.files['/'+file].startsWith('cloud://');
const unused=walk('assets').filter(file=>!assets.has(file)||isCloud(file));for(const file of unused)ignore.push({type:'file',value:file});
const include=(config.packOptions?.include||[]).filter(e=>!e.value.startsWith('assets/'));
// Explicitly retain images referenced from JS data and conditional templates.
for(const file of [...assets].sort())if(!isCloud(file))include.push({type:'file',value:file});
config.packOptions={...config.packOptions,ignore,include};
config.setting={...config.setting,minified:true,minifyWXML:true,minifyWXSS:true,ignoreUploadUnusedFiles:true};
fs.writeFileSync('project.config.json',JSON.stringify(config,null,2)+'\n');
const remoteCount=[...assets].filter(isCloud).length;
console.log('Prepared upload: '+(assets.size-remoteCount)+' local images and '+remoteCount+' cloud images; unused/local cloud copies excluded; originals stay on disk.');
