const store=require('../../utils/store');const {products,productById}=require('../../utils/data');
const {categories,searchTerms,matchesProduct}=require('../../utils/products');
const guideEntry=require('../../utils/guide-entry');
Page({
 data:{categories,searchTerms,category:'全部好物',query:'',products:[],cartCount:0,cartTotal:0,guideMotion:'',guideLock:''},
 onShow(){guideEntry.show(this,2);this.refresh();},onHide(){guideEntry.hide(this);},
 refresh(){const state=store.read();const list=products.filter(p=>(this.data.category==='全部好物'||p.category===this.data.category)&&matchesProduct(p,this.data.query)).map(p=>Object.assign({},p,{favorite:state.favorites.includes(p.id)}));const totals=store.cartTotals(state.cart);this.setData({products:list,cartCount:totals.count,cartTotal:totals.total});},
 search(e){this.setData({query:e.detail.value.trim(),category:'全部好物'});this.refresh();},clearSearch(){this.setData({query:''});this.refresh();},
 quickSearch(e){this.setData({query:e.currentTarget.dataset.query,category:'全部好物'});this.refresh();},
 filter(e){this.setData({category:e.currentTarget.dataset.category});this.refresh();},resetFilter(){this.setData({category:'全部好物',query:''});this.refresh();},
 openProduct(e){wx.navigateTo({url:'/pages/product/index?id='+e.currentTarget.dataset.id});},
 favorite(e){store.favorite(e.currentTarget.dataset.id);this.refresh();},
 addCart(e){store.addCart(productById(e.currentTarget.dataset.id),0,1);this.refresh();wx.showToast({title:'已加入购物车',icon:'success'});},
 checkout(){wx.navigateTo({url:'/pages/checkout/index'});},
 contact(){wx.showModal({title:'四本堂',content:'欢迎到古渊头村四本堂了解村民手作。当前资料未提供商家电话，后续可在项目中配置客服。',showCancel:false});}
});
