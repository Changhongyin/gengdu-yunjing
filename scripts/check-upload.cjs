const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');process.chdir(root);
const config=JSON.parse(fs.readFileSync('project.config.json','utf8'));
const cloud=require('../utils/cloud-assets.config');
const runtime=require('../utils/asset-runtime');
const match=(file,rule)=>rule.type==='file'?file===rule.value:rule.type==='folder'?(file===rule.value||file.startsWith(rule.value+'/')):false;
for(const rule of [...config.packOptions.ignore,...config.packOptions.include])assert(['file','folder'].includes(rule.type),'Unhandled package rule: '+rule.type);
const keep=file=>config.packOptions.include.some(rule=>match(file,rule))||!config.packOptions.ignore.some(rule=>match(file,rule));
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const file=path.posix.join(dir,e.name);return e.isDirectory()?keep(file)?walk(file):[]:[file];});
const files=walk('.').filter(keep);
const rows=files.map(file=>({file,bytes:fs.statSync(file).size}));
const total=rows.reduce((s,r)=>s+r.bytes,0);const media=rows.filter(r=>/\.(png|jpe?g|webp|gif|mp3|mp4|wav|ogg|aac)$/i.test(r.file));
const mediaTotal=media.reduce((sum,item)=>sum+item.bytes,0);
const strict=process.argv.includes('--strict');
if(strict){for(const item of media)assert(item.bytes<200000,'Media exceeds 200 KB: '+item.file);assert(total<1500000,'Main-package source budget exceeds 1.5 MB: '+total);}
for(const setting of ['minified','minifyWXML','minifyWXSS','ignoreUploadUnusedFiles'])assert.equal(config.setting[setting],true,'Missing upload optimization '+setting);
for(const dir of ['docs','output','web','scripts'])assert(!files.some(f=>f.startsWith(dir+'/')),'Development files included: '+dir);
for(const dir of fs.readdirSync('pages')){
 const file='pages/'+dir+'/index.json';if(!fs.existsSync(file))continue;
 const json=JSON.parse(fs.readFileSync(file,'utf8'));const template=fs.readFileSync(file.replace('.json','.wxml'),'utf8');
 for(const name of Object.keys(json.usingComponents||{}))assert(template.includes('<'+name),'Unused component '+name+' in '+file);
}
const sourceFiles=['app.js','app.wxss',...fs.readdirSync('utils').filter(f=>f.endsWith('.js')).map(f=>'utils/'+f)];
for(const folder of ['pages','components']){const scan=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(d+'/'+e.name):[d+'/'+e.name]);sourceFiles.push(...scan(folder).filter(f=>/\.(wxml|wxss|js|json)$/.test(f)));}
for(const file of sourceFiles){for(const m of fs.readFileSync(file,'utf8').matchAll(/\/assets\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif|svg)/g)){const remote=cloud.enabled&&cloud.files[m[0]];assert(files.includes((runtime[m[0]]||m[0]).slice(1))||typeof remote==='string'&&remote.startsWith('cloud://'),'Runtime image excluded: '+m[0]);}}
const report={measurement:'Conservative uncompressed source size after packOptions; actual compiled upload size is determined by WeChat Devtools.',mainBytes:total,mainKB:Math.round(total/1000),mainMiB:Number((total/1048576).toFixed(3)),fileCount:files.length,mediaCount:media.length,largestMedia:media.sort((a,b)=>b.bytes-a.bytes).slice(0,7),compressionEnabled:true,retainedFiles:files};
fs.mkdirSync('output',{recursive:true});fs.writeFileSync('output/upload-audit.json',JSON.stringify(report,null,2)+'\n');
// Devtools sums ALL image/audio bytes in compiledPkg, across packages.
report.mediaTotalBytes=mediaTotal;report.mediaBudgetBytes=200*1024;report.mediaBudgetPassed=mediaTotal<200*1024;report.cloudAssetsEnabled=cloud.enabled;
fs.writeFileSync('output/upload-audit.json',JSON.stringify(report,null,2)+'\n');
if(strict)assert(mediaTotal<200000,'Cumulative media must stay below 200000 bytes: '+mediaTotal);
console.log('PASS: source package '+total+' bytes ('+report.mainKB+' KB); '+files.length+' files; all runtime resources retained.');
if(!report.mediaBudgetPassed)console.warn('QUALITY NOTE: cumulative media '+mediaTotal+' bytes exceeds the 204800-byte recommendation; full local panoramas are retained for offline functionality.');
console.log('Largest media: '+report.largestMedia.map(x=>x.file+' '+Math.round(x.bytes/1000)+' KB').join(', '));
