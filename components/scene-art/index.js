const images=require('../../utils/asset-source');
const {scenes}=require('../../utils/data');
const dimensions = {villageHero:[327,189],map:[335,420],scene0:[144,109],scene1:[144,109],scene2:[144,109],scene3:[144,109],vegetable:[327,192],notebook:[327,96]};
Component({
  properties: {
    kind: {type:String,value:'map',observer:'resizeArt'},
    collected: {type:Array,value:[true,false,false,false]},
    finalUnlocked: {type:Boolean,value:false}
  },
  data: {scenePhotos:scenes.map(s=>s.panoramaImage),assetImages:{image15:'',image30:''},scale:1,naturalWidth:335,naturalHeight:420,boxHeight:420},
  lifetimes: {attached() {this.loadImages();},ready() {this.resizeArt();},detached() {images.release(this);}},
  pageLifetimes: {show() {this.loadImages();},resize() {this.resizeArt();}},
  methods: {
    loadImages() {return images.setImages(this,{assetImages:{image15:images.asset('/assets/image_15.png'),image30:images.asset('/assets/image_30.png')}});},
    resizeArt() {
      const size=dimensions[this.data.kind] || dimensions.map;
      this.setData({naturalWidth:size[0],naturalHeight:size[1]});
      this.createSelectorQuery().select('.art-fit').boundingClientRect(rect=>{
        if(rect && rect.width) this.setData({scale:rect.width/size[0],boxHeight:rect.width*size[1]/size[0]});
      }).exec();
    },
    pick(e) {this.triggerEvent('select',{id:Number(e.currentTarget.dataset.id)});}
  }
});
