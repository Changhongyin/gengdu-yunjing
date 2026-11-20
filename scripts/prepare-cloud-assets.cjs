const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');process.chdir(root);
const report=JSON.parse(fs.readFileSync('output/upload-audit.json','utf8'));
const images=report.retainedFiles.filter(f=>/\.(png|jpe?g|webp|gif)$/i.test(f)).map(file=>({file,bytes:fs.statSync(file).size})).sort((a,b)=>b.bytes-a.bytes);
let remaining=images.reduce((n,x)=>n+x.bytes,0);const files={};
for(const image of images){if(remaining<175000)break;const content=fs.readFileSync(image.file),sha=crypto.createHash('sha256').update(content).digest('hex');
 const cloudPath='gengdu-assets/'+sha.slice(0,12)+'/'+path.basename(image.file);
 const destination='output/cloud-upload/'+cloudPath;fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,content);
 files['/'+image.file]={cloudPath,bytes:content.length,sha256:sha};remaining-=image.bytes;
}
fs.writeFileSync('output/cloud-upload/manifest.json',JSON.stringify({files,packagedMediaBytesAfterMigration:remaining,needs:'Cloud environment ID and actual returned cloud:// file IDs; no activation before uploaded files are available.'},null,2)+'\n');
console.log('Prepared '+Object.keys(files).length+' byte-identical cloud images; media after activation: '+remaining+' bytes.');
