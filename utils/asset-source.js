const config=require('./cloud-assets.config');
const fallbacks=require('./asset-fallbacks');
const runtime=require('./asset-runtime');
const inFlight=new Map(),resolved=new Map(),bindings=new WeakMap();let initialized=false;
const diagnostics={};
function record(source,error){
 diagnostics[source]={ok:!error,code:error&&(error.errCode||error.code)||'',message:error&&(error.errMsg||error.message)||'',time:Date.now()};
 try{wx.getFileSystemManager().writeFileSync(wx.env.USER_DATA_PATH+'/gengdu-image-status.json',JSON.stringify(diagnostics),'utf8');}catch(ignored){}
}
function init(){
 if(!config.enabled)return false;
 if(initialized)return true;
 if(!config.env||!wx.cloud)return false;
 try{wx.cloud.init({env:config.env,traceUser:false});initialized=true;return true;}
 catch(error){console.warn('[cloud-init]',error.errMsg||error.message);return false;}
}
function asset(path){return config.enabled&&config.files[path]&&fallbacks[path]!==path?config.files[path]:(runtime[path]||path);}
function fallback(source){const original=Object.keys(config.files).find(path=>config.files[path]===source)||source;return fallbacks[original]||'';}
function cacheKey(value){let hash=2166136261;for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619);const ext=/\.(png|jpe?g|webp)$/i.exec(value);return (hash>>>0).toString(16)+(ext?ext[0]:'.jpg');}
function cache(source){
 try{const fs=wx.getFileSystemManager(),dir=wx.env.USER_DATA_PATH+'/gengdu-assets';return {fs,dir,path:dir+'/'+cacheKey(source)};}catch(error){return null;}
}
function download(source){
 return withTimeout((accept,reject)=>{
  // Pass the environment on the request as well as initializing the SDK.
  wx.cloud.downloadFile({fileID:source,config:{env:config.env},success:result=>result.tempFilePath?accept(result.tempFilePath):reject(new Error('Cloud download returned no file.')),fail:reject});
 });
}
function withTimeout(start){return new Promise((accept,reject)=>{const timer=setTimeout(()=>reject(new Error('资源加载超时，请重试')),10000);const finish=fn=>value=>{clearTimeout(timer);fn(value);};try{start(finish(accept),finish(reject));}catch(error){clearTimeout(timer);reject(error);}});}
function downloadFromURL(source){
 return withTimeout((accept,reject)=>{
  if(!wx.cloud.getTempFileURL){reject(new Error('Cloud URL lookup is unavailable.'));return;}
  wx.cloud.getTempFileURL({fileList:[source],config:{env:config.env},success:result=>{
   const file=result.fileList&&result.fileList[0];
   if(!file||file.status!==0||!file.tempFileURL){reject(new Error(file&&file.errMsg||'Cloud file is unavailable.'));return;}
   wx.downloadFile({url:file.tempFileURL,success:response=>response.statusCode===200&&response.tempFilePath?accept(response.tempFilePath):reject(new Error('Image download HTTP '+response.statusCode)),fail:reject});
  },fail:reject});
 });
}
function cached(source){const entry=cache(source),known=resolved.get(source);if(entry){try{const path=known||entry.path;entry.fs.accessSync(path);return path;}catch(error){resolved.delete(source);}}return '';}
function invalidate(source){source=asset(source);const entry=cache(source);resolved.delete(source);if(entry){try{entry.fs.unlinkSync(entry.path);}catch(error){}}}
function resolve(source){
 source=asset(source);
 if(!source.startsWith('cloud://'))return Promise.resolve(source);
 if(inFlight.has(source))return inFlight.get(source);
 const task=Promise.resolve().then(()=>{
  const known=cached(source);if(known)return known;
  if(!init())throw new Error('云资源暂不可用');const entry=cache(source);
  return download(source).catch(first=>downloadFromURL(source).catch(second=>{const error=new Error((second.errMsg||second.message||'Image download failed')+'; '+(first.errMsg||first.message||''));error.fileID=source;throw error;})).then(path=>{
   if(entry){try{try{entry.fs.mkdirSync(entry.dir,true);}catch(error){}entry.fs.copyFileSync(path,entry.path);return entry.path;}catch(error){}}
   return path;
  });
 }).then(path=>{resolved.set(source,path);record(source);return path;},error=>{record(source,error);throw error;});
 inFlight.set(source,task);task.finally(()=>inFlight.delete(source)).catch(()=>{});return task;
}
// Cloud IDs are metadata, not image src values. Only downloaded paths reach WXML.
function setImages(target,values,callback){
 let state=bindings.get(target);if(!state){state={versions:{},batch:0};bindings.set(target,state);}const batch=++state.batch;
 const waiting=[],versions={};
 const walk=(value,path,key,root)=>{
  if(typeof value==='string'&&value.startsWith('cloud://')&&key!=='realPanorama'&&key!=='originalPanorama'){
   waiting.push({source:value,path,root});return cached(value)||fallback(value);
  }
  if(Array.isArray(value))return value.map((item,index)=>walk(item,path+'['+index+']','',root));
  if(value&&typeof value==='object'){const copy={};Object.keys(value).forEach(name=>{copy[name]=walk(value[name],path+'.'+name,name,root);});return copy;}
  return value;
 };
 const patch={};Object.keys(values).forEach(key=>{versions[key]=state.versions[key]=(state.versions[key]||0)+1;patch[key]=walk(values[key],key,key,key);});
 patch.imageStatus={loading:waiting.length>0,failed:false};target.setData(patch,callback);
 const tasks=waiting.map(item=>resolve(item.source).then(path=>{
  if(bindings.get(target)===state&&state.versions[item.root]===versions[item.root])target.setData({[item.path]:path});
  return true;
 }).catch(error=>{console.warn('[cloud-image]',item.source,error.errMsg||error.message||error);return false;}));
 return Promise.all(tasks).then(results=>{if(bindings.get(target)===state&&state.batch===batch)target.setData({imageStatus:{loading:false,failed:results.includes(false)}});return results;});
}
function release(target){bindings.delete(target);}
module.exports={asset,resolve,init,setImages,release,invalidate};
