// Verify that the current high-quality profile never substitutes compressed previews.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
process.chdir(path.resolve(__dirname,'..'));
const report=JSON.parse(fs.readFileSync('output/runtime-media.json'));
const upload=JSON.parse(fs.readFileSync('output/upload-audit.json'));
const mapping=require('../utils/asset-runtime');
assert.equal(report.profile,'original-quality');
for(const row of report.files){
 const backup='output/upload-originals/'+row.source.slice('assets/'.length);
 const best=fs.existsSync(backup)?backup:row.source;
 assert(fs.readFileSync(best).equals(fs.readFileSync(row.target)),'Recompressed or downsampled: '+row.source);
 assert.equal(mapping['/'+row.source],'/'+row.target);
 assert(upload.retainedFiles.includes(row.target),'High-quality file excluded: '+row.target);
 assert(!row.target.includes('/optimized/'));
}
const original=report.files.find(row=>row.source==='assets/panoramas/camphor-original.jpg');
const enhanced=report.files.find(row=>row.source==='assets/panoramas/camphor-enhanced.jpg');
assert.deepEqual([original.width,original.height],[2560,1280]);
assert.deepEqual([enhanced.width,enhanced.height],[1774,887]);
const scan=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(dir+'/'+e.name):[dir+'/'+e.name]);
for(const file of [...scan('pages'),...scan('components')].filter(f=>f.endsWith('.wxml'))){
 assert(!fs.readFileSync(file,'utf8').includes('/assets/optimized/'),'Low-quality static image in '+file);
}
assert(!upload.retainedFiles.some(file=>file.startsWith('assets/optimized/')));
assert(!require('../utils/cloud-assets.config').enabled,'Default media must be available offline');
console.log('PASS: all '+report.files.length+' runtime images match the best local originals byte for byte; original 2560×1280 and enhanced 1774×887 panoramas are packaged.');
