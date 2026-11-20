const store=require('../../utils/store');const {productById}=require('../../utils/data');
Page({
 data:{product:productById('vegetable'),specIndex:0,quantity:1,unitPrice:28,subtotal:28,favorite:false,delivery:'pickup',slots:['明日 10:00—12:00','明日 14:00—17:00','后日 10:00—12:00','后日 14:00—17:00'],slotIndex:0,address:{name:'',phone:'',street:''}},
 onLoad(options){const p=productById(options.id);this.setData({product:p,unitPrice:p.price,subtotal:p.price,favorite:store.read().favorites.includes(p.id)});},
 recalculate(){const price=this.data.product.specs[this.data.specIndex].price;this.setData({unitPrice:price,subtotal:price*this.data.quantity});},
 selectSpec(e){this.setData({specIndex:Number(e.currentTarget.dataset.index)});this.recalculate();},increase(){if(this.data.quantity<99){this.setData({quantity:this.data.quantity+1});this.recalculate();}},decrease(){if(this.data.quantity>1){this.setData({quantity:this.data.quantity-1});this.recalculate();}},
 setDelivery(e){this.setData({delivery:e.currentTarget.dataset.mode});},setSlot(e){this.setData({slotIndex:Number(e.detail.value)});},addressInput(e){this.setData({['address.'+e.currentTarget.dataset.field]:e.detail.value});},
 toggleFavorite(){this.setData({favorite:store.favorite(this.data.product.id)});},
 addCart(){store.addCart(this.data.product,this.data.specIndex,this.data.quantity);wx.showToast({title:'已加入购物车',icon:'success'});},
 buyNow(){const p=this.data.product,s=p.specs[this.data.specIndex];getApp().globalData.checkout={items:[{key:p.id+'-'+this.data.specIndex,productId:p.id,name:p.shortName,art:p.art,image:p.cover,spec:s.name,price:s.price,quantity:this.data.quantity}],delivery:this.data.delivery,slot:this.data.slots[this.data.slotIndex],address:this.data.address};wx.navigateTo({url:'/pages/checkout/index?direct=1'});},
 back(){wx.navigateBack({fail:()=>wx.switchTab({url:'/pages/shop/index'})});}
});
