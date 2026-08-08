(() => {
  'use strict';

  const SITE = { lon:-5.979353098143796, lat:40.13618392931326, name:'Pico Pitolero' };
  const AREA_KM = 40;
  const DEM_URL = 'https://xyz-mdt.idee.es/1.0.0/raster-dem/{z}/{x}/{y}.png';
  const ORTHO_URL = 'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{y}.jpeg';
  const BASE_URL = 'https://tms-ign-base.idee.es/1.0.0/IGNBaseTodo/{z}/{x}/{y}.jpeg';

  const $ = id => document.getElementById(id);
  const clamp = (x,a,b) => Math.max(a, Math.min(b, x));
  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;

  function destination(lon, lat, bearingDeg, distM){
    const R = 6371008.8;
    const br = rad(bearingDeg);
    const d = distM / R;
    const p1 = rad(lat);
    const l1 = rad(lon);
    const p2 = Math.asin(Math.sin(p1)*Math.cos(d) + Math.cos(p1)*Math.sin(d)*Math.cos(br));
    const l2 = l1 + Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(p1), Math.cos(d)-Math.sin(p1)*Math.sin(p2));
    return [((deg(l2)+540)%360)-180, deg(p2)];
  }

  function distanceM(aLon,aLat,bLon,bLat){
    const R = 6371008.8;
    const p1 = rad(aLat), p2 = rad(bLat);
    const dp = rad(bLat-aLat), dl = rad(bLon-aLon);
    const h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  }

  function pathLength(path){
    let total = 0;
    for(let i=1;i<path.length;i++) total += distanceM(path[i-1][0],path[i-1][1],path[i][0],path[i][1]);
    return Math.max(total,1);
  }

  function compassLabel(d){
    const names=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
    return names[Math.round((((d%360)+360)%360)/22.5)%16];
  }

  function colorFor(w,wake){
    if(wake>0.65) return [255,184,77,235];
    if(w>0.55) return [53,226,127,235];
    if(w<-0.55) return [255,92,108,235];
    return [90,200,250,220];
  }

  function guideColor(c,alpha){ return [c[0],c[1],c[2],alpha]; }

  function classFor(w,wake){
    if(wake>0.65) return 'estela / rotor probable';
    if(w>0.55) return 'ascendencia orográfica';
    if(w<-0.55) return 'descendencia / sotavento';
    return 'flujo casi neutro';
  }

  const areaSW = destination(...destination(SITE.lon,SITE.lat,180,AREA_KM*500),270,AREA_KM*500);
  const areaNE = destination(...destination(SITE.lon,SITE.lat,0,AREA_KM*500),90,AREA_KM*500);

  const style = {
    version:8,
    sources:{
      ignbase:{type:'raster',tiles:[BASE_URL],tileSize:256,scheme:'tms',maxzoom:18,attribution:'© IGN/CNIG · CC BY 4.0 scne.es'},
      pnoa:{type:'raster',tiles:[ORTHO_URL],tileSize:256,scheme:'tms',maxzoom:19,attribution:'PNOA máxima actualidad · IGN/CNIG'},
      terrain:{type:'raster-dem',tiles:[DEM_URL],tileSize:512,minzoom:5,maxzoom:15,encoding:'mapbox',attribution:'MDT05 LiDAR · IGN/CNIG · CC BY 4.0 scne.es'}
    },
    layers:[
      {id:'base',type:'raster',source:'ignbase',paint:{'raster-opacity':1}},
      {id:'ortho',type:'raster',source:'pnoa',paint:{'raster-opacity':0.72,'raster-saturation':-0.12,'raster-contrast':0.08}},
      {id:'hillshade',type:'hillshade',source:'terrain',paint:{'hillshade-exaggeration':0.35,'hillshade-shadow-color':'#071017','hillshade-highlight-color':'#fff4d8','hillshade-accent-color':'#3b4a54'}}
    ],
    terrain:{source:'terrain',exaggeration:1.35}
  };

  const map = new maplibregl.Map({
    container:'map', style,
    center:[SITE.lon,SITE.lat], zoom:10.15, pitch:66, bearing:28,
    maxPitch:85, maxZoom:18, antialias:true, hash:false
  });
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true,showCompass:true,showZoom:true}),'top-right');
  map.addControl(new maplibregl.ScaleControl({maxWidth:120,unit:'metric'}),'bottom-right');

  const markerEl = document.createElement('div');
  markerEl.className = 'site-marker';
  markerEl.title = 'Pico Pitolero';
  new maplibregl.Marker({element:markerEl,anchor:'center'})
    .setLngLat([SITE.lon,SITE.lat])
    .setPopup(new maplibregl.Popup({offset:14}).setHTML('<b>Pico Pitolero</b><br>Cabezabellosa · Cáceres'))
    .addTo(map);

  let overlay = null;
  let animId = 0;
  let modelBusy = false;
  let lastModelKey = '';
  let localTimer = 0;
  let recalcTimer = 0;
  let pointerInfo = null;
  let selectedPoint = null;
  let clickPopup = null;

  let windModel = {
    globalStreams:[], globalSegments:[],
    localStreams:[], localSegments:[],
    selectedStream:null, selectedSegments:[]
  };

  const {MapboxOverlay,PathLayer,ScatterplotLayer} = deck;

  function setStatus(text,state='loading'){
    $('statusText').textContent = text;
    $('statusDot').className = 'dot ' + (state==='ok'?'ok':state==='err'?'err':'');
  }

  function getExag(){ return +$('exag').value; }

  function terrainElev(lon,lat){
    try{
      const v = map.queryTerrainElevation([lon,lat],{exaggerated:false});
      return Number.isFinite(v) ? v : null;
    }catch(e){
      return null;
    }
  }

  function stabilityParams(){
    const s = $('stability').value;
    if(s==='stable') return {lift:1.08,wake:1.45,steer:1.25,mix:0.72};
    if(s==='unstable') return {lift:0.82,wake:0.52,steer:0.75,mix:1.35};
    return {lift:0.96,wake:1.0,steer:1.0,mix:1.0};
  }

  function localFlowAt(lon,lat,fromDeg,speedKmh,probe=180){
    const flow = (fromDeg+180)%360;
    const U = speedKmh/3.6;
    const p = stabilityParams();
    const a = destination(lon,lat,(flow+180)%360,probe);
    const b = destination(lon,lat,flow,probe);
    const h0 = terrainElev(lon,lat);
    const ha = terrainElev(a[0],a[1]);
    const hb = terrainElev(b[0],b[1]);
    if([h0,ha,hb].some(v=>v===null)) return null;
    const slope = (hb-ha)/(2*probe);
    const w = clamp(U*slope*1.55*p.lift,-5.5,5.5);
    return {elev:h0,w,slope};
  }

  function traceStream(start, flow, totalM, step, phase, kind){
    const speed = +$('speed').value;
    const U = speed/3.6;
    const p = stabilityParams();
    const exag = getExag();
    const path = [];
    const values = [];
    const segments = [];
    let pos = [start[0],start[1]];
    let bearing = flow;
    let crest = -Infinity;
    let crestAge = 999999;
    let airAlt = null;
    const probe = clamp(step*0.65,55,420);

    for(let traveled=0; traveled<=totalM; traveled+=step){
      const ground = terrainElev(pos[0],pos[1]);
      if(ground===null){
        pos = destination(pos[0],pos[1],bearing,step);
        continue;
      }

      const ahead = destination(pos[0],pos[1],bearing,probe);
      const left = destination(pos[0],pos[1],(bearing+270)%360,probe);
      const right = destination(pos[0],pos[1],(bearing+90)%360,probe);
      const hA = terrainElev(ahead[0],ahead[1]);
      const hL = terrainElev(left[0],left[1]);
      const hR = terrainElev(right[0],right[1]);
      const alongSlope = hA===null ? 0 : (hA-ground)/probe;
      const crossSlope = hL===null || hR===null ? 0 : (hR-hL)/(2*probe);
      const climb = clamp(U*alongSlope*1.55*p.lift,-5.5,5.5);

      if(ground>crest){ crest=ground; crestAge=0; }
      else crestAge += step;

      const drop = Math.max(0,crest-ground);
      const wakeRaw = drop/650*Math.exp(-crestAge/(5200*p.mix));
      const wake = clamp(wakeRaw*p.wake*(speed/25),0,1.4);
      const w = clamp(climb-wake*1.15,-6,6);
      const minAgl = kind==='selected' ? 85+speed*1.6 : 125+speed*2.0;

      if(airAlt===null) airAlt = ground+minAgl;
      const dt = step/Math.max(U,2.2);
      airAlt += w*dt*0.34;
      airAlt += (ground+minAgl-airAlt)*(kind==='local'?0.28:0.22);
      airAlt = Math.max(airAlt,ground+70);

      const point = [pos[0],pos[1],ground*exag+(airAlt-ground)];
      path.push(point);
      values.push({w,wake,ground});
      if(path.length>1){
        segments.push({a:path[path.length-2],b:point,color:colorFor(w,wake),w,wake,kind});
      }

      const turnLimit = kind==='local' ? 5.0 : 4.0;
      const turn = clamp(-crossSlope*140*p.steer,-turnLimit,turnLimit);
      bearing = (bearing+turn+360)%360;
      pos = destination(pos[0],pos[1],bearing,step);
    }

    return {path,values,segments,phase,kind,lengthM:pathLength(path)};
  }

  function localDetailConfig(){
    const z = map.getZoom();
    if(z<11) return {density:0,step:0,crossSpan:0,alongSpan:0};

    let density, step;
    if(z<12){ density=19; step=620; }
    else if(z<13){ density=31; step=360; }
    else if(z<14){ density=43; step=210; }
    else if(z<15){ density=55; step=125; }
    else if(z<16){ density=67; step=75; }
    else { density=79; step=45; }

    const b = map.getBounds();
    const c = map.getCenter();
    const width = distanceM(b.getWest(),c.lat,b.getEast(),c.lat);
    const height = distanceM(c.lng,b.getSouth(),c.lng,b.getNorth());
    const viewSpan = clamp(Math.max(width,height),900,26000);
    return {
      density,
      step,
      crossSpan:clamp(viewSpan*0.95,900,24000),
      alongSpan:clamp(viewSpan*1.35,2200,30000)
    };
  }

  function updateLocalDetailLabel(cfg){
    const el = $('localDensityLabel');
    if(!el) return;
    if(!cfg || cfg.density===0){
      el.textContent = 'se densifica al ampliar';
      return;
    }
    const spacing = Math.max(1,Math.round(cfg.crossSpan/Math.max(1,cfg.density-1)));
    el.textContent = `${cfg.density} trazas locales · separación ~${spacing} m`;
  }

  function buildLocalDetail(){
    if(!map.isStyleLoaded()) return;
    const cfg = localDetailConfig();
    updateLocalDetailLabel(cfg);
    windModel.localStreams = [];
    windModel.localSegments = [];

    if(cfg.density===0){
      renderDeck(performance.now());
      return;
    }

    const from = +$('direction').value;
    const flow = (from+180)%360;
    const center = map.getCenter();
    const crossStep = cfg.crossSpan/Math.max(1,cfg.density-1);

    for(let i=0;i<cfg.density;i++){
      const cross = -cfg.crossSpan/2 + i*crossStep;
      let pos = destination(center.lng,center.lat,(flow+270)%360,cross);
      pos = destination(pos[0],pos[1],(flow+180)%360,cfg.alongSpan/2);
      const s = traceStream(pos,flow,cfg.alongSpan,cfg.step,i/Math.max(1,cfg.density),'local');
      if(s.path.length>3){
        windModel.localStreams.push(s);
        windModel.localSegments.push(...s.segments);
      }
    }

    if(selectedPoint) buildSelectedStream(false);
    renderDeck(performance.now());
    setStatus(`Detalle local activo · ${cfg.density} trazas 3D en zoom ${map.getZoom().toFixed(1)}`,'ok');
  }

  function buildSelectedStream(showStatus=true){
    windModel.selectedStream = null;
    windModel.selectedSegments = [];
    if(!selectedPoint) return;

    const ground0 = terrainElev(selectedPoint.lon,selectedPoint.lat);
    if(ground0===null){
      if(showStatus) setStatus('El MDT aún no está cargado en ese punto. Espera un momento y vuelve a hacer clic.','loading');
      return;
    }

    const from = +$('direction').value;
    const speed = +$('speed').value;
    const flow = (from+180)%360;
    const exag = getExag();
    const cfg = localDetailConfig();
    const step = clamp(cfg.step || 220,45,260);
    const halfSpan = clamp((cfg.alongSpan || 8000)*0.55,3000,9000);
    const minAgl = 80+speed*1.5;
    const p = stabilityParams();
    const U = speed/3.6;

    const backwards = [];
    const backValues = [];
    let pos = [selectedPoint.lon,selectedPoint.lat];
    let bearing = flow;
    let airAlt = ground0+minAgl;
    const probe = clamp(step*0.65,45,220);

    for(let traveled=0; traveled<=halfSpan; traveled+=step){
      const ground = terrainElev(pos[0],pos[1]);
      if(ground===null) break;
      const ahead = destination(pos[0],pos[1],bearing,probe);
      const left = destination(pos[0],pos[1],(bearing+270)%360,probe);
      const right = destination(pos[0],pos[1],(bearing+90)%360,probe);
      const hA = terrainElev(ahead[0],ahead[1]);
      const hL = terrainElev(left[0],left[1]);
      const hR = terrainElev(right[0],right[1]);
      const alongSlope = hA===null ? 0 : (hA-ground)/probe;
      const crossSlope = hL===null || hR===null ? 0 : (hR-hL)/(2*probe);
      const w = clamp(U*alongSlope*1.55*p.lift,-5.5,5.5);
      const dt = step/Math.max(U,2.2);
      airAlt -= w*dt*0.28;
      airAlt += (ground+minAgl-airAlt)*0.34;
      airAlt = Math.max(airAlt,ground+60);
      backwards.push([pos[0],pos[1],ground*exag+(airAlt-ground)]);
      backValues.push({w,wake:0,ground});
      const turn = clamp(-crossSlope*140*p.steer,-5,5);
      bearing = (bearing-turn+360)%360;
      pos = destination(pos[0],pos[1],(bearing+180)%360,step);
    }

    backwards.reverse();
    backValues.reverse();

    const forward = traceStream([selectedPoint.lon,selectedPoint.lat],flow,halfSpan,step,0,'selected');
    let path = backwards;
    let values = backValues;
    if(forward.path.length){
      path = path.concat(forward.path.slice(1));
      values = values.concat(forward.values.slice(1));
    }

    const segments = [];
    for(let i=1;i<path.length;i++){
      const v = values[i] || {w:0,wake:0};
      segments.push({a:path[i-1],b:path[i],color:colorFor(v.w,v.wake),w:v.w,wake:v.wake,kind:'selected'});
    }

    windModel.selectedStream = {path,values,phase:0,kind:'selected',lengthM:pathLength(path)};
    windModel.selectedSegments = segments;
    pointerInfo = {lon:selectedPoint.lon,lat:selectedPoint.lat,z:ground0*exag+24};

    const local = localFlowAt(selectedPoint.lon,selectedPoint.lat,from,speed,Math.max(70,probe));
    if(showStatus){
      const txt = local
        ? `Línea puntual creada · ${Math.round(local.elev)} m · w ${(local.w>=0?'+':'')+local.w.toFixed(1)} m/s`
        : 'Línea puntual creada sobre el terreno';
      setStatus(txt,'ok');
    }
  }

  async function buildWindModel(force=false){
    if(modelBusy) return;
    modelBusy = true;

    const from = +$('direction').value;
    const speed = +$('speed').value;
    const density = +$('density').value;
    const exag = getExag();
    const stab = $('stability').value;
    const key = [from,speed,density,exag,stab].join('|');

    if(!force && key===lastModelKey){
      modelBusy = false;
      return;
    }
    lastModelKey = key;
    setStatus('Calculando campo 3D sobre el MDT…');
    await new Promise(r=>setTimeout(r,25));

    const flow = (from+180)%360;
    const streams = [];
    const segments = [];
    const crossSpan = 34000;
    const alongSpan = 54000;
    const step = 900;
    const crossStep = crossSpan/Math.max(1,density-1);
    let validCount = 0;

    for(let i=0;i<density;i++){
      const cross = -crossSpan/2+i*crossStep;
      let pos = destination(SITE.lon,SITE.lat,(flow+270)%360,cross);
      pos = destination(pos[0],pos[1],(flow+180)%360,alongSpan/2);
      const s = traceStream(pos,flow,alongSpan,step,i/Math.max(1,density),'global');
      if(s.path.length>4){
        validCount += s.path.length;
        streams.push(s);
        segments.push(...s.segments);
      }
    }

    windModel.globalStreams = streams;
    windModel.globalSegments = segments;
    buildLocalDetail();
    if(selectedPoint) buildSelectedStream(false);

    const site = localFlowAt(SITE.lon,SITE.lat,from,speed,180);
    if(site){
      $('siteElev').textContent = Math.round(site.elev)+' m';
      $('siteW').textContent = (site.w>=0?'+':'')+site.w.toFixed(1)+' m/s';
      $('siteClass').textContent = classFor(site.w,0);
    }

    renderDeck(performance.now());
    setStatus(validCount>100 ? 'MDT cargado · partículas 3D actualizadas' : 'Esperando más teselas del MDT…', validCount>100?'ok':'loading');
    modelBusy = false;
  }

  function sampleStream(stream,norm){
    if(!stream || !stream.path || stream.path.length<2) return null;
    const n = ((norm%1)+1)%1;
    const f = n*(stream.path.length-1);
    const i = Math.floor(f);
    const q = f-i;
    const a = stream.path[i];
    const b = stream.path[Math.min(i+1,stream.path.length-1)];
    const val = stream.values[Math.min(i,stream.values.length-1)] || {w:0,wake:0};
    return {
      position:[a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q,a[2]+(b[2]-a[2])*q+12],
      value:val
    };
  }

  function particleSpacing(kind,zoom){
    if(kind==='selected') return 420;
    if(kind==='global') return zoom<11 ? 3600 : 2800;
    if(zoom<12) return 1300;
    if(zoom<13) return 900;
    if(zoom<14) return 620;
    if(zoom<15) return 420;
    if(zoom<16) return 290;
    return 190;
  }

  function particleVisualData(t){
    if(!$('particles').checked) return {trails:[],heads:[]};
    const speed = +$('speed').value;
    const U = speed/3.6;
    const zoom = map.getZoom();
    const visualScale = 70;
    const traveled = t*0.001*U*visualScale;
    const trails = [];
    const heads = [];
    const streams = [];

    windModel.globalStreams.forEach(s=>streams.push(s));
    windModel.localStreams.forEach(s=>streams.push(s));
    if(windModel.selectedStream) streams.push(windModel.selectedStream);

    streams.forEach((s,streamIndex)=>{
      const length = Math.max(s.lengthM || pathLength(s.path),1);
      const spacing = particleSpacing(s.kind || 'global',zoom);
      const count = clamp(Math.round(length/spacing),2,s.kind==='selected'?24:30);
      const trailM = s.kind==='selected' ? clamp(speed*18,170,650) : clamp(speed*13,120,520);
      const seed = ((streamIndex*0.61803398875)+(s.phase||0))%1;

      for(let k=0;k<count;k++){
        const offsetM = ((k/count+seed)%1)*length;
        const headDist = (traveled+offsetM)%length;
        const headNorm = headDist/length;
        const samples = [];
        for(let j=3;j>=0;j--){
          const d = headDist-trailM*(j/3);
          const smp = sampleStream(s,d/length);
          if(smp) samples.push(smp.position);
        }
        const head = sampleStream(s,headNorm);
        if(!head || samples.length<2) continue;
        const c = colorFor(head.value.w,head.value.wake);
        trails.push({path:samples,color:c,kind:s.kind||'global'});
        heads.push({position:head.position,color:c,kind:s.kind||'global'});
      }
    });

    return {trails,heads};
  }

  function renderDeck(t){
    if(!overlay) return;
    const layers = [];

    if($('windLines').checked){
      layers.push(new PathLayer({
        id:'wind-global-guides', data:windModel.globalSegments,
        getPath:d=>[d.a,d.b], getColor:d=>guideColor(d.color,55),
        getWidth:1.0, widthUnits:'pixels', jointRounded:true, capRounded:true,
        pickable:false, parameters:{depthTest:true}
      }));

      if(windModel.localSegments.length){
        layers.push(new PathLayer({
          id:'wind-local-guides', data:windModel.localSegments,
          getPath:d=>[d.a,d.b], getColor:d=>guideColor(d.color,45),
          getWidth:0.9, widthUnits:'pixels', jointRounded:true, capRounded:true,
          pickable:false, parameters:{depthTest:true}
        }));
      }
    }

    const particles = particleVisualData(t);
    if($('particles').checked && particles.trails.length){
      layers.push(new PathLayer({
        id:'wind-particle-trails', data:particles.trails,
        getPath:d=>d.path,
        getColor:d=>d.color,
        getWidth:d=>d.kind==='selected'?3.4:d.kind==='local'?2.2:1.9,
        widthUnits:'pixels', jointRounded:true, capRounded:true,
        pickable:false, parameters:{depthTest:true}
      }));
      layers.push(new ScatterplotLayer({
        id:'wind-particle-heads', data:particles.heads,
        getPosition:d=>d.position,
        getFillColor:d=>d.color,
        getRadius:d=>d.kind==='selected'?2.9:2.1,
        radiusUnits:'pixels', stroked:false, filled:true,
        pickable:false, parameters:{depthTest:true}
      }));
    }

    if(windModel.selectedSegments.length){
      layers.push(new PathLayer({
        id:'selected-halo', data:windModel.selectedSegments,
        getPath:d=>[d.a,d.b], getColor:[255,255,255,205],
        getWidth:6.2, widthUnits:'pixels', jointRounded:true, capRounded:true,
        pickable:false, parameters:{depthTest:true}
      }));
      layers.push(new PathLayer({
        id:'selected-flow', data:windModel.selectedSegments,
        getPath:d=>[d.a,d.b], getColor:d=>d.color,
        getWidth:3.2, widthUnits:'pixels', jointRounded:true, capRounded:true,
        pickable:false, parameters:{depthTest:true}
      }));
    }

    if(pointerInfo){
      layers.push(new ScatterplotLayer({
        id:'probe', data:[pointerInfo],
        getPosition:d=>[d.lon,d.lat,d.z],
        getFillColor:[255,255,255,235], getLineColor:[10,10,10,220],
        stroked:true, filled:true, getRadius:6.5, radiusUnits:'pixels',
        lineWidthMinPixels:1.3, pickable:false
      }));
    }

    overlay.setProps({layers});
  }

  function animate(t){
    renderDeck(t);
    animId = requestAnimationFrame(animate);
  }

  function addAreaBox(){
    const nw=[areaSW[0],areaNE[1]], se=[areaNE[0],areaSW[1]];
    map.addSource('study-area',{type:'geojson',data:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[areaSW,se,areaNE,nw,areaSW]}}]}});
    map.addLayer({id:'study-area',type:'line',source:'study-area',paint:{'line-color':'rgba(255,255,255,.55)','line-width':1.2,'line-dasharray':[3,3]}});
  }

  function updateUI(){
    const d = +$('direction').value;
    const s = +$('speed').value;
    const flow = (d+180)%360;
    const label = compassLabel(d);
    $('dirDeg').textContent = d+'°';
    $('dirLabel').textContent = label;
    $('chipDir').textContent = label;
    $('chipSpeed').textContent = s;
    $('speedLabel').textContent = s;
    $('flowDir').textContent = flow+'°';
    $('densityLabel').textContent = $('density').value;
    $('exagLabel').textContent = (+$('exag').value).toFixed(2)+'×';
    $('windArrow').style.transform = `rotate(${flow}deg)`;
    document.querySelectorAll('.compass button').forEach(b=>b.classList.toggle('active',+b.dataset.dir===d));
  }

  function scheduleRecalc(delay=160){
    updateUI();
    clearTimeout(recalcTimer);
    recalcTimer = setTimeout(()=>buildWindModel(true),delay);
  }

  function scheduleLocalDetail(delay=220){
    clearTimeout(localTimer);
    localTimer = setTimeout(()=>{
      buildLocalDetail();
      if(selectedPoint) buildSelectedStream(false);
      renderDeck(performance.now());
    },delay);
  }

  document.querySelectorAll('.compass button').forEach(b=>b.addEventListener('click',()=>{
    $('direction').value = b.dataset.dir;
    scheduleRecalc(60);
  }));
  $('direction').addEventListener('input',()=>scheduleRecalc(180));
  $('speed').addEventListener('input',()=>{ updateUI(); scheduleRecalc(180); });
  $('density').addEventListener('input',()=>scheduleRecalc(220));
  $('stability').addEventListener('change',()=>scheduleRecalc(80));
  $('exag').addEventListener('input',()=>{
    updateUI();
    map.setTerrain({source:'terrain',exaggeration:getExag()});
    scheduleRecalc(220);
  });
  $('particles').addEventListener('change',()=>renderDeck(performance.now()));
  $('windLines').addEventListener('change',()=>renderDeck(performance.now()));
  $('hillshade').addEventListener('change',()=>map.setLayoutProperty('hillshade','visibility',$('hillshade').checked?'visible':'none'));
  $('ortho').addEventListener('change',()=>map.setLayoutProperty('ortho','visibility',$('ortho').checked?'visible':'none'));
  $('recalc').addEventListener('click',()=>buildWindModel(true));
  $('resetView').addEventListener('click',()=>map.fitBounds([areaSW,areaNE],{padding:{top:90,bottom:75,left:400,right:90},pitch:64,bearing:28,duration:1200}));

  const tip = $('tip');
  map.on('mousemove',e=>{
    if(!map.isStyleLoaded()) return;
    const elev = terrainElev(e.lngLat.lng,e.lngLat.lat);
    if(elev===null) return;
    const probe = clamp((localDetailConfig().step || 180),70,220);
    const local = localFlowAt(e.lngLat.lng,e.lngLat.lat,+$('direction').value,+$('speed').value,probe);
    tip.style.display='block';
    tip.style.left=(e.originalEvent.clientX+12)+'px';
    tip.style.top=(e.originalEvent.clientY+12)+'px';
    tip.innerHTML=`<b>${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}</b><br>Terreno: ${Math.round(elev)} m${local?`<br>w orográfica: ${(local.w>=0?'+':'')+local.w.toFixed(1)} m/s`:''}<br><span style="opacity:.75">clic: línea puntual</span>`;
  });
  map.on('mouseleave',()=>tip.style.display='none');

  map.on('click',e=>{
    const z = terrainElev(e.lngLat.lng,e.lngLat.lat);
    if(z===null){
      setStatus('Aún no hay elevación cargada en ese punto. Espera a que termine de cargar el MDT.','loading');
      return;
    }

    selectedPoint = {lon:e.lngLat.lng,lat:e.lngLat.lat};
    buildSelectedStream(true);
    renderDeck(performance.now());

    const probe = clamp((localDetailConfig().step || 180),70,220);
    const local = localFlowAt(e.lngLat.lng,e.lngLat.lat,+$('direction').value,+$('speed').value,probe);
    if(clickPopup) clickPopup.remove();
    const details = local
      ? `<br>Altitud: <strong>${Math.round(local.elev)} m</strong><br>w estimada: <strong>${(local.w>=0?'+':'')+local.w.toFixed(1)} m/s</strong><br>${classFor(local.w,0)}`
      : '';
    clickPopup = new maplibregl.Popup({offset:14,closeButton:true,closeOnClick:false})
      .setLngLat([e.lngLat.lng,e.lngLat.lat])
      .setHTML(`<b>Línea puntual de viento</b>${details}<br><small>${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}</small>`)
      .addTo(map);
  });

  map.on('load',()=>{
    addAreaBox();
    overlay = new MapboxOverlay({interleaved:true,layers:[]});
    map.addControl(overlay);
    map.fitBounds([areaSW,areaNE],{padding:{top:90,bottom:80,left:390,right:90},pitch:64,bearing:28,duration:0});
    updateUI();
    updateLocalDetailLabel(localDetailConfig());
    setTimeout(()=>buildWindModel(true),1300);
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(animate);
  });

  map.on('moveend',()=>scheduleLocalDetail(260));
  map.on('zoomend',()=>scheduleLocalDetail(180));
  map.on('idle',()=>{
    if(windModel.globalStreams.length===0 && !modelBusy) buildWindModel(true);
  });
  map.on('error',e=>{
    console.warn('Map error',e.error||e);
    const msg = (e.error&&e.error.message||'').toLowerCase();
    if(msg.includes('terrain') || msg.includes('raster-dem')) setStatus('Error al cargar el MDT; comprueba conexión.','err');
  });
})();
