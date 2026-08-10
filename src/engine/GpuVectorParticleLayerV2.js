export const MOTION_SCALE = 12;

export function visualAdvectionMeters(speedMs, dt) {
  return speedMs * dt * MOTION_SCALE;
}

const UPDATE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_state;
uniform sampler2D u_field;
uniform vec4 u_bounds;
uniform vec4 u_spawn_bounds;
uniform float u_dt;
uniform float u_time;
out vec4 v_state;

float rand(float n){ return fract(sin(n) * 43758.5453123); }

void main(){
  float lon = a_state.x;
  float lat = a_state.y;
  float zOffset = a_state.z;
  float age = a_state.w + u_dt;

  vec2 uv = vec2(
    (lon - u_bounds.x) / (u_bounds.z - u_bounds.x),
    (lat - u_bounds.y) / (u_bounds.w - u_bounds.y)
  );
  bool outside = uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0;
  vec4 field = outside ? vec4(0.0) : texture(u_field, clamp(uv, 0.0, 1.0));
  float speed = length(field.xy);
  bool respawn = outside || age > 12.0 || speed < 0.12 || zOffset < -80.0 || zOffset > 650.0;

  if (respawn) {
    float id = float(gl_VertexID) + 1.0;
    float r1 = rand(id * 12.9898 + u_time * 0.00017);
    float r2 = rand(id * 78.233 + u_time * 0.00011);
    lon = mix(u_spawn_bounds.x, u_spawn_bounds.z, r1);
    lat = mix(u_spawn_bounds.y, u_spawn_bounds.w, r2);
    zOffset = 40.0 + rand(id * 31.731 + u_time * 0.00013) * 110.0;
    age = rand(id * 9.17) * 0.2;
  } else {
    float motionDt = u_dt * ${MOTION_SCALE.toFixed(1)};
    float metersPerDegLat = 111320.0;
    float metersPerDegLon = max(20000.0, 111320.0 * cos(radians(lat)));
    lon += field.x * motionDt / metersPerDegLon;
    lat += field.y * motionDt / metersPerDegLat;
    zOffset += field.z * motionDt;
  }

  v_state = vec4(lon, lat, zOffset, age);
  gl_Position = vec4(0.0);
}`;

const UPDATE_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
void main(){ fragColor = vec4(0.0); }
`;

const DRAW_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_state;
uniform mat4 u_matrix;
uniform sampler2D u_field;
uniform vec4 u_bounds;
uniform vec2 u_viewport;
uniform float u_pixel_ratio;
uniform float u_terrain_exaggeration;
out vec4 v_color;
out float v_progress;
out float v_side;
out float v_life;

vec2 mercatorXY(vec2 lngLat){
  float x = (lngLat.x + 180.0) / 360.0;
  float s = sin(radians(clamp(lngLat.y, -85.051129, 85.051129)));
  float y = 0.5 - log((1.0 + s) / (1.0 - s)) / (4.0 * 3.141592653589793);
  return vec2(x, y);
}

float mercatorZ(float altitudeMeters, float lat){
  float circumference = 40075016.68557849;
  float cosLat = max(0.12, cos(radians(lat)));
  return altitudeMeters / (circumference * cosLat);
}

