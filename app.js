(() => {
  'use strict';
  const SITE = { lon:-5.979353098143796, lat:40.13618392931326, name:'Pico Pitolero' };
  const AREA_KM = 40;
  const DEM_URL = 'https://xyz-mdt.idee.es/1.0.0/raster-dem/{z}/{x}/{y}.png';
  const ORTHO_URL = 'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{y}.jpeg';
  const BASE_URL = 'https://tms-ign-base.idee.es/1.0.0/IGNBaseTodo/{z}/{x}/{y}.jpeg';
  const $ = id => document.getElementById(id);
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const rad=d=>d*Math.PI/180, deg=r=>r*180/Math.PI;

  function destination(lon,lat,bearingDeg,distM){
    const R=6371008.8, br=rad(bearingDeg), d=distM/R, p1=rad(lat), l1=rad(lon);
    const p2=Math.asin(Math.sin(p1)*Math.cos(d)+Math.cos(p1)*Math.sin(d)*Math.cos(br));
    const l2=l1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(p1),Math.cos(d)-Math.sin(p1)*Math.sin(p2));
    return [((deg(l2)+540)%360)-180,deg(p2)];
  }
  function compassLabel(d){ const names=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO']; return names[Math.round(((d%360)+360)%360/22.5)%16]; }
  function colorFor(w,wake){ if(wake>0.65) return [255,184,77,220]; if(w>0.55) return [53,226,127,225]; if(w<-0.55) return [255,92,108,225]; return [90,200,250,190]; }
  function classFor(w,wake){ if(wake>0.65) return 'estela / rotor probable'; if(w>0.55) return 'ascendencia orográfica'; if(w<-0.55) return 'descendencia / sotavento'; return 'flujo casi neutro'; }

  const areaSW = destination(...destination(SITE.lon,SITE.lat,180,AREA_KM*500),270,AREA_KM*500);
  const areaNE = destination(...destination(SITE.lon,SITE.lat,0,AREA_KM*500),90,AREA_KM*500);

  const style={version:8,sources:{
    ignbase:{type:'raster',tiles:[BASE_URL],tileSize:256,scheme:'tms',maxzoom:18,attribution:'© IGN/CNIG · CC BY 4.0 scne.es'},
    pnoa:{type:'raster',tiles:[ORTHO_URL],tileSize:256,scheme:'tms',maxzoom:19,attribution:'PNOA máxima actualidad · IGN/CNIG'},
    terrain:{type:'raster-dem',tiles:[DEM_URL],tileSize:512,minzoom:5,maxzoom:15,encoding:'mapbox',attribution:'MDT05 LiDAR · IGN/CNIG · CC BY 4.0 scne.es'}
  },layers:[
    {id:'base',type:'raster',source:'ignbase',paint:{'raster-opacity':1}},
    {id:'ortho',type:'raster',source:'pnoa',paint:{'raster-opacity':0.72,'raster-saturation':-0.12,'raster-contrast':0.08}},
    {id:'hillshade',type:'hillshade',source:'terrain',paint:{'hillshade-exaggeration':0.35,'hillshade-shadow-color':'#071017','hillshade-highlight-color':'#fff4d8','hillshade-accent-color':'#3b4a54'}}
  ],terrain:{source:'terrain',exaggeration:1.35}};

  const map=new maplibregl.Map({container:'map',style,center:[SITE.lon,SITE.lat],zoom:10.15,pitch:66,bearing:28,maxPitch:85,maxZoom:18,antialias:true,hash:false});
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true,showCompass:true,showZoom:true}),'top-right');
  map.addControl(new maplibregl.ScaleControl({maxWidth:120,unit:'metric'}),'bottom-right');

  const markerEl=document.createElement('div'); markerEl.className='site-marker'; markerEl.title='Pico Pitolero';
  new maplibregl.Marker({element:markerEl,anchor:'center'}).setLngLat([SITE.lon,SITE.lat]).setPopup(new maplibregl.Popup({offset:14}).setHTML('<b>Pico Pitolero</b><br>Cabezabellosa · Cáceres')).addTo(map);

  let overlay=null, windModel={streams:[],segments:[],particles:[]}, animId=0, modelBusy=false, lastModelKey='';
  let pointerInfo=null;
  const {MapboxOverlay,PathLayer,ScatterplotLayer}=deck;

  function setStatus(text,state='loading'){ $('statusText').textContent=text; $('statusDot').className='dot '+(state==='ok'?'ok':state==='err'?'err':''); }
  function getExag(){return +$('exag').value}
  function terrainElev(lon,lat){
    try{ const v=map.queryTerrainElevation([lon,lat],{exaggerated:false}); return Number.isFinite(v)?v:null; }catch(e){ return null; }
  }
  function stabilityParams(){
    const s=$('stability').value;
    if(s==='stable') return {lift:1.08,wake:1.45,steer:1.25,mix:0.72};
    if(s==='unstable') return {lift:0.82,wake:0.52,steer:0.75,mix:1.35};
    return {lift:0.96,wake:1.0,steer:1.0,mix:1.0};
  }
  function localFlowAt(lon,lat,fromDeg,speedKmh){
    const flow=(fromDeg+180)%360, U=speedKmh/3.6, p=stabilityParams(), probe=450;
    const a=destination(lon,lat,(flow+180)%360,probe), b=destination(lon,lat,flow,probe);
    const h0=terrainElev(lon,lat), ha=terrainElev(a[0],a[1]), hb=terrainElev(b[0],b[1]);
    if([h0,ha,hb].some(v=>v===null)) return null;
    const slope=(hb-ha)/(2*probe);
    const w=clamp(U*slope*1.55*p.lift,-5.5,5.5);
    return {elev:h0,w,slope};
  }

  async function buildWindModel(force=false){
    if(modelBusy) return; modelBusy=true;
    const from=+$('direction').value, speed=+$('speed').value, density=+$('density').value, exag=getExag(), stab=$('stability').value;
    const key=[from,speed,density,exag,stab].join('|'); if(!force && key===lastModelKey){modelBusy=false;return;} lastModelKey=key;
    setStatus('Calculando flujo sobre el MDT…');
    await new Promise(r=>setTimeout(r,30));
    const flow=(from+180)%360, U=speed/3.6, p=stabilityParams();
    const streams=[],segments=[];
    const crossSpan=34000, alongStart=-27000, alongEnd=27000, step=900, crossStep=crossSpan/(density-1);
    let validCount=0;
    for(let si=0;si<density;si++){
      const cross=-crossSpan/2+si*crossStep;
      let pos=destination(SITE.lon,SITE.lat,(flow+270)%360,cross);
      pos=destination(pos[0],pos[1],(flow+180)%360,-alongStart);
      let bearing=flow, crest=-Infinity, crestAge=9999, airAlt=null, path=[], values=[];
      for(let along=alongStart;along<=alongEnd;along+=step){
        const ground=terrainElev(pos[0],pos[1]);
        if(ground===null){ pos=destination(pos[0],pos[1],bearing,step); continue; }
        validCount++;
        const ahead=destination(pos[0],pos[1],bearing,420), left=destination(pos[0],pos[1],(bearing+270)%360,420), right=destination(pos[0],pos[1],(bearing+90)%360,420);
        const hA=terrainElev(ahead[0],ahead[1]), hL=terrainElev(left[0],left[1]), hR=terrainElev(right[0],right[1]);
        const alongSlope=(hA===null?0:(hA-ground)/420);
        const crossSlope=(hL===null||hR===null?0:(hR-hL)/840);
        const climb=clamp(U*alongSlope*1.55*p.lift,-5.5,5.5);
        if(ground>crest){crest=ground;crestAge=0}else crestAge+=step;
        const drop=Math.max(0,crest-ground), wakeRaw=drop/650*Math.exp(-crestAge/(5200*p.mix));
        const wake=clamp(wakeRaw*p.wake*(speed/25),0,1.4);
        const w=clamp(climb - wake*1.15,-6,6);
        const minAgl=145+speed*2.2;
        if(airAlt===null) airAlt=ground+minAgl;
        const dt=step/Math.max(U,2.2);
        airAlt += w*dt*0.36;
        airAlt += (ground+minAgl-airAlt)*0.22;
        airAlt=Math.max(airAlt,ground+95);
        const z=ground*exag+(airAlt-ground);
        const point=[pos[0],pos[1],z]; path.push(point); values.push({w,wake,ground});
        if(path.length>1){segments.push({a:path[path.length-2],b:point,color:colorFor(w,wake),w,wake});}
        const turn=clamp(-crossSlope*140*p.steer,-4.0,4.0);
        bearing=(bearing+turn+360)%360;
        pos=destination(pos[0],pos[1],bearing,step);
      }
      if(path.length>4) streams.push({path,values,phase:si/Math.max(1,density)});
    }
    windModel={streams,segments};
    renderDeck(0);
    const site=localFlowAt(SITE.lon,SITE.lat,from,speed);
    if(site){ $('siteElev').textContent=Math.round(site.elev)+' m'; $('siteW').textContent=(site.w>=0?'+':'')+site.w.toFixed(1)+' m/s'; $('siteClass').textContent=classFor(site.w,0); }
    setStatus(validCount>100?'MDT cargado · flujo actualizado':'Esperando más teselas del MDT…',validCount>100?'ok':'loading');
    modelBusy=false;
  }

  function particleData(t){
    if(!$('particles').checked) return [];
    const speed=+$('speed').value; const out=[];
    windModel.streams.forEach((s,idx)=>{
      for(let k=0;k<3;k++){
        const phase=(t*0.000035*(0.6+speed/30)+s.phase+k/3)%1;
        const f=phase*(s.path.length-1), i=Math.floor(f), q=f-i, a=s.path[i], b=s.path[Math.min(i+1,s.path.length-1)];
        if(!a||!b) continue;
        const pos=[a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q,a[2]+(b[2]-a[2])*q+18];
        const val=s.values[Math.min(i,s.values.length-1)]||{w:0,wake:0}; out.push({position:pos,color:colorFor(val.w,val.wake)});
      }
    }); return out;
  }
  function renderDeck(t){
    if(!overlay) return;
    const layers=[];
    if($('windLines').checked) layers.push(new PathLayer({id:'wind-segments',data:windModel.segments,getPath:d=>[d.a,d.b],getColor:d=>d.color,getWidth:2.2,widthUnits:'pixels',jointRounded:true,capRounded:true,pickable:false,parameters:{depthTest:true}}));
    if($('particles').checked) layers.push(new ScatterplotLayer({id:'wind-particles',data:particleData(t),getPosition:d=>d.position,getFillColor:d=>d.color,getLineColor:[255,255,255,180],lineWidthMinPixels:0.7,stroked:true,filled:true,getRadius:3.4,radiusUnits:'pixels',pickable:false,parameters:{depthTest:true}}));
    if(pointerInfo) layers.push(new ScatterplotLayer({id:'probe',data:[pointerInfo],getPosition:d=>[d.lon,d.lat,d.z],getFillColor:[255,255,255,220],getLineColor:[10,10,10,200],stroked:true,getRadius:6,radiusUnits:'pixels',lineWidthMinPixels:1.2}));
    overlay.setProps({layers});
  }
  function animate(t){renderDeck(t);animId=requestAnimationFrame(animate)}

  function addAreaBox(){
    const nw=[areaSW[0],areaNE[1]], se=[areaNE[0],areaSW[1]];
    map.addSource('study-area',{type:'geojson',data:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[areaSW,se,areaNE,nw,areaSW]}}]}});
    map.addLayer({id:'study-area',type:'line',source:'study-area',paint:{'line-color':'rgba(255,255,255,.55)','line-width':1.2,'line-dasharray':[3,3]}});
  }

  function updateUI(){
    const d=+$('direction').value,s=+$('speed').value,flow=(d+180)%360,label=compassLabel(d);
    $('dirDeg').textContent=d+'°'; $('dirLabel').textContent=label; $('chipDir').textContent=label; $('chipSpeed').textContent=s; $('speedLabel').textContent=s; $('flowDir').textContent=flow+'°'; $('densityLabel').textContent=$('density').value; $('exagLabel').textContent=(+$('exag').value).toFixed(2)+'×';
    $('windArrow').style.transform=`rotate(${flow}deg)`;
    document.querySelectorAll('.compass button').forEach(b=>b.classList.toggle('active',+b.dataset.dir===d));
  }
  let recalcTimer=0; function scheduleRecalc(delay=160){updateUI();clearTimeout(recalcTimer);recalcTimer=setTimeout(()=>buildWindModel(true),delay)}

  document.querySelectorAll('.compass button').forEach(b=>b.addEventListener('click',()=>{$('direction').value=b.dataset.dir;scheduleRecalc(60)}));
  $('direction').addEventListener('input',()=>scheduleRecalc(180)); $('speed').addEventListener('input',()=>scheduleRecalc(180)); $('density').addEventListener('input',()=>scheduleRecalc(220)); $('stability').addEventListener('change',()=>scheduleRecalc(80));
  $('exag').addEventListener('input',()=>{updateUI();map.setTerrain({source:'terrain',exaggeration:getExag()});scheduleRecalc(220)});
  $('particles').addEventListener('change',()=>renderDeck(performance.now())); $('windLines').addEventListener('change',()=>renderDeck(performance.now()));
  $('hillshade').addEventListener('change',()=>map.setLayoutProperty('hillshade','visibility',$('hillshade').checked?'visible':'none'));
  $('ortho').addEventListener('change',()=>map.setLayoutProperty('ortho','visibility',$('ortho').checked?'visible':'none'));
  $('recalc').addEventListener('click',()=>buildWindModel(true));
  $('resetView').addEventListener('click',()=>map.fitBounds([areaSW,areaNE],{padding:{top:90,bottom:75,left:400,right:90},pitch:64,bearing:28,duration:1200}));

  const tip=$('tip');
  map.on('mousemove',e=>{
    if(!map.isStyleLoaded())return;
    const elev=terrainElev(e.lngLat.lng,e.lngLat.lat); if(elev===null)return;
    const local=localFlowAt(e.lngLat.lng,e.lngLat.lat,+$('direction').value,+$('speed').value);
    tip.style.display='block';tip.style.left=(e.originalEvent.clientX+12)+'px';tip.style.top=(e.originalEvent.clientY+12)+'px';
    tip.innerHTML=`<b>${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}</b><br>Terreno: ${Math.round(elev)} m${local?`<br>w orográfica: ${(local.w>=0?'+':'')+local.w.toFixed(1)} m/s`:''}`;
  });
  map.on('mouseleave',()=>tip.style.display='none');
  map.on('click',e=>{const z=terrainElev(e.lngLat.lng,e.lngLat.lat); if(z!==null){pointerInfo={lon:e.lngLat.lng,lat:e.lngLat.lat,z:z*getExag()+25};renderDeck(performance.now());}});

  map.on('load',()=>{
    addAreaBox();
    overlay=new MapboxOverlay({interleaved:true,layers:[]}); map.addControl(overlay);
    map.fitBounds([areaSW,areaNE],{padding:{top:90,bottom:80,left:390,right:90},pitch:64,bearing:28,duration:0});
    updateUI();
    setTimeout(()=>buildWindModel(true),1300);
    cancelAnimationFrame(animId);animId=requestAnimationFrame(animate);
  });
  map.on('idle',()=>{ if(windModel.streams.length===0 && !modelBusy) buildWindModel(true); });
  map.on('error',e=>{console.warn('Map error',e.error||e); if((e.error&&e.error.message||'').toLowerCase().includes('terrain')) setStatus('Error al cargar el MDT; comprueba conexión.', 'err');});
})();
