const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
process.chdir(root);
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const source=[...files('pages'),...files('components'),...files('utils'),'app.js','app.json','project.config.json','sitemap.json'];
const config=JSON.parse(fs.readFileSync('app.json','utf8'));
for(const page of config.pages)for(const ext of ['js','json','wxml','wxss'])assert(fs.existsSync(page+'.'+ext),'Missing '+page+'.'+ext);
for(const file of source.filter(f=>f.endsWith('.json')))JSON.parse(fs.readFileSync(file,'utf8'));
for(const file of source.filter(f=>f.endsWith('.js')))cp.execFileSync(process.execPath,['--check',file]);
const events=/\b(?:bind(?::)?(?:tap|input|change|touchstart|touchmove|touchend|touchcancel|error|select)|catch(?:tap|touchmove))="(\w+)"/g;
for(const file of source.filter(f=>f.endsWith('.wxml'))){
 const content=fs.readFileSync(file,'utf8');const logic=fs.readFileSync(file.replace('.wxml','.js'),'utf8');
 for(const match of content.matchAll(events))assert(new RegExp('\\b'+match[1]+'\\s*\\(').test(logic),file+' missing handler '+match[1]);
 for(const m of content.matchAll(/src="(\/assets\/[^"]+)"/g))assert(fs.existsSync(m[1].slice(1)),'Missing '+m[1]);
}
const state={};const app={globalData:{panoramaUrl:'https://www.720yun.com/vr/750jezhm5k0'}};
let modalCount=0;
global.wx={cloud:{init(){},downloadFile(options){options.success({tempFilePath:'/test/image.jpg'});}},getStorageSync:k=>state[k],setStorageSync:(k,v)=>state[k]=JSON.parse(JSON.stringify(v)),showToast(){},showModal(){modalCount++;},navigateTo(){},navigateBack(){},switchTab(){},redirectTo(){},pageScrollTo(){}};
global.getApp=()=>app;
function page(name){let definition;global.Page=d=>definition=d;const file=path.resolve('pages',name,'index.js');delete require.cache[file];require(file);const obj={renderer:'webview',data:JSON.parse(JSON.stringify(definition.data)),setData(patch,callback){for(const [key,value]of Object.entries(patch)){const keys=key.split('.');let ref=this.data;for(let i=0;i<keys.length-1;i++)ref=ref[keys[i]];ref[keys[keys.length-1]]=value;}if(callback)callback();}};for(const [k,v]of Object.entries(definition))if(typeof v==='function')obj[k]=v.bind(obj);return obj;}
const store=require('../utils/store');const {products,scenes}=require('../utils/data');
const cloudAssets=require('../utils/cloud-assets.config');
for(const scene of scenes){
 assert(scene.panoramaImage,'Missing main image for '+scene.name);
 for(const image of [scene.panoramaImage,scene.postcardImage,scene.realPanorama,scene.originalPanorama].filter(Boolean)){
  if(image.startsWith('cloud://'))assert(cloudAssets.enabled&&Object.values(cloudAssets.files).includes(image),'Unconfigured cloud image '+image);
  else assert(fs.existsSync(image.slice(1)),'Missing scenic file '+image);
 }
}
assert.deepEqual(store.read().collected,[0]);assert.equal(store.unlocked(3),false);
store.collect(1);store.collect(1);assert.equal(store.read().collected.length,2);assert.equal(store.unlocked(3),true);
assert.equal(store.favorite('vegetable'),true);assert.equal(store.favorite('vegetable'),false);
store.addCart(products[0],0,1);store.addCart(products[0],0,2);store.addCart(products[0],1,1);
assert.equal(store.read().cart.length,2);assert.deepEqual(store.cartTotals(store.read().cart),{count:4,total:132});
const product=page('product');product.onLoad({id:'vegetable'});product.selectSpec({currentTarget:{dataset:{index:1}}});product.increase();assert.equal(product.data.subtotal,96);product.decrease();product.decrease();assert.equal(product.data.quantity,1);product.buyNow();assert.equal(app.globalData.checkout.items[0].price,48);
const checkout=page('checkout');checkout.onLoad({direct:'1'});assert.equal(checkout.data.total,48);checkout.setDelivery({currentTarget:{dataset:{mode:'shipping'}}});assert.equal(checkout.data.total,54);checkout.submit();assert.equal(store.read().orders.length,0);assert.equal(checkout.submitting,undefined);
checkout.setData({address:{name:'测试旅人',phone:'13800138000',street:'测试地址，仅在测试内存中'}});checkout.submit();checkout.submit();assert.equal(store.read().orders.length,1);assert.equal(store.read().orders[0].total,54);assert.equal(store.read().cart.length,2);
const cart=page('checkout');cart.onLoad({});assert.equal(cart.data.shippingFee,0);assert.equal(cart.data.total,132);cart.remove({currentTarget:{dataset:{key:'vegetable-1'}}});assert.equal(cart.data.total,84);assert.equal(store.read().cart.length,1);
const shop=page('shop');shop.onShow();shop.filter({currentTarget:{dataset:{category:'古村文创'}}});assert.equal(shop.data.products.length,products.filter(p=>p.category==='古村文创').length);assert.equal(shop.data.products[0].id,'notebook');shop.search({detail:{value:'不存在的商品'}});assert.equal(shop.data.products.length,0);
const panorama=page('panorama');panorama.onLoad({id:'2'});panorama.select(1);panorama.select(2);panorama.destroyRenderer();assert.equal(panorama.renderer,'webview');panorama.answer({currentTarget:{dataset:{index:0}}});assert(!store.read().collected.includes(2));panorama.answer({currentTarget:{dataset:{index:2}}});assert(store.read().collected.includes(2));
console.log('PASS: 10 routes, JSON, JS, template events, assets, unlock rules, favorites, cart merging, product pricing, shipping, checkout validation and collection tasks.');
const bin='/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec';
for(const [compiler,ext]of [['wcc','wxml'],['wcsc','wxss']]){
 const executable=path.join(bin,compiler);if(!fs.existsSync(executable)){console.log('SKIP: WeChat compiler is not installed: '+compiler);continue;}
 const inputs=source.filter(f=>f.endsWith('.'+ext));if(ext==='wxss')inputs.unshift('app.wxss');
 const result=cp.spawnSync(executable,['-o',path.join(os.tmpdir(),'gengdu-check-'+ext+'.js'),...inputs],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);console.log('PASS: WeChat '+compiler+' compiled '+inputs.length+' files.');
}
