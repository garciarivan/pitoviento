(() => {
  'use strict';

  const mobileMq=window.matchMedia('(max-width:720px)');
  const isMobile=mobileMq.matches;
  const lowPower=(navigator.hardwareConcurrency&&navigator.hardwareConcurrency<=4)||(navigator.deviceMemory&&navigator.deviceMemory<=4)||(navigator.connection&&navigator.connection.saveData);

  /*
   * Importante: NO limitamos el requestAnimationFrame global de MapLibre.
   * La versión anterior ralentizaba también el propio mapa. Aquí solo
   * limitamos el bucle de partículas de Pitoviento (callback llamado animate).
   */
  const nativeRAF=window.requestAnimationFrame.bind(window);
  const nativeCAF=window.cancelAnimationFrame.bind(window);
  const nativeSetTimeout=window.setTimeout.bind(window);
  const nativeClearTimeout=window.clearTimeout.bind(window);
  let nextParticleId=-1;
  const particleJobs=new Map();
  let mapInteracting=false;

  function particleInterval(){
    if(document.hidden) return 1000;
    if(isMobile&&document.body.classList.contains('controls-open')) return 500;
    if(isMobile&&mapInteracting) return 100;
    if(isMobile) return lowPower?85:62;   // ~12–16 fps
    return 33;                            // ~30 fps escritorio
  }

  function isPitovientoParticleLoop(callback){
    return typeof callback==='function'&&callback.name==='animate';
  }

  window.requestAnimationFrame=callback=>{
    if(!isPitovientoParticleLoop(callback)) return nativeRAF(callback);

    const id=nextParticleId--;
    const job={timeoutId:0,nativeId:0,cancelled:false};
    particleJobs.set(id,job);
    job.timeoutId=nativeSetTimeout(()=>{
      if(job.cancelled) return;
      job.nativeId=nativeRAF(ts=>{
        particleJobs.delete(id);
        if(!job.cancelled) callback(ts);
      });
    },particleInterval());
    return id;
  };

  window.cancelAnimationFrame=id=>{
    if(id<0&&particleJobs.has(id)){
      const job=particleJobs.get(id);
      job.cancelled=true;
      nativeClearTimeout(job.timeoutId);
      if(job.nativeId) nativeCAF(job.nativeId);
      particleJobs.delete(id);
      return;
    }
    nativeCAF(id);
  };

  function isolateScrollable(el){
    if(!el) return;
    ['touchstart','touchmove','touchend','pointerdown','pointermove','pointerup','wheel'].forEach(type=>{
      el.addEventListener(type,event=>event.stopPropagation(),{passive:true});
    });
  }

  window.addEventListener('DOMContentLoaded',()=>{
    isolateScrollable(document.getElementById('controlPanel'));
    isolateScrollable(document.getElementById('detailPanel'));

    const mapEl=document.getElementById('map');
    if(mapEl){
      const start=()=>{mapInteracting=true;};
      const stop=()=>{mapInteracting=false;};
      mapEl.addEventListener('pointerdown',start,{passive:true});
      mapEl.addEventListener('touchstart',start,{passive:true});
      window.addEventListener('pointerup',stop,{passive:true});
      window.addEventListener('pointercancel',stop,{passive:true});
      window.addEventListener('touchend',stop,{passive:true});
      window.addEventListener('touchcancel',stop,{passive:true});
    }
  },{once:true});
})();
