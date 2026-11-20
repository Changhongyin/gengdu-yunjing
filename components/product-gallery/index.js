// Native swiper owns timing and gestures. A single photo stays still.
Component({
 properties:{images:{type:Array,value:[],observer:'reset'},label:{type:String,value:'商品图片'},preview:{type:Boolean,value:false}},
 data:{current:0,active:true},
 pageLifetimes:{show(){this.setData({active:true});},hide(){this.setData({active:false});}},
 methods:{
  reset(){if(this.data.current)this.setData({current:0});},
  change(e){this.setData({current:e.detail.current});},
  imageTap(e){const current=this.data.images[Number(e.currentTarget.dataset.index)||0];if(this.data.preview&&current){wx.previewImage({current,urls:this.data.images});}else this.triggerEvent('select');}
 }
});
