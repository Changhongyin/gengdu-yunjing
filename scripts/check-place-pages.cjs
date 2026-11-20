const assert=require('node:assert/strict'),fs=require('fs'),crypto=require('crypto');
const {places,village}=require('../utils/places'),{scenes}=require('../utils/data');
const upload=JSON.parse(fs.readFileSync('output/upload-audit.json'));
const manifest=JSON.parse(fs.readFileSync('docs/实景照片来源.json'));
for (const row of manifest) {
  const bytes = fs.readFileSync(row.target);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.sha256, row.target + ' differs from the recorded original');
  if (fs.existsSync(row.source)) {
    assert(bytes.equals(fs.readFileSync(row.source)), row.target + ' differs from original');
  }
  assert(upload.retainedFiles.includes(row.target), 'Excluded photo ' + row.target);
}
for(const place of [...places,village]){assert.equal(place.gallery.length,3);assert(place.sections.length>=2);for(const image of place.gallery){assert(fs.existsSync(image.src.slice(1)));assert(upload.retainedFiles.includes(image.src.slice(1)));}if(place.id!=='village'){assert.equal(scenes[place.id].postcardImage,place.gallery[0].src);assert.equal(scenes[place.id].panoramaImage,place.gallery[0].src);}}
let definition,route,preview,storage={};global.wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>{storage[k]=JSON.parse(JSON.stringify(v));},navigateTo:o=>route=o.url,setNavigationBarTitle(){},showToast(){},showModal:o=>o.success&&o.success({confirm:true}),previewImage:o=>preview=o,pageScrollTo(){}};global.Page=p=>definition=p;
const make=file=>{delete require.cache[require.resolve(file)];require(file);const p={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(v){Object.assign(this.data,v);}};return p;};
const p=make('../pages/place/index');
for(const id of ['village',0,1,2,3]){p.onLoad({id});assert.equal(p.data.place.id,id);p.navigate();assert.equal(route,'/pages/visit/index?id='+id);p.slideChange({detail:{current:2}});p.preview({currentTarget:{dataset:{index:2}}});assert.equal(route,'/pages/gallery/index?id='+id+'&index=2');p.onHide();assert.equal(p.data.playing,false);p.onShow();assert.equal(p.data.playing,true);}
p.onLoad({id:1});p.compose();p.editNote({detail:{value:'  渠水经过石块，流向古村的日常。  '}});p.saveNote();assert.equal(p.data.notes.length,1);assert.equal(p.data.notes[0].text,'渠水经过石块，流向古村的日常。');
p.onLoad({id:2});assert.equal(p.data.notes.length,0);p.onLoad({id:1});assert.equal(p.data.notes.length,1);p.deleteNote({currentTarget:{dataset:{id:p.data.notes[0].id}}});assert.equal(p.data.notes.length,0);
const notes=require('../utils/visit-notes');assert.equal(notes.add(0,'  ').ok,false);assert.equal(notes.add(0,'a'.repeat(301)).ok,false);wx.setStorageSync=()=>{throw Error('full');};assert.equal(notes.add(0,'失败测试').ok,false);assert.equal(notes.list(0).length,0);
const v=make('../pages/village/index');for(const id of [0,1,2,3]){v.introduce({currentTarget:{dataset:{id}}});assert.equal(route,'/pages/place/index?id='+id);}v.village();assert.equal(route,'/pages/place/index?id=village');
const pano=make('../pages/panorama/index');pano.data.scene=scenes[2];pano.introduce();assert.equal(route,'/pages/place/index?id=2');
const visit=make('../pages/visit/index');visit.onLoad({id:3});assert.equal(visit.data.selected,3);visit.open();assert.equal(route,'/pages/place/index?id=3');
console.log('PASS: 5 independent detail views, 15 carousel slides, full-resolution photo provenance, package inclusion, postcard consistency, every intro route, local note isolation/persistence/deletion/validation/storage failure, and virtual route links.');

const gallery=make('../pages/gallery/index');for(const id of ['village',0,1,2,3]){for(const index of [0,1,2]){gallery.onLoad({id,index});assert.equal(gallery.data.current,index);assert.equal(gallery.data.photos[index].src,(id==='village'?village:places[id]).gallery[index].src);}}gallery.onLoad({id:3,index:99});assert.equal(gallery.data.current,0);gallery.next();assert.equal(gallery.data.current,1);gallery.previous();assert.equal(gallery.data.current,0);gallery.previous();assert.equal(gallery.data.current,0);gallery.onLoad({id:1,index:0});gallery.scaled({currentTarget:{dataset:{index:0}},detail:{scale:2}});assert.equal(gallery.data.zoom,2);gallery.reset();assert.equal(gallery.data.zoom,1);console.log('PASS: all 15 full-photo entry positions, invalid index fallback, next/previous boundaries and zoom/reset state.');

v.preview({currentTarget:{dataset:{index:1}}});assert.equal(route,'/pages/gallery/index?id=village&index=1');for(const file of ['pages/place/index.js','pages/village/index.js'])assert(!fs.readFileSync(file,'utf8').includes('wx.previewImage('),'Unsafe package-photo native preview reintroduced');
