const UPDATE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_state;
uniform sampler2D u_field;
uniform vec4 u_bounds;
uniform float u_dt;
uniform float u_maxAge;
out vec4 v_state;

float rand(float n){ return fract(sin(n)*43758.5453123); }

void main(){
  float lon=a_state.x, lat=a_state.y, age=a_state.z, seed=a_state.w;
  vec2 uv=vec2((lon-u_bounds.x)/(u_bounds.z-u_bounds.x),(lat-u_bounds.y)/(u_bounds.w-u_bounds.y));
  bool outside=uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0;
  vec4 field=outside?vec4(0.0):texture(u_field,clamp(uv,0.0,1.0));
  float speed=length(field.xy);
  age+=u_dt;
  bool respawn=outside||age>u_maxAge||speed<0.15;
  if(respawn){
    float r1=rand(seed*19.17+age*0.013);
    float r2=rand(seed*71.73+age*0.021);
    lon=mix(u_bounds.x,u_bounds.z,r1);
    lat=mix(u_bounds.y,u_bounds.w,r2);
    age=0.0;
  }else{
    float metersPerDegLat=111320.0;
    float metersPerDegLon=max(20000.0,111320.0*cos(radians(lat)));
    lon+=field.x*u_dt/metersPerDegLon;
    lat+=field.y*u_dt/metersPerDegLat;
  }
  v_state=vec4(lon,lat,age,seed);
}`;

const UPDATE_FS = `#version 300 es
precision highp float;
void main(){}
`;

const DRAW_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_state;
uniform mat4 u_matrix;
uniform sampler2D u_field;
uniform vec4 u_bounds;
out vec4 v_color;

vec2 mercator(vec2 lngLat){
  float x=(lngLat.x+180.0)/360.0;
  float s=sin(radians(clamp(lngLat.y,-85.051129,85.051129)));
  float y=0.5-log((1.0+s)/(1.0-s))/(4.0*3.141592653589793);
  return vec2(x,y);
}

void main(){
  vec2 uv=vec2((a_state.x-u_bounds.x)/(u_bounds.z-u_bounds.x),(a_state.y-u_bounds.y)/(u_bounds.w-u_bounds.y));
  vec4 field=texture(u_field,clamp(uv,0.0,1.0));
  vec2 xy=mercator(a_state.xy);
  gl_Position=u_matrix*vec4(xy,0.0,1.0);
  gl_PointSize=2.0;
  if(field.z>0.55) v_color=vec4(0.21,0.89,0.50,0.88);
  else if(field.z<-0.55) v_color=vec4(1.0,0.36,0.42,0.88);
  else v_color=vec4(0.35,0.78,0.98,0.78);
}`;

