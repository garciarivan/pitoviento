(() => {
  'use strict';

  const panel=document.getElementById('detailPanel');
  const closeButton=document.getElementById('detailClose');
  if(!panel||!closeButton||!window.maplibregl||!maplibregl.Popup) return;

  let activePopup=null;
  const popupProto=maplibregl.Popup.prototype;
  const originalSetHTML=popupProto.setHTML;
  const originalAddTo=popupProto.addTo;

  const decode=value=>{
    const el=document.createElement('div');
    el.innerHTML=value||'';
    return (el.textContent||'').trim();
  };

  const match=(html,re,fallback='—')=>{
    const m=html.match(re);
    return m&&m[1]?decode(m[1]):fallback;
  };

  function setStateClass(text){
    const el=document.getElementById('detailClass');
    el.className='detail-class';
    const normalized=(text||'').toLowerCase();
    if(normalized.includes('ascendencia')) el.classList.add('up-state');
    else if(normalized.includes('descendencia')) el.classList.add('down-state');
    else if(normalized.includes('estela')||normalized.includes('rotor')) el.classList.add('wake-state');
  }

  function showDetail(html,popup){
    activePopup=popup;

    const altitude=match(html,/Altitud:\s*<strong>([^<]+)<\/strong>/i);
    const speed=match(html,/Velocidad local:\s*<strong>([^<]+)<\/strong>/i);
    const bearing=match(html,/Rumbo local:\s*<strong>([^<]+)<\/strong>/i);
    const w=match(html,/w estimada:\s*<strong>([^<]+)<\/strong>/i);
    const venturi=match(html,/Velocidad local:[\s\S]*?<small>\((Venturi[^<]+)\)<\/small>/i,'sin aceleración');
    const channel=match(html,/Rumbo local:[\s\S]*?<small>\((canal[^<]+)\)<\/small>/i,'sin desvío apreciable');
    const classification=match(html,/w estimada:\s*<strong>[^<]+<\/strong><br>([^<]+)<br><small>/i,'flujo casi neutro');
    const coords=match(html,/<small>(-?\d+\.\d+\s*,\s*-?\d+\.\d+)<\/small>\s*$/i);

    document.getElementById('detailElev').textContent=altitude;
    document.getElementById('detailSpeed').textContent=speed;
    document.getElementById('detailBearing').textContent=bearing;
    document.getElementById('detailW').textContent=w;
    document.getElementById('detailVenturi').textContent=venturi.replace(/^Venturi\s*/i,'');
    document.getElementById('detailChannel').textContent=channel.replace(/^canal\s*/i,'');
    document.getElementById('detailCoords').textContent=coords;
    document.getElementById('detailClass').textContent=classification;
    setStateClass(classification);

    panel.classList.add('open');
    panel.setAttribute('aria-hidden','false');
  }

  function hideDetail(){
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden','true');
  }

  popupProto.setHTML=function(html){
    if(typeof html==='string'&&html.includes('Detalle puntual de viento')){
      this.__pitovientoDetail=true;
      this.__pitovientoDetailHTML=html;
    }
    return originalSetHTML.call(this,html);
  };

  popupProto.addTo=function(map){
    const result=originalAddTo.call(this,map);
    if(this.__pitovientoDetail){
      const el=this.getElement&&this.getElement();
      if(el) el.classList.add('pitoviento-detail-source');
      showDetail(this.__pitovientoDetailHTML||'',this);
      this.on('close',()=>{
        if(activePopup===this){
          activePopup=null;
          hideDetail();
        }
      });
    }
    return result;
  };

  closeButton.addEventListener('click',()=>{
    if(activePopup) activePopup.remove();
    else hideDetail();
  });

  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&activePopup) activePopup.remove();
  });
})();
