const KEY = 'gengdu-yunjing-v1';
const defaults = () => ({collected:[0], favorites:[], cart:[], orders:[], nickname:'寻樟旅人', feedback:[]});
let memory;
function read() {
  if (memory) return memory;
  try { memory = Object.assign(defaults(), wx.getStorageSync(KEY) || {}); }
  catch (e) { memory = defaults(); }
  return memory;
}
function save(patch) {
  memory = Object.assign({}, read(), patch);
  try { wx.setStorageSync(KEY, memory); } catch (e) { wx.showToast({title:'储存空间不足，当前进度仅本次有效',icon:'none'}); }
  return memory;
}
function collect(id) { const collected = read().collected.slice(); if (!collected.includes(id)) collected.push(id); save({collected}); }
function unlocked(id) { return id !== 3 || read().collected.filter(i => i < 3).length >= 2; }
function favorite(id) { const favorites=read().favorites.slice(); const i=favorites.indexOf(id); if(i<0) favorites.push(id); else favorites.splice(i,1); save({favorites}); return i<0; }
function addCart(product, specIndex, quantity) {
  const cart = read().cart.map(x => Object.assign({}, x));
  const key = product.id + '-' + specIndex;
  const item = cart.find(x => x.key === key);
  if (item) item.quantity += quantity;
  else cart.push({key, productId:product.id, name:product.shortName, art:product.art, image:product.cover, spec:product.specs[specIndex].name, price:product.specs[specIndex].price, specIndex, quantity});
  save({cart});
}
function cartTotals(items) { return {count:items.reduce((n,x)=>n+x.quantity,0), total:items.reduce((n,x)=>n+x.price*x.quantity,0)}; }
module.exports = {initialize:read, read, save, collect, unlocked, favorite, addCart, cartTotals};