const DRAW_FS = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 fragColor;
void main(){
  vec2 d=gl_PointCoord-vec2(0.5);
  if(dot(d,d)>0.25) discard;
  fragColor=v_color;
}`;

function compile(gl,type,source){
  const shader=gl.createShader(type);
  gl.shaderSource(shader,source);
  gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
    const message=gl.getShaderInfoLog(shader)||'Error compilando shader';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function program(gl,vsSource,fsSource,feedbackVaryings=null){
  const p=gl.createProgram();
  const vs=compile(gl,gl.VERTEX_SHADER,vsSource);
  const fs=compile(gl,gl.FRAGMENT_SHADER,fsSource);
  gl.attachShader(p,vs);
  gl.attachShader(p,fs);
  if(feedbackVaryings) gl.transformFeedbackVaryings(p,feedbackVaryings,gl.SEPARATE_ATTRIBS);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)){
    const message=gl.getProgramInfoLog(p)||'Error enlazando programa WebGL';
    gl.deleteProgram(p);
    throw new Error(message);
  }
  return p;
}

function seedParticles(count,bounds){
  const data=new Float32Array(count*4);
  for(let i=0;i<count;i+=1){
    const r1=(Math.sin((i+1)*12.9898)*43758.5453)%1;
    const r2=(Math.sin((i+1)*78.233)*12345.6789)%1;
    const x=r1<0?r1+1:r1;
    const y=r2<0?r2+1:r2;
    data[i*4]=bounds.west+(bounds.east-bounds.west)*x;
    data[i*4+1]=bounds.south+(bounds.north-bounds.south)*y;
    data[i*4+2]=(i%97)*0.13;
    data[i*4+3]=i+1;
  }
  return data;
}

function readMatrix(args){
  if(args&&args.length===16) return args;
  return args?.defaultProjectionData?.mainMatrix||args?.matrix||null;
}

export class GpuVectorParticleLayer {
  constructor({map,id='pitoviento-vector-particles',particleCount=60000}={}){
    if(!map) throw new TypeError('GpuVectorParticleLayer necesita MapLibre.');
    this.map=map;
    this.id=id;
    this.type='custom';
    this.renderingMode='3d';
    this.particleCount=particleCount;
    this.enabled=false;
    this.field=null;
    this.lastTime=0;
    this.readIndex=0;
    this.ready=false;
    map.addLayer(this);
  }

  setEnabled(enabled){
    this.enabled=Boolean(enabled);
    this.map.triggerRepaint();
  }

  setField(field){
    this.field=field;
    if(this.gl&&field) this.uploadField();
    this.map.triggerRepaint();
  }

  onAdd(map,gl){
    if(!(gl instanceof WebGL2RenderingContext)) throw new Error('La advección GPU requiere WebGL2.');
    this.gl=gl;
    this.updateProgram=program(gl,UPDATE_VS,UPDATE_FS,['v_state']);
    this.drawProgram=program(gl,DRAW_VS,DRAW_FS);
    this.buffers=[gl.createBuffer(),gl.createBuffer()];
    this.vaos=[gl.createVertexArray(),gl.createVertexArray()];
    this.feedback=gl.createTransformFeedback();
    this.fieldTexture=gl.createTexture();
    this.ready=true;
    if(this.field) this.uploadField();
  }

  uploadField(){
    const gl=this.gl, field=this.field;
    if(!gl||!field?.data) return;
    gl.bindTexture(gl.TEXTURE_2D,this.fieldTexture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,field.width,field.height,0,gl.RGBA,gl.FLOAT,field.data);
    gl.bindTexture(gl.TEXTURE_2D,null);

    const seeded=seedParticles(this.particleCount,field.bounds);
    for(let i=0;i<2;i+=1){
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buffers[i]);
      gl.bufferData(gl.ARRAY_BUFFER,seeded.byteLength,gl.DYNAMIC_COPY);
      gl.bufferSubData(gl.ARRAY_BUFFER,0,seeded);
      gl.bindVertexArray(this.vaos[i]);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buffers[i]);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0,4,gl.FLOAT,false,16,0);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER,null);
    this.readIndex=0;
  }

  render(gl,args){
    if(!this.enabled||!this.field||!this.ready) return;
    const matrix=readMatrix(args);
    if(!matrix) return;
    const now=performance.now();
    const dt=this.lastTime?Math.min(0.08,(now-this.lastTime)/1000):0.016;
    this.lastTime=now;
    const src=this.readIndex, dst=1-src;
    const b=this.field.bounds;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,this.fieldTexture);

    gl.useProgram(this.updateProgram);
    gl.uniform1i(gl.getUniformLocation(this.updateProgram,'u_field'),0);
    gl.uniform4f(gl.getUniformLocation(this.updateProgram,'u_bounds'),b.west,b.south,b.east,b.north);
    gl.uniform1f(gl.getUniformLocation(this.updateProgram,'u_dt'),dt);
    gl.uniform1f(gl.getUniformLocation(this.updateProgram,'u_maxAge'),10.0);
    gl.bindVertexArray(this.vaos[src]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,this.feedback);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,this.buffers[dst]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS,0,this.particleCount);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);

    gl.useProgram(this.drawProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.drawProgram,'u_matrix'),false,matrix);
    gl.uniform1i(gl.getUniformLocation(this.drawProgram,'u_field'),0);
    gl.uniform4f(gl.getUniformLocation(this.drawProgram,'u_bounds'),b.west,b.south,b.east,b.north);
    gl.bindVertexArray(this.vaos[dst]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.POINTS,0,this.particleCount);

    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D,null);
    gl.useProgram(null);
    this.readIndex=dst;
    this.map.triggerRepaint();
  }

  onRemove(map,gl){
    for(const buffer of this.buffers||[]) gl.deleteBuffer(buffer);
    for(const vao of this.vaos||[]) gl.deleteVertexArray(vao);
    if(this.feedback) gl.deleteTransformFeedback(this.feedback);
    if(this.fieldTexture) gl.deleteTexture(this.fieldTexture);
    if(this.updateProgram) gl.deleteProgram(this.updateProgram);
    if(this.drawProgram) gl.deleteProgram(this.drawProgram);
    this.ready=false;
  }

  destroy(){
    if(this.map?.getLayer(this.id)) this.map.removeLayer(this.id);
  }
}
