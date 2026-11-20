const {getPlace,places}=require('../../utils/places');
const notes=require('../../utils/visit-notes');
const store=require('../../utils/store');
const pet=require('../../utils/pet-controller');
const format=time=>{const d=new Date(time);return d.getFullYear()+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+String(d.getDate()).padStart(2,'0');};
Page({
 data:{place:getPlace('village'),isVillage:true,slide:0,playing:true,notes:[],draft:'',showComposer:false,submitting:false,sceneLinks:[],failedImages:{},guideMotion:'',guideLock:''},
 onLoad(options){const place=getPlace(options.id);this.setData({place,isVillage:place.id==='village',sceneLinks:places.map(p=>({id:p.id,name:p.name,image:p.gallery[0].src})),slide:0});this.navTitle=place.name+' · '+(place.id==='village'?'村落档案':'景点介绍');wx.setNavigationBarTitle({title:this.navTitle});this.refreshNotes();pet.enter(this,{topic:place.id,place:place.id});},
 onShow(){this.setData({playing:!this.data.showComposer});this.refreshNotes();},
 onHide(){this.setData({playing:false});},
 refreshNotes(){this.setData({notes:notes.list(this.data.place.id).map(x=>Object.assign({},x,{date:format(x.time)}))});},
 slideChange(e){this.setData({slide:e.detail.current});},
 togglePlay(){this.setData({playing:!this.data.playing});},
 preview(e){const index=Number(e.currentTarget.dataset.index)||0;wx.navigateTo({url:'/pages/gallery/index?id='+this.data.place.id+'&index='+index});},
 imageError(e){this.setData({['failedImages.'+e.currentTarget.dataset.index]:true});},
 retryPhoto(){this.setData({failedImages:{}});},
 openScene(e){wx.navigateTo({url:'/pages/place/index?id='+e.currentTarget.dataset.id});},
 navigate(){wx.navigateTo({url:'/pages/visit/index?id='+this.data.place.id});},
 explore(){const id=Number(this.data.place.id);if(!store.unlocked(id)){wx.showToast({title:'先完成至少 2 个普通关卡',icon:'none'});return;}wx.navigateTo({url:'/pages/panorama/index?id='+id});},
 compose(){this.setData({showComposer:true,playing:false});},closeComposer(){this.setData({showComposer:false,playing:true});},noop(){},
 editNote(e){this.setData({draft:e.detail.value});},
 saveNote(){if(this.data.submitting)return;this.setData({submitting:true});const result=notes.add(this.data.place.id,this.data.draft,store.read().nickname);if(result.ok){this.setData({draft:'',showComposer:false,playing:true});this.refreshNotes();wx.showToast({title:'这一程，已记下',icon:'success'});}else wx.showToast({title:result.message,icon:'none'});this.setData({submitting:false});},
 deleteNote(e){const id=e.currentTarget.dataset.id;wx.showModal({title:'删除这条游记？',content:'仅删除当前设备保存的这条留言。',success:r=>{if(r.confirm){if(notes.remove(this.data.place.id,id))this.refreshNotes();else wx.showToast({title:'删除失败，请重试',icon:'none'});}}});},
 goStory(){wx.pageScrollTo({selector:'#story-0',duration:350});},
 goThird(){if(this.data.isVillage)this.navigate();else this.goNotes();},
 goNotes(){wx.pageScrollTo({selector:'#notes',duration:350});},
 onShareAppMessage(){return {title:this.data.place.name+' · 在樟影与书声之间',path:'/pages/place/index?id='+this.data.place.id};}
});
