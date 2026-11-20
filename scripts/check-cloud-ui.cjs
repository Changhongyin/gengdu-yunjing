const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const baseline=JSON.parse(fs.readFileSync('output/cloud-ui-baseline.json','utf8'));
function normalize(source){return source.replace(/<view wx:if="{{imageStatus.failed}}" class="panel tiny muted">[\s\S]*?<\/button><\/view>/g,'').replace(/src="[^"]*"/g,'src="[resource]"').replace(/>\s+</g,'><').trim();}
for(const [file,expected]of Object.entries(baseline)){const actual=fs.readFileSync(file,'utf8');assert.equal(file.endsWith('.wxml')?normalize(actual):actual,file.endsWith('.wxml')?normalize(expected):expected,'Visual markup or styling changed: '+file);}
const manifest=JSON.parse(fs.readFileSync('output/cloud-upload/manifest.json','utf8'));
for(const [file,entry]of Object.entries(manifest.files)){const sha=crypto.createHash('sha256').update(fs.readFileSync(file.slice(1))).digest('hex');assert.equal(sha,entry.sha256,'Image changed: '+file);}
console.log('PASS: page/component styles and markup preserved except image bindings and offline retry notices; all 10 cloud candidate images are byte-identical.');
