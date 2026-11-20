const {getPlace}=require('../../utils/places');
const pet=require('../../utils/pet-controller');
Page({
 data:{placeName:'实景影册',photos:[],current:0,zoom:1,guideMotion:'',guideLock:''},
 onLoad(options){
  const place=getPlace(options.id),requested=Number(options.index);
  const current=Number.isInteger(requested)&&requested>=0&&requested<place.gallery.length?requested:0;
  this.setData({placeName:place.name,current,zoom:1,photos:place.gallery.map((photo,index)=>({...photo,key:index+'-0',loaded:false,failed:false,scale:1}))});
  this.navTitle=place.name+' · 实景影册';wx.setNavigationBarTitle({title:this.navTitle});
  pet.enter(this,{topic:null,place:place.id});
 },
 changed(e){const current=e.detail.current;if(current===this.data.current)return;this.setData({current,zoom:1,photos:this.data.photos.map((photo,index)=>({...photo,scale:1,key:index+'-'+Date.now()}))});},
 loaded(e){this.setData({['photos['+e.currentTarget.dataset.index+'].loaded']:true,['photos['+e.currentTarget.dataset.index+'].failed']:false});},
 failed(e){this.setData({['photos['+e.currentTarget.dataset.index+'].failed']:true});},
 retry(){const index=this.data.current,photos=this.data.photos.slice();photos[index]={...photos[index],failed:false,loaded:false,key:index+'-'+Date.now()};this.setData({photos});},
 scaled(e){if(Number(e.currentTarget.dataset.index)===this.data.current)this.setData({zoom:e.detail.scale});},
 zoomIn(){this.setScale(Math.min(5,this.data.zoom+1));},zoomOut(){this.setScale(Math.max(1,this.data.zoom-1));},
 setScale(scale){const index=this.data.current;this.setData({zoom:scale,['photos['+index+'].scale']:scale});},
 reset(){this.setScale(1);const index=this.data.current;this.setData({['photos['+index+'].key']:index+'-'+Date.now()});},
 previous(){if(this.data.current>0)this.changed({detail:{current:this.data.current-1}});},
 next(){if(this.data.current<this.data.photos.length-1)this.changed({detail:{current:this.data.current+1}});}
});
