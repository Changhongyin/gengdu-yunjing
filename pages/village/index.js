const {scenes}=require('../../utils/data');
const {village}=require('../../utils/places');
const store=require('../../utils/store');
const guideEntry=require('../../utils/guide-entry');
const pet=require('../../utils/pet-controller');
Page({
 data:{scenes,gallery:village.gallery,slide:0,playing:true,guideMotion:'',guideLock:''},
 onLoad(){pet.enter(this,{topic:'village',place:'village'});},
 onShow(){guideEntry.show(this,1);this.setData({playing:true});},onHide(){guideEntry.hide(this);this.setData({playing:false});},
 slideChange(e){this.setData({slide:e.detail.current});},
 preview(e){wx.navigateTo({url:'/pages/gallery/index?id=village&index='+(Number(e.currentTarget.dataset.index)||0)});},
 village(){wx.navigateTo({url:'/pages/place/index?id=village'});},
 introduce(e){wx.navigateTo({url:'/pages/place/index?id='+e.currentTarget.dataset.id});},
 explore(e){const id=Number(e.currentTarget.dataset.id);if(!store.unlocked(id)){wx.showToast({title:'先完成至少 2 个普通关卡',icon:'none'});return;}wx.navigateTo({url:'/pages/panorama/index?id='+id});}
});
