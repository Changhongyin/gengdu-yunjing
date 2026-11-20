const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const base=path.join(root,'web/panorama');
const data=name=>'data:image/jpeg;base64,'+fs.readFileSync(path.join(root,'assets/panoramas/'+name+'.jpg')).toString('base64');
let html=fs.readFileSync(path.join(base,'viewer.html'),'utf8');
html=html.replace('__PANORAMA_RENDERER__',()=>fs.readFileSync(path.join(root,'utils/panorama-renderer.js'),'utf8')).replace('__ENHANCED_URL__',()=>JSON.stringify(data('camphor-enhanced'))).replace('__ORIGINAL_URL__',()=>JSON.stringify(data('camphor-original')));
fs.mkdirSync(path.join(base,'dist'),{recursive:true});fs.writeFileSync(path.join(base,'dist/index.html'),html);
console.log('Built self-contained panorama: '+path.join(base,'dist/index.html'));