void main(){
  vec2 uv = vec2(
    (a_state.x - u_bounds.x) / (u_bounds.z - u_bounds.x),
    (a_state.y - u_bounds.y) / (u_bounds.w - u_bounds.y)
  );
  vec4 field = texture(u_field, clamp(uv, 0.0, 1.0));
  float speed = length(field.xy);
  float speed01 = smoothstep(1.4, 15.3, speed);
  float trailSeconds = mix(9.0, 19.0, speed01);
  float metersPerDegLat = 111320.0;
  float metersPerDegLon = max(20000.0, 111320.0 * cos(radians(a_state.y)));
  vec2 tailLngLat = a_state.xy - vec2(
    field.x * trailSeconds / metersPerDegLon,
    field.y * trailSeconds / metersPerDegLat
  );
  vec2 tailUv = vec2(
    (tailLngLat.x - u_bounds.x) / (u_bounds.z - u_bounds.x),
    (tailLngLat.y - u_bounds.y) / (u_bounds.w - u_bounds.y)
  );
  vec4 tailField = texture(u_field, clamp(tailUv, 0.0, 1.0));

  float headAltitude = max(0.0, field.a) * u_terrain_exaggeration
    + 35.0 + max(0.0, a_state.z);
  float tailOffset = max(20.0, 35.0 + max(0.0, a_state.z) - field.z * trailSeconds);
  float tailAltitude = max(0.0, tailField.a) * u_terrain_exaggeration + tailOffset;

  vec4 headClip = u_matrix * vec4(
    mercatorXY(a_state.xy),
    mercatorZ(headAltitude, a_state.y),
    1.0
  );
  vec4 tailClip = u_matrix * vec4(
    mercatorXY(tailLngLat),
    mercatorZ(tailAltitude, tailLngLat.y),
    1.0
  );

  if (headClip.w <= 0.00001 || tailClip.w <= 0.00001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_color = vec4(0.0);
    v_progress = 0.0;
    v_side = 0.0;
    v_life = 0.0;
    return;
  }

  vec2 headNdc = headClip.xy / max(0.00001, headClip.w);
  vec2 tailNdc = tailClip.xy / max(0.00001, tailClip.w);
  vec2 directionPx = (headNdc - tailNdc) * 0.5 * u_viewport;
  float projectedLengthPx = length(directionPx);
  if (projectedLengthPx < 0.25 * u_pixel_ratio) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_color = vec4(0.0);
    v_progress = 0.0;
    v_side = 0.0;
    v_life = 0.0;
    return;
  }

  vec2 direction = directionPx / projectedLengthPx;
  vec2 perpendicular = vec2(-direction.y, direction.x);
  float streakLengthPx = mix(18.0, 60.0, speed01) * u_pixel_ratio;
  tailNdc = headNdc - direction * streakLengthPx * 2.0 / u_viewport;
  tailClip.xy = tailNdc * tailClip.w;
  float widthCss = mix(1.8, 3.2, speed01);
  float halfWidthPx = 0.5 * widthCss * u_pixel_ratio;

  int corner = gl_VertexID % 6;
  float along = (corner == 1 || corner == 2 || corner == 4) ? 1.0 : 0.0;
  float side = (corner == 0 || corner == 1 || corner == 3) ? -1.0 : 1.0;
  vec4 clip = mix(tailClip, headClip, along);
  vec2 offsetNdc = perpendicular * side * halfWidthPx * 2.0 / u_viewport;
  clip.xy += offsetNdc * clip.w;
  gl_Position = clip;
  v_progress = along;
  v_side = side;
  float fadeIn = smoothstep(0.0, 0.8, a_state.w);
  float fadeOut = 1.0 - smoothstep(10.5, 12.0, a_state.w);
  v_life = fadeIn * fadeOut;

  if (field.z > 0.55) v_color = vec4(0.16, 0.94, 0.48, 1.0);
  else if (field.z < -0.55) v_color = vec4(1.0, 0.27, 0.36, 1.0);
  else v_color = vec4(0.20, 0.76, 1.0, 1.0);
}`;

const DRAW_FS = `#version 300 es
precision highp float;
in vec4 v_color;
in float v_progress;
in float v_side;
in float v_life;
out vec4 fragColor;
void main(){
  float tail = smoothstep(0.0, 0.24, v_progress);
  float lateral = 1.0 - smoothstep(0.72, 1.0, abs(v_side));
  float head = mix(0.72, 1.0, smoothstep(0.35, 1.0, v_progress));
  float alpha = 0.96 * tail * lateral * head * v_life;
  fragColor = vec4(v_color.rgb * alpha, alpha);
}`;

function compile(gl, type, source){
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Error compilando shader';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource, feedbackVaryings = null){
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  if (feedbackVaryings) gl.transformFeedbackVaryings(p, feedbackVaryings, gl.SEPARATE_ATTRIBS);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(p) || 'Error enlazando programa WebGL2';
    gl.deleteProgram(p);
    throw new Error(message);
  }
  return p;
}

function uniformLocations(gl, program, names) {
  return Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
}

function seedParticles(count, bounds){
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    const x = ((Math.sin((i + 1) * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const y = ((Math.sin((i + 1) * 78.233) * 12345.6789) % 1 + 1) % 1;
    data[i * 4] = bounds.west + (bounds.east - bounds.west) * x;
    data[i * 4 + 1] = bounds.south + (bounds.north - bounds.south) * y;
    data[i * 4 + 2] = 40 + (i % 71) * 1.4;
    data[i * 4 + 3] = (i % 997) / 997 * 12;
  }
  return data;
}

function centralBounds(bounds, fraction = 0.5){
  const centerLon = (bounds.west + bounds.east) * 0.5;
  const centerLat = (bounds.south + bounds.north) * 0.5;
  const halfLon = (bounds.east - bounds.west) * fraction * 0.5;
  const halfLat = (bounds.north - bounds.south) * fraction * 0.5;
  return {
    west: centerLon - halfLon,
    south: centerLat - halfLat,
    east: centerLon + halfLon,
    north: centerLat + halfLat
  };
}

function fieldGeometryKey(field) {
  const { bounds } = field;
  return [field.width, field.height, bounds.west, bounds.south, bounds.east, bounds.north].join('|');
}

function unpackRenderArgs(first, second){
  if (first?.gl) {
    return {
      gl: first.gl,
      matrix: first.defaultProjectionData?.mainMatrix || first.modelViewProjectionMatrix || first.matrix || null
    };
  }
  const matrix = second?.defaultProjectionData?.mainMatrix || second?.modelViewProjectionMatrix || second?.matrix || (second?.length === 16 ? second : null);
  return { gl: first, matrix };
}

export class GpuVectorParticleLayerV2 {
  constructor({
    map,
    id = 'pitoviento-vector-particles-v2',
    particleCount = 18000,
    activeParticleCount = particleCount,
    terrainExaggeration = 1.35,
    onReady,
    onFirstRender
  } = {}) {
    if (!map) throw new TypeError('GpuVectorParticleLayerV2 necesita MapLibre.');
    this.map = map;
    this.id = id;
    this.type = 'custom';
    this.renderingMode = '3d';
    this.particleCount = particleCount;
    this.activeParticleCount = Math.min(particleCount, Math.max(1, activeParticleCount));
    this.terrainExaggeration = terrainExaggeration;
    this.enabled = false;
    this.onReady = onReady;
    this.onFirstRender = onFirstRender;
    this.hasRendered = false;
    this.field = null;
    this.lastTime = 0;
    this.readIndex = 0;
    this.ready = false;
    map.addLayer(this);
  }

  setEnabled(enabled){
    this.enabled = Boolean(enabled);
    this.lastTime = 0;
    this.map.triggerRepaint();
  }

  setDensity(count){
    this.activeParticleCount = Math.min(this.particleCount, Math.max(1, Math.round(count)));
    this.map.triggerRepaint();
  }

  setTerrainExaggeration(value){
    this.terrainExaggeration = Math.max(1, Number(value) || 1);
    this.map.triggerRepaint();
  }

  setField(field){
    this.field = field;
    if (this.gl && field) this.uploadField();
    this.map.triggerRepaint();
  }

  onAdd(map, gl){
    if (!gl || typeof gl.createTransformFeedback !== 'function' || typeof gl.createVertexArray !== 'function') {
      throw new Error('Este navegador no ha creado un contexto WebGL2 compatible.');
    }
    this.gl = gl;
    this.updateProgram = createProgram(gl, UPDATE_VS, UPDATE_FS, ['v_state']);
    this.drawProgram = createProgram(gl, DRAW_VS, DRAW_FS);
    this.updateUniforms = uniformLocations(gl, this.updateProgram, [
      'u_field', 'u_bounds', 'u_spawn_bounds', 'u_dt', 'u_time'
    ]);
    this.drawUniforms = uniformLocations(gl, this.drawProgram, [
      'u_matrix', 'u_field', 'u_bounds', 'u_viewport', 'u_pixel_ratio', 'u_terrain_exaggeration'
    ]);
    this.buffers = [gl.createBuffer(), gl.createBuffer()];
    this.vaos = [gl.createVertexArray(), gl.createVertexArray()];
    this.drawVao = gl.createVertexArray();
    this.feedback = gl.createTransformFeedback();
    this.fieldTexture = gl.createTexture();
    this.ready = true;
    if (this.field) this.uploadField();
    this.onReady?.();
  }

  uploadField(){
    const gl = this.gl;
    const field = this.field;
    if (!gl || !field?.data) return;

    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
    const linearFloat = Boolean(gl.getExtension('OES_texture_float_linear'));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linearFloat ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linearFloat ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, field.width, field.height, 0, gl.RGBA, gl.FLOAT, field.data);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const nextGeometryKey = fieldGeometryKey(field);
    if (this.fieldGeometryKey === nextGeometryKey) return;
    this.fieldGeometryKey = nextGeometryKey;
    this.spawnBounds = centralBounds(field.bounds);
    const seeded = seedParticles(this.particleCount, this.spawnBounds);
    for (let i = 0; i < 2; i += 1) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[i]);
      gl.bufferData(gl.ARRAY_BUFFER, seeded, gl.DYNAMIC_COPY);
      gl.bindVertexArray(this.vaos[i]);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.readIndex = 0;
    this.lastTime = 0;
  }

  render(first, second){
    if (!this.enabled || !this.field || !this.ready) return;
    const { gl, matrix } = unpackRenderArgs(first, second);
    if (!gl || !matrix) return;

    const now = performance.now();
    const dt = this.lastTime ? Math.min(0.08, (now - this.lastTime) / 1000) : 0.016;
    this.lastTime = now;
    const src = this.readIndex;
    const dst = 1 - src;
    const b = this.field.bounds;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);

    gl.useProgram(this.updateProgram);
    const updateUniforms = this.updateUniforms;
    gl.uniform1i(updateUniforms.u_field, 0);
    gl.uniform4f(updateUniforms.u_bounds, b.west, b.south, b.east, b.north);
    const spawn = this.spawnBounds || centralBounds(b);
    gl.uniform4f(updateUniforms.u_spawn_bounds, spawn.west, spawn.south, spawn.east, spawn.north);
    gl.uniform1f(updateUniforms.u_dt, dt);
    gl.uniform1f(updateUniforms.u_time, now);
    gl.bindVertexArray(this.vaos[src]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.feedback);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.buffers[dst]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.activeParticleCount);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

    gl.useProgram(this.drawProgram);
    const drawUniforms = this.drawUniforms;
    gl.uniformMatrix4fv(drawUniforms.u_matrix, false, matrix);
    gl.uniform1i(drawUniforms.u_field, 0);
    gl.uniform4f(drawUniforms.u_bounds, b.west, b.south, b.east, b.north);
    gl.uniform2f(drawUniforms.u_viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(drawUniforms.u_pixel_ratio, Math.min(3, window.devicePixelRatio || 1));
    gl.uniform1f(drawUniforms.u_terrain_exaggeration, this.terrainExaggeration);

    const wasBlendEnabled = gl.isEnabled(gl.BLEND);
    const blendSrcRgb = gl.getParameter(gl.BLEND_SRC_RGB);
    const blendDstRgb = gl.getParameter(gl.BLEND_DST_RGB);
    const blendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA);
    const blendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);
    const wasDepthTestEnabled = gl.isEnabled(gl.DEPTH_TEST);
    const depthFunc = gl.getParameter(gl.DEPTH_FUNC);
    const depthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    const wasCullEnabled = gl.isEnabled(gl.CULL_FACE);

    gl.bindVertexArray(this.drawVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[dst]);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.activeParticleCount);

    gl.depthMask(depthMask);
    gl.depthFunc(depthFunc);
    gl.blendFuncSeparate(blendSrcRgb, blendDstRgb, blendSrcAlpha, blendDstAlpha);
    if (!wasBlendEnabled) gl.disable(gl.BLEND);
    if (!wasDepthTestEnabled) gl.disable(gl.DEPTH_TEST);
    if (wasCullEnabled) gl.enable(gl.CULL_FACE);

    if (!this.hasRendered) {
      this.hasRendered = true;
      this.onFirstRender?.();
    }

    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);
    this.readIndex = dst;
    this.map.triggerRepaint();
  }

  onRemove(map, gl){
    if (!gl) return;
    for (const buffer of this.buffers || []) gl.deleteBuffer(buffer);
    for (const vao of this.vaos || []) gl.deleteVertexArray(vao);
    if (this.drawVao) gl.deleteVertexArray(this.drawVao);
    if (this.feedback) gl.deleteTransformFeedback(this.feedback);
    if (this.fieldTexture) gl.deleteTexture(this.fieldTexture);
    if (this.updateProgram) gl.deleteProgram(this.updateProgram);
    if (this.drawProgram) gl.deleteProgram(this.drawProgram);
    this.updateUniforms = null;
    this.drawUniforms = null;
    this.fieldGeometryKey = null;
    this.ready = false;
  }

  destroy(){
    if (this.map?.getLayer(this.id)) this.map.removeLayer(this.id);
    this.field = null;
    this.onReady = null;
    this.onFirstRender = null;
    this.map = null;
  }
}
