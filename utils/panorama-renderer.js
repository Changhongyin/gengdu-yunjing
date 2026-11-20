// Shared WebGL spherical panorama renderer for WeChat canvas and ordinary browsers.
const vertex = 'attribute vec2 aPosition; varying vec2 vPosition; void main(){ vPosition=aPosition; gl_Position=vec4(aPosition,0.0,1.0); }';
const fragment = `
 precision highp float;
 varying vec2 vPosition;
 uniform sampler2D uTexture;
 uniform float uAspect;
 uniform float uFov;
 uniform float uYaw;
 uniform float uPitch;
 const float PI=3.141592653589793;
 void main(){
   float t=tan(uFov*0.5);
   vec3 d=normalize(vec3(vPosition.x*uAspect*t,vPosition.y*t,-1.0));
   float cp=cos(uPitch),sp=sin(uPitch);
   d=vec3(d.x,cp*d.y-sp*d.z,sp*d.y+cp*d.z);
   float cy=cos(uYaw),sy=sin(uYaw);
   d=vec3(cy*d.x-sy*d.z,d.y,sy*d.x+cy*d.z);
   vec2 uv=vec2(fract(0.5+atan(d.x,-d.z)/(2.0*PI)),clamp(0.5-asin(clamp(d.y,-1.0,1.0))/PI,0.001,0.999));
   gl_FragColor=texture2D(uTexture,uv);
 }
`;
class PanoramaRenderer {
 constructor(canvas,cssWidth,cssHeight,options={}){
  this.canvas=canvas;this.cssWidth=cssWidth;this.cssHeight=cssHeight;this.initialYaw=options.yaw||0;this.yaw=this.initialYaw;this.pitch=0;this.fov=Math.PI/2.5;this.disposed=false;this.loadId=0;
  // 1080 pixels on the short edge. The long edge follows the viewport aspect ratio.
  const scale=1080/Math.min(cssWidth,cssHeight);
  const pixels=cssWidth*cssHeight*scale*scale;
  const safeScale=scale*Math.min(1,Math.sqrt(6000000/pixels));
  this.width=Math.round(cssWidth*safeScale);this.height=Math.round(cssHeight*safeScale);
  canvas.width=this.width;canvas.height=this.height;
  const gl=canvas.getContext('webgl',{antialias:false,alpha:false,depth:false,preserveDrawingBuffer:false});
  if(!gl)throw new Error('当前设备无法启用 WebGL，请使用720云实景入口。');this.gl=gl;
  const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error('全景着色器编译失败：'+error);}return shader;};
  const precision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);
  this.shaders=[compile(gl.VERTEX_SHADER,vertex),compile(gl.FRAGMENT_SHADER,precision&&precision.precision?fragment:fragment.replace('highp','mediump'))];
  this.program=gl.createProgram();this.shaders.forEach(s=>gl.attachShader(this.program,s));gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error('当前设备无法初始化全景渲染器。');gl.useProgram(this.program);
  this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);const location=gl.getAttribLocation(this.program,'aPosition');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
  this.uniforms={};['uTexture','uAspect','uFov','uYaw','uPitch'].forEach(k=>this.uniforms[k]=gl.getUniformLocation(this.program,k));
  this.texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 }
 load(path,info){const loadId=++this.loadId;return new Promise((resolve,reject)=>{const gl=this.gl;const max=gl.getParameter(gl.MAX_TEXTURE_SIZE);if(info.width>max||info.height>max){reject(new Error('此设备支持的全景纹理最大为 '+max+' 像素，请选择该尺寸以内的原图。'));return;}const image=typeof this.canvas.createImage==='function'?this.canvas.createImage():new Image();this.image=image;image.onload=()=>{if(this.disposed||loadId!==this.loadId){resolve();return;}try{gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);if(gl.getError()!==gl.NO_ERROR)throw new Error('图片纹理载入失败，请换用 JPG 或 PNG 全景原图。');this.ready=true;this.draw();resolve();}catch(e){reject(e);}};image.onerror=()=>reject(new Error('图片载入失败，请换用 JPG 或 PNG 全景原图。'));image.src=path;});}
 resize(cssWidth,cssHeight){if(this.disposed||!cssWidth||!cssHeight)return;this.cssWidth=cssWidth;this.cssHeight=cssHeight;const scale=1080/Math.min(cssWidth,cssHeight);const safe=scale*Math.min(1,Math.sqrt(6000000/(cssWidth*cssHeight*scale*scale)));this.width=Math.round(cssWidth*safe);this.height=Math.round(cssHeight*safe);this.canvas.width=this.width;this.canvas.height=this.height;this.draw();}
 draw(){if(!this.ready||this.disposed)return;const gl=this.gl,u=this.uniforms;gl.viewport(0,0,this.width,this.height);gl.uniform1i(u.uTexture,0);gl.uniform1f(u.uAspect,this.cssWidth/this.cssHeight);gl.uniform1f(u.uFov,this.fov);gl.uniform1f(u.uYaw,this.yaw);gl.uniform1f(u.uPitch,this.pitch);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}
 rotate(dx,dy){this.yaw-=dx/this.cssWidth*this.fov;this.pitch=Math.max(-1.45,Math.min(1.45,this.pitch+dy/this.cssHeight*this.fov));this.draw();}
 zoom(ratio){this.fov=Math.max(.55,Math.min(1.9,this.fov*ratio));this.draw();}
 setView(yaw,pitch=0,fov=Math.PI/2.5){this.yaw=yaw;this.pitch=Math.max(-1.45,Math.min(1.45,pitch));this.fov=Math.max(.55,Math.min(1.9,fov));this.draw();}
 reset(){this.setView(this.initialYaw);}
 destroy(){if(this.disposed)return;this.disposed=true;const gl=this.gl;gl.deleteTexture(this.texture);gl.deleteBuffer(this.buffer);gl.deleteProgram(this.program);this.shaders.forEach(s=>gl.deleteShader(s));if(this.image){this.image.onload=null;this.image.onerror=null;}this.image=null;}
}
if(typeof module!=='undefined'&&module.exports)module.exports={PanoramaRenderer};
else if(typeof window!=='undefined')window.PanoramaRenderer=PanoramaRenderer;
