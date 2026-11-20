const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const stored={};let definition,downloads=0;
const cloud=require('../utils/cloud-assets.config');
global.wx={
 env:{USER_DATA_PATH:'/cache'},getStorageSync:key=>stored[key],setStorageSync:(key,value)=>stored[key]=value,
 showToast(){},showModal(){},navigateTo(){},redirectTo(){},switchTab(){},pageScrollTo(){},
 cloud:{init(){},downloadFile(options){downloads++;queueMicrotask(()=>options.success({tempFilePath:'/temp/'+downloads+'.jpg'}));}}
};
global.Page=value=>definition=value;global.Component=value=>definition=value;
const app={globalData:{}};global.getApp=()=>app;
function make(file,component=false){
 delete require.cache[require.resolve(file)];require(file);
 const view={data:JSON.parse(JSON.stringify(definition.data)),setData(patch,callback){
  for(const [key,value]of Object.entries(patch)){const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let ref=this.data;for(const part of parts.slice(0,-1))ref=ref[part];ref[parts.at(-1)]=value;}
  if(callback)callback();
 }};
 for(const [key,value]of Object.entries(component?definition.methods:definition))if(typeof value==='function')view[key]=value.bind(view);
 return view;
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function assertImage(value){assert(value,'Empty image source');assert(!value.startsWith('cloud://'),'Cloud ID leaked to image src: '+value);}
(async()=>{
 const scenes=require('../utils/data').scenes;
 const cards=make('../pages/cards/index.js');await cards.onShow();cards.data.scenes.forEach(scene=>assertImage(scene.panoramaImage));
 const postcard=make('../pages/postcard/index.js');postcard.onLoad({id:'0'});await flush();assertImage(postcard.data.scene.postcardImage);
 const pano=make('../pages/panorama/index.js');pano.onLoad({id:'0'});await flush();assertImage(pano.data.scene.panoramaImage);assert.equal(pano.data.scene.realPanorama,scenes[0].realPanorama);
 pano.select(1);pano.select(2);await flush();assert.equal(pano.data.scene.id,2);assertImage(pano.data.scene.panoramaImage);pano.select(NaN);assert.equal(pano.data.scene.id,2);
 // Exercise the built-in panorama loading route, version toggle and gesture handlers.
 const loads=[];wx.getImageInfo=options=>options.success({width:1774,height:887});
 pano.loadPhoto=(file,info,origin)=>{loads.push({file,origin});pano.setData({localPhoto:true,photoOrigin:origin,panoramaReady:true});};
 pano.select(0);pano.onReady();await flush();assert.equal(loads.at(-1).file,scenes[0].originalPanorama);assert.equal(loads.at(-1).origin,'original');
 pano.togglePhotoVersion();await flush();assert.equal(loads.at(-1).file,scenes[0].realPanorama);
 let rotated,zoomed,reset=0,destroyed=0;
 pano.panoramaRenderer={yaw:0,rotate(x,y){rotated=[x,y];},zoom(ratio){zoomed=ratio;},reset(){reset++;},draw(){},destroy(){destroyed++;}};
 pano.touchStart({touches:[{clientX:10,clientY:20}]});pano.touchMove({touches:[{clientX:35,clientY:28}]});assert.deepEqual(rotated,[25,8]);
 pano.touchStart({touches:[{clientX:0,clientY:0},{clientX:100,clientY:0}]});pano.touchMove({touches:[{clientX:0,clientY:0},{clientX:200,clientY:0}]});assert.equal(zoomed,.5);
 pano.zoomOut();assert.equal(zoomed,1.18);pano.zoomIn();assert.equal(zoomed,.85);pano.resetView();assert.equal(reset,1);
 pano.toggleTour();assert.equal(pano.data.autoTour,true);pano.onHide();assert.equal(pano.data.autoTour,false);assert.equal(pano.tourTimer,null);
 pano.select(1);await flush();assert.equal(destroyed,1);assert.equal(pano.data.localPhoto,false);pano.select(0);await flush();assert.equal(loads.at(-1).file,scenes[0].originalPanorama);pano.onUnload();
 const assets=require('../utils/asset-source');
 const profile=make('../pages/profile/index.js');profile.onShow();await flush();assert.equal(profile.data.avatarSrc,assets.asset('/assets/image_337.png'));
 const art=make('../components/scene-art/index.js',true);await art.loadImages();assert.equal(art.data.assetImages.image15,assets.asset('/assets/image_15.png'));assert.equal(art.data.assetImages.image30,assets.asset('/assets/image_30.png'));
 // Cached tabs refresh their data when revisited, including after a product action.
 const shop=make('../pages/shop/index.js');shop.onShow();assert.equal(shop.data.products.length,require('../utils/data').products.length);
 shop.favorite({currentTarget:{dataset:{id:'vegetable'}}});profile.onShow();assert.equal(profile.data.favoriteCount,1);
 shop.onShow();assert.equal(shop.data.products.find(p=>p.id==='vegetable').favorite,true);
 shop.favorite({currentTarget:{dataset:{id:'vegetable'}}});profile.onShow();assert.equal(profile.data.favoriteCount,0);
 // Immediate checkout edits must not replace an unrelated persisted cart.
 const store=require('../utils/store');const {products}=require('../utils/data');store.addCart(products[0],0,2);const cart=JSON.stringify(store.read().cart);
 app.globalData.checkout={items:[{key:'direct',quantity:1,price:36}],delivery:'pickup',address:{}};
 const checkout=make('../pages/checkout/index.js');checkout.onLoad({direct:'1'});checkout.remove({currentTarget:{dataset:{key:'direct'}}});assert.equal(JSON.stringify(store.read().cart),cart);
 app.globalData.checkout=null;const expired=make('../pages/checkout/index.js');expired.onLoad({direct:'1'});assert.equal(expired.data.direct,false);
 // Validate every offline preview and local fallback against the actual upload package.
 const report=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../output/upload-audit.json')));
 for(const fallback of Object.values(require('../utils/asset-fallbacks')))assert(report.retainedFiles.includes((require('../utils/asset-runtime')[fallback]||fallback).slice(1)),'Fallback excluded from package: '+fallback);
 if(cloud.enabled)assert(downloads>0);else {assert.equal(downloads,0);assert(scenes[0].realPanorama.startsWith('/assets/'));assert(report.retainedFiles.includes(scenes[0].realPanorama.slice(1)));}
 console.log('PASS: page images, built-in panorama loading, version switching, drag/pinch/buttons, tour cleanup, scene re-entry, checkout isolation and packaged fallbacks.');
})().catch(error=>{console.error(error);process.exitCode=1;});
