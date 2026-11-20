// Extract the user's DOCX media and retain a provenance map. No generated imagery.
// Usage: node scripts/import-product-photos.cjs /path/to/商品图片素材.docx
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const sharp=require(process.env.SHARP_PATH||'/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/sharp');
const source=process.argv[2];if(!source)throw Error('Pass the source DOCX path.');
const out=path.resolve(__dirname,'../assets/products');fs.mkdirSync(out,{recursive:true});
const names=['vegetable-plate','vegetable-bowl','vegetable-dish','wood-coaster','wood-bookmark-detail','wood-roundel','wood-gift','wood-desk','wood-sign','wood-pin','wood-bookmarks','wood-magnets','wood-keyrings','notebook-lifestyle','umbrella','mug-lifestyle','canvas-tote','travel-set','drinkware-set','stationery-set','gift-pack','wood-seal'];
(async()=>{const records=[];for(let i=0;i<names.length;i++){
 const entry='word/media/image'+(i+1)+(i<3?'.jpeg':'.png');
 const original=cp.execFileSync('/usr/bin/unzip',['-p',source,entry],{maxBuffer:10*1024*1024});
 const metadata=await sharp(original).metadata(),target=path.join(out,names[i]+'.jpg');
 await sharp(original).rotate().flatten({background:'#f5f1e8'}).jpeg({quality:91,mozjpeg:true}).toFile(target);
 records.push({sourceEntry:entry,target:'/assets/products/'+names[i]+'.jpg',width:metadata.width,height:metadata.height,sourceSha256:crypto.createHash('sha256').update(original).digest('hex')});
 }fs.writeFileSync(path.resolve(__dirname,'../docs/product-photo-sources.json'),JSON.stringify({sourceDocument:path.basename(source),documentSha256:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),note:'Extracted supplied images in full; JPEG encoded without cropping, enlargement or generated content.',images:records},null,2)+'\n');console.log('Imported '+records.length+' supplied product images.');})().catch(e=>{console.error(e);process.exitCode=1;});
