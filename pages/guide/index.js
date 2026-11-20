const store=require('../../utils/store');
const guideEntry=require('../../utils/guide-entry');
const pet=require('../../utils/pet-controller');
Page({
  data:{marks:[true,false,false,false],count:1,finalUnlocked:false,guideMotion:'',guideLock:''},
  onLoad(){pet.enter(this,{topic:'greet',place:'village'});},
  onShow(){guideEntry.show(this,0);const c=store.read().collected;this.setData({marks:[0,1,2,3].map(i=>c.includes(i)),count:c.length,finalUnlocked:store.unlocked(3)});},
  onHide(){guideEntry.hide(this);},
  selectScene(e){const id=e.detail.id;if(!store.unlocked(id)){wx.showToast({title:'先完成至少 2 个普通关卡',icon:'none'});return;}wx.navigateTo({url:'/pages/panorama/index?id='+id});},
  openCards(){wx.navigateTo({url:'/pages/cards/index'});},
  openPanorama(){wx.navigateTo({url:'/pages/panorama/index?id=0'});},
  onShareAppMessage(){return{title:'循一缕樟香，拾一村书声',path:'/pages/guide/index'};}
});
