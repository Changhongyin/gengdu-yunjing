const images=require('../../utils/asset-source');
const store=require('../../utils/store');const {products}=require('../../utils/data');
const guideEntry=require('../../utils/guide-entry');
Page({data:{avatarSrc:'',nickname:'寻樟旅人',count:1,favoriteCount:0,orderCount:0,sheet:'',sheetTitle:'',favoriteProducts:[],orderList:[],feedbackText:'',guideMotion:'',guideLock:''},
 onShow(){guideEntry.show(this,3);this.refresh();},onHide(){guideEntry.hide(this);},onUnload(){images.release(this);},refresh(){const s=store.read();images.setImages(this,{avatarSrc:images.asset('/assets/image_337.png'),nickname:s.nickname,count:s.collected.length,favoriteCount:s.favorites.length,orderCount:s.orders.length,favoriteProducts:products.filter(p=>s.favorites.includes(p.id)),orderList:s.orders});},
 cards(){wx.navigateTo({url:'/pages/cards/index'});},cart(){wx.navigateTo({url:'/pages/checkout/index'});},
 favorites(){this.setData({sheet:'favorites',sheetTitle:'我的商品收藏'});},orders(){this.setData({sheet:'orders',sheetTitle:'购买记录'});},feedback(){this.setData({sheet:'feedback',sheetTitle:'留一封乡信'});},closeSheet(){this.setData({sheet:''});},noop(){},
 feedbackInput(e){this.setData({feedbackText:e.detail.value});},saveFeedback(){if(!this.data.feedbackText.trim()){wx.showToast({title:'请先写下你的想法',icon:'none'});return;}const feedback=store.read().feedback.slice();feedback.unshift({text:this.data.feedbackText.trim(),date:Date.now()});store.save({feedback});this.setData({feedbackText:'',sheet:''});wx.showToast({title:'已保存在此设备',icon:'success'});},
 product(e){this.closeSheet();wx.navigateTo({url:'/pages/product/index?id='+e.currentTarget.dataset.id});},
 rename(){wx.showModal({title:'你的寻樟称呼',editable:true,placeholderText:this.data.nickname,success:r=>{if(r.confirm&&r.content&&r.content.trim()){store.save({nickname:r.content.trim().slice(0,16)});this.refresh();}}});}
});
