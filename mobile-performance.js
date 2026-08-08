(() => {
  'use strict';

  const mobileMq=window.matchMedia('(max-width:720px)');
  if(!mobileMq.matches) return;

  // En móvil, el mapa 3D + deck.gl puede consumir demasiada CPU/GPU si se
  // renderiza a 60 fps mientras el usuario desplaza el panel. Limitamos los
  // frames a ~25 fps normalmente y a ~8 fps con los controles abiertos.
  const nativeRAF=window.requestAnimationFrame.bind(window);
  const nativeCAF=window.cancelAnimationFrame.bind(window);
  let publicId=1;
  const pending=new Map();

  function intervalMs(){
    if(document.hidden) return 250;
    return document.body.classList.contains('controls-open') ? 120 : 40;
  }

  function schedule(id){
    const item=pending.get(id);
    if(!item) return;
    item.nativeId=nativeRAF(ts=>{
      const current=pending.get(id);
      if(!current) return;
      if(ts-current.startedAt>=intervalMs()){
        pending.delete(id);
        current.callback(ts);
      }else{
        schedule(id);
      }
    });
  }

  window.requestAnimationFrame=callback=>{
    const id=publicId++;
    pending.set(id,{callback,startedAt:performance.now(),nativeId:0});
    schedule(id);
    return id;
  };

  window.cancelAnimationFrame=id=>{
    const item=pending.get(id);
    if(item){
      nativeCAF(item.nativeId);
      pending.delete(id);
    }
  };

  // Impide que los gestos verticales del menú lleguen al canvas de MapLibre.
  // No usamos preventDefault para conservar el scroll nativo/inercial.
  function isolateScrollable(el){
    if(!el) return;
    ['touchstart','touchmove','touchend','pointerdown','pointermove','pointerup','wheel'].forEach(type=>{
      el.addEventListener(type,event=>event.stopPropagation(),{passive:true});
    });
  }

  window.addEventListener('DOMContentLoaded',()=>{
    isolateScrollable(document.getElementById('controlPanel'));
    isolateScrollable(document.getElementById('detailPanel'));
  },{once:true});
})();
