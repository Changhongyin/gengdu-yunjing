const KEY='gengdu-place-notes-v1';
function read(){try{const value=wx.getStorageSync(KEY);return value&&typeof value==='object'&&!Array.isArray(value)?JSON.parse(JSON.stringify(value)):{};}catch(e){return {};}}
function list(id){const rows=read()[String(id)];return Array.isArray(rows)?rows:[];}
function add(id,text,nickname){text=String(text||'').trim();if(!text||text.length>300)return {ok:false,message:'请写下 1—300 字的见闻'};const all=read(),rows=list(id);const note={id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),text,nickname:nickname||'寻樟旅人',time:Date.now()};all[String(id)]=[note,...rows].slice(0,100);try{wx.setStorageSync(KEY,all);return {ok:true,note};}catch(e){return {ok:false,message:'保存失败，请检查设备存储空间'};}}
function remove(id,noteId){const all=read();all[String(id)]=list(id).filter(x=>x.id!==noteId);try{wx.setStorageSync(KEY,all);return true;}catch(e){return false;}}
module.exports={list,add,remove};
