const {scenes}=require('../../utils/data');
const store=require('../../utils/store');
const {PanoramaRenderer}=require('../../utils/panorama-renderer');
const assetSource=require('../../utils/asset-source');
const pet=require('../../utils/pet-controller');
Page({
 data:{scene:Object.assign({},scenes[0],{panoramaImage:'',postcardImage:''}),scenes:[],collected:true,count:1,finalUnlocked:false,showTask:false,localPhoto:false,qualityText:'',photoOrigin:'',panoramaReady:false,panoramaFailed:false,autoTour:false,guideMotion:'',guideLock:''},
 onLoad(options){let id=Number(options.id)||0;if(!scenes[id]||!store.unlocked(id))id=0;assetSource.setImages(this,{scene:scenes[id]});this.refresh();pet.enter(this,{topic:id,place:id});},
 onReady(){this.pageReady=true;this.loadBuiltIn();},
 onShow(){this.refresh();},
 onHide(){this.stopTour();},
 onUnload(){assetSource.release(this);this.pageReady=false;this.photoRequest=(this.photoRequest||0)+1;this.destroyRenderer();},
 onResize(){if(!this.panoramaRenderer)return;this.createSelectorQuery().select('#panorama').fields({size:true}).exec(r=>{if(this.panoramaRenderer&&r[0])this.panoramaRenderer.resize(r[0].width,r[0].height);});},
 refresh(){const c=store.read().collected;assetSource.setImages(this,{scene:scenes[this.data.scene.id],count:c.length,collected:c.includes(this.data.scene.id),finalUnlocked:store.unlocked(3),scenes:scenes.map(s=>({id:s.id,name:s.name,collected:c.includes(s.id),locked:!store.unlocked(s.id)}))});},
 stopTour(){if(this.tourTimer){clearInterval(this.tourTimer);this.tourTimer=null;}if(this.data.autoTour)this.setData({autoTour:false});},
 destroyRenderer(){this.stopTour();if(this.panoramaRenderer){this.panoramaRenderer.destroy();this.panoramaRenderer=null;}this.loadGeneration=(this.loadGeneration||0)+1;this.touch=null;},
 select(id){if(!Number.isInteger(id)||!scenes[id])return;if(!store.unlocked(id)){wx.showToast({title:'先完成至少 2 个普通关卡',icon:'none'});return;}this.photoRequest=(this.photoRequest||0)+1;this.destroyRenderer();assetSource.setImages(this,{scene:scenes[id],localPhoto:false,qualityText:'',photoOrigin:'',panoramaReady:false,panoramaFailed:false,showTask:false},()=>{if(this.pageReady)this.loadBuiltIn();});this.refresh();pet.enter(this,{topic:id,place:id});wx.pageScrollTo({scrollTop:0,duration:200});},
 loadBuiltIn(){const scene=this.data.scene;if(scene.originalPanorama)this.readPhoto(scene.originalPanorama,'original');else if(scene.realPanorama)this.readPhoto(scene.realPanorama,'enhanced');},
 readPhoto(path,origin){const request=(this.photoRequest||0)+1;this.photoRequest=request;assetSource.resolve(path).then(localPath=>{if(request!==this.photoRequest||!this.pageReady)return;wx.getImageInfo({src:localPath,success:info=>{if(request===this.photoRequest&&this.pageReady)this.loadPhoto(localPath,info,origin);},fail:error=>{console.error('[panorama-image]',path,error);if(request===this.photoRequest)this.photoError('照片暂时无法读取，请重试。',origin);assetSource.invalidate(path);}});}).catch(error=>{console.error('[panorama-image]',path,error);if(request===this.photoRequest)this.photoError('照片暂时无法读取，请重试。',origin);});},
 switchScene(e){this.select(Number(e.currentTarget.dataset.id));},previous(){this.select(this.data.scene.id-1);},next(){this.select(this.data.scene.id+1);},
 map(){wx.switchTab({url:'/pages/guide/index'});},cards(){wx.navigateTo({url:'/pages/cards/index'});},introduce(){this.stopTour();wx.navigateTo({url:'/pages/place/index?id='+this.data.scene.id});},
 task(){if(this.data.collected){wx.navigateTo({url:'/pages/postcard/index?id='+this.data.scene.id});return;}this.setData({showTask:true});},closeTask(){this.setData({showTask:false});},noop(){},
 answer(e){if(Number(e.currentTarget.dataset.index)!==this.data.scene.answer){wx.showToast({title:'再读读故事，试试看',icon:'none'});return;}store.collect(this.data.scene.id);pet.celebrate('collect');this.setData({showTask:false});this.refresh();wx.showToast({title:'拾得一枚樟影',icon:'success'});wx.navigateTo({url:'/pages/postcard/index?id='+this.data.scene.id});},
 openReal(){wx.showActionSheet({itemList:['在小程序内打开720云实景','复制链接到浏览器打开'],success:r=>{if(r.tapIndex===0)wx.navigateTo({url:'/pages/webview/index'});else wx.setClipboardData({data:getApp().globalData.panoramaUrl});}});},
 importPhoto(){wx.chooseImage({count:1,sizeType:['original'],sourceType:['album'],success:r=>{const path=r.tempFilePaths[0];const request=(this.photoRequest||0)+1;this.photoRequest=request;wx.getImageInfo({src:path,success:info=>{if(request!==this.photoRequest||!this.pageReady)return;const ratio=info.width/info.height;if(ratio<1.8||ratio>2.2){wx.showModal({title:'请选择球形全景原图',content:'需要宽高比约为 2:1 的等距柱状全景照片。',showCancel:false});return;}this.loadPhoto(path,info,'imported');},fail:()=>wx.showToast({title:'无法读取这张图片',icon:'none'})});}});},
 loadPhoto(path,info,origin='imported'){
  this.destroyRenderer();const generation=this.loadGeneration;
  this.setData({localPhoto:true,photoOrigin:origin,panoramaReady:false,panoramaFailed:false,qualityText:'正在展开全景…'},()=>{
   this.createSelectorQuery().select('#panorama').fields({node:true,size:true}).exec(result=>{
    if(generation!==this.loadGeneration||!this.pageReady)return;
    const rect=result&&result[0];if(!rect||!rect.node){this.photoError('当前基础库不支持 WebGL 全景',origin);return;}
    try{
     this.panoramaRenderer=new PanoramaRenderer(rect.node,rect.width,rect.height,{yaw:origin==='imported'?0:.48});
     this.panoramaRenderer.load(path,info).then(()=>{
      if(generation!==this.loadGeneration)return;
      this.setData({panoramaReady:true,qualityText:(origin==='enhanced'?'AI 增强实景':origin==='original'?'原始实景':'已导入全景')+' · '+info.width+' × '+info.height});
     }).catch(err=>{if(generation===this.loadGeneration)this.photoError(err.message,origin);});
    }catch(err){this.photoError(err.message,origin);}
   });
  });
 },
 photoError(message,origin){this.destroyRenderer();this.setData({localPhoto:false,panoramaReady:false,photoOrigin:'',qualityText:'',panoramaFailed:true});if(origin==='imported')wx.showModal({title:'全景未能载入',content:message,showCancel:false});else wx.showToast({title:'实景暂未加载，可点击重试',icon:'none'});},
 retryPanorama(){this.loadBuiltIn();},
 retryImages(){return assetSource.setImages(this,{scene:scenes[this.data.scene.id]});},
 toggleSceneView(){if(!this.data.localPhoto){this.loadBuiltIn();return;}this.photoRequest=(this.photoRequest||0)+1;this.destroyRenderer();this.setData({localPhoto:false,panoramaReady:false,photoOrigin:'',qualityText:''});},
 togglePhotoVersion(){if(!this.data.scene.originalPanorama)return;const original=this.data.photoOrigin!=='original';this.readPhoto(original?this.data.scene.originalPanorama:this.data.scene.realPanorama,original?'original':'enhanced');},
 touchStart(e){this.stopTour();this.touch=e.touches.map(t=>({x:t.clientX,y:t.clientY}));},
 touchMove(e){if(!this.panoramaRenderer||!this.touch)return;const now=e.touches.map(t=>({x:t.clientX,y:t.clientY}));if(now.length===1&&this.touch.length===1)this.panoramaRenderer.rotate(now[0].x-this.touch[0].x,now[0].y-this.touch[0].y);else if(now.length===2&&this.touch.length===2){const distance=p=>Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);const before=distance(this.touch),after=distance(now);if(before&&after)this.panoramaRenderer.zoom(before/after);}this.touch=now;},
 touchEnd(e){this.touch=e&&e.touches?e.touches.map(t=>({x:t.clientX,y:t.clientY})):null;},
 resetView(){this.stopTour();if(this.panoramaRenderer)this.panoramaRenderer.reset();},
 zoomIn(){if(this.panoramaRenderer)this.panoramaRenderer.zoom(.85);},zoomOut(){if(this.panoramaRenderer)this.panoramaRenderer.zoom(1.18);},
 toggleTour(){if(this.data.autoTour){this.stopTour();return;}if(!this.panoramaRenderer||!this.data.panoramaReady)return;this.setData({autoTour:true});this.tourTimer=setInterval(()=>{if(this.panoramaRenderer){this.panoramaRenderer.yaw+=.004;this.panoramaRenderer.draw();}},50);}
});
