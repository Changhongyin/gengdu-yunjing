// Regression: source coverage, discovery, all-SKU cart/detail/checkout compatibility.
const fs=require('node:fs'),assert=require('node:assert/strict');
process.chdir(require('node:path').resolve(__dirname,'..'));
const {products,categories,searchTerms,matchesProduct}=require('../utils/products');
const manifest=require('../docs/product-photo-sources.json');
assert.equal(products.length,18);assert.equal(new Set(products.map(p=>p.id)).size,products.length);
const referenced=new Set(products.flatMap(p=>p.images));
assert.equal(referenced.size,22);assert.deepEqual([...referenced].sort(),manifest.images.map(i=>i.target).sort());
for(const p of products){
 assert(categories.includes(p.category));assert(p.desc&&p.detail&&p.tag);assert(p.specs.length);
 assert.equal(p.cover,p.images[0]);assert.equal(p.price,p.specs[0].price);
 for(const image of p.images){const b=fs.readFileSync(image.slice(1));assert.equal(b[0],255);assert.equal(b[1],216);assert(b.length>1000);}
 for(const s of p.specs)assert(Number.isFinite(s.price)&&s.price>0);
 assert(matchesProduct(p,p.shortName),p.id+' must be found by its name');
}
for(const term of searchTerms)assert(products.some(p=>matchesProduct(p,term)),'Empty search term: '+term);
assert.deepEqual(products.filter(p=>matchesProduct(p,'木雕 胸针')).map(p=>p.id),['wood-pin']);
assert.deepEqual(products.filter(p=>matchesProduct(p,'梅菜')).map(p=>p.id),['vegetable']);
assert.equal(products.filter(p=>matchesProduct(p,'  帆布袋  ')).length,2);
assert(products.filter(p=>matchesProduct(p,'古村文旅')).length>0);
assert.deepEqual(products.filter(p=>p.category==='手作礼盒').map(p=>p.id),['wood-gift','gift-pack']);
assert.equal(products.find(p=>p.id==='vegetable').images.length,3);
let definition,storage={},pending={globalData:{}},preview;
global.wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>{storage[k]=v;},showToast(){},showModal(){},navigateTo(){},navigateBack(){},switchTab(){},previewImage:o=>{preview=o;}};
global.getApp=()=>pending;global.Page=d=>{definition=d;};global.Component=d=>{definition=d;};
function page(file){delete require.cache[require.resolve(file)];require(file);const d=definition;return Object.assign({},d,{data:JSON.parse(JSON.stringify(d.data)),setData(patch){Object.assign(this.data,patch);}});}
const store=require('../utils/store');
const shop=page('../pages/shop/index.js');shop.onShow();assert.equal(shop.data.products.length,18);
for(const category of categories){shop.filter({currentTarget:{dataset:{category}}});assert.equal(shop.data.products.length,category==='全部好物'?18:products.filter(p=>p.category===category).length);}
shop.quickSearch({currentTarget:{dataset:{query:'木质书签'}}});assert(shop.data.products.some(p=>p.id==='wood-bookmark'));assert.equal(shop.data.category,'全部好物');
shop.search({detail:{value:'不存在的商品'}});assert.equal(shop.data.products.length,0);shop.clearSearch();assert.equal(shop.data.products.length,18);
for(const product of products){
 const detail=page('../pages/product/index.js');detail.onLoad({id:product.id});assert.equal(detail.data.product.id,product.id);detail.increase();assert.equal(detail.data.subtotal,product.price*2);
 detail.toggleFavorite();assert(store.read().favorites.includes(product.id));detail.addCart();detail.buyNow();
 assert.equal(pending.globalData.checkout.items[0].productId,product.id);assert.equal(pending.globalData.checkout.items[0].image,product.cover);
 assert.equal(pending.globalData.checkout.items[0].price,product.price);
}
assert.equal(store.read().cart.length,18);assert.equal(store.cartTotals(store.read().cart).count,36);
assert.equal(store.cartTotals(store.read().cart).total,products.reduce((n,p)=>n+p.price*2,0));
shop.setData({category:'全部好物',query:''});shop.refresh();assert(shop.data.products.every(p=>p.favorite));
// A cart saved before this change still acquires the correct real thumbnail.
const legacy=store.read().cart.map(p=>{const next={...p};delete next.image;return next;});store.save({cart:legacy});pending.globalData.checkout=null;
const checkout=page('../pages/checkout/index.js');checkout.onLoad({});assert(checkout.data.items.every(i=>i.image===products.find(p=>p.id===i.productId).cover));
checkout.remove({currentTarget:{dataset:{key:'wood-seal-0'}}});assert.equal(checkout.data.items.length,17);
// Gallery changes the current frame, opens the matching original and pauses off-page.
require('../components/product-gallery/index.js');const galleryDef=definition;const events=[];
const gallery={...galleryDef.methods,data:{images:products[0].images,current:0,preview:true,active:true},setData(p){Object.assign(this.data,p);},triggerEvent:n=>events.push(n)};
gallery.change({detail:{current:2}});assert.equal(gallery.data.current,2);
gallery.imageTap({currentTarget:{dataset:{index:2}}});assert.equal(preview.current,products[0].images[2]);assert.deepEqual(preview.urls,products[0].images);
galleryDef.pageLifetimes.hide.call(gallery);assert.equal(gallery.data.active,false);galleryDef.pageLifetimes.show.call(gallery);assert.equal(gallery.data.active,true);
gallery.data.preview=false;gallery.imageTap({currentTarget:{dataset:{index:0}}});assert.deepEqual(events,['select']);gallery.reset();assert.equal(gallery.data.current,0);
console.log('PASS: 22 supplied photos, 18 product entries, category/keyword discovery, all-product favorites and cart/detail flows, old-cart thumbnails and gallery state/preview.');
