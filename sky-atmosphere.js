(() => {
  'use strict';

  if (!window.maplibregl?.Map || window.__pitovientoAtmosphereInstalled) return;

  const OriginalMap = window.maplibregl.Map;

  function installCloudLayer(map) {
    if (document.getElementById('pitovientoClouds')) return;

    const style = document.createElement('style');
    style.dataset.pitovientoAtmosphere = 'true';
    style.textContent = `
      #pitovientoClouds{
        position:fixed;
        z-index:2;
        pointer-events:none;
        left:-8vw;
        right:-8vw;
        top:-2vh;
        height:36vh;
        opacity:0;
        transform:translate3d(0,0,0);
        transition:opacity .25s ease;
        overflow:hidden;
        mask-image:linear-gradient(to bottom,rgba(0,0,0,.95) 0%,rgba(0,0,0,.82) 58%,transparent 100%);
        -webkit-mask-image:linear-gradient(to bottom,rgba(0,0,0,.95) 0%,rgba(0,0,0,.82) 58%,transparent 100%);
      }
      #pitovientoClouds::before,
      #pitovientoClouds::after{
        content:"";
        position:absolute;
        inset:-18% -10%;
        background-repeat:no-repeat;
        will-change:transform;
      }
      #pitovientoClouds::before{
        opacity:.56;
        filter:blur(16px);
        background-image:
          radial-gradient(ellipse at 12% 45%,rgba(255,255,255,.84) 0 3.5%,rgba(255,255,255,.42) 7%,transparent 14%),
          radial-gradient(ellipse at 31% 28%,rgba(255,255,255,.72) 0 4%,rgba(255,255,255,.32) 8%,transparent 15%),
          radial-gradient(ellipse at 56% 48%,rgba(255,255,255,.78) 0 4.5%,rgba(255,255,255,.30) 9%,transparent 17%),
          radial-gradient(ellipse at 79% 24%,rgba(255,255,255,.76) 0 3.8%,rgba(255,255,255,.28) 8%,transparent 15%),
          radial-gradient(ellipse at 94% 52%,rgba(255,255,255,.68) 0 3.2%,rgba(255,255,255,.24) 7%,transparent 14%);
        animation:pitovientoCloudDrift 95s linear infinite;
      }
      #pitovientoClouds::after{
        opacity:.30;
        filter:blur(24px);
        background-image:
          radial-gradient(ellipse at 22% 56%,rgba(238,248,255,.72) 0 5%,transparent 16%),
          radial-gradient(ellipse at 67% 40%,rgba(238,248,255,.62) 0 5%,transparent 17%),
          radial-gradient(ellipse at 88% 60%,rgba(238,248,255,.58) 0 4%,transparent 15%);
        animation:pitovientoCloudDrift2 140s linear infinite;
      }
      @keyframes pitovientoCloudDrift{
        from{transform:translate3d(-3%,0,0)}
        to{transform:translate3d(4%,1.5%,0)}
      }
      @keyframes pitovientoCloudDrift2{
        from{transform:translate3d(3%,1%,0)}
        to{transform:translate3d(-4%,0,0)}
      }
      @media (max-width:720px){
        #pitovientoClouds{height:31vh}
        #pitovientoClouds::before{filter:blur(12px);opacity:.48}
        #pitovientoClouds::after{display:none}
      }
      @media (prefers-reduced-motion:reduce){
        #pitovientoClouds::before,#pitovientoClouds::after{animation:none}
      }
    `;
    document.head.appendChild(style);

    const clouds = document.createElement('div');
    clouds.id = 'pitovientoClouds';
    clouds.setAttribute('aria-hidden', 'true');
    document.body.appendChild(clouds);

    const updateClouds = () => {
      const pitch = map.getPitch?.() ?? 0;
      const t = Math.max(0, Math.min(1, (pitch - 42) / 30));
      clouds.style.opacity = String(0.34 * t);
      const bearing = map.getBearing?.() ?? 0;
      clouds.style.transform = `translate3d(${Math.sin(bearing * Math.PI / 180) * 1.8}vw,0,0)`;
    };

    map.on('pitch', updateClouds);
    map.on('rotate', updateClouds);
    map.on('remove', () => clouds.remove());
    updateClouds();
  }

  function applyAtmosphere(map) {
    const applySky = () => {
      if (typeof map.setSky !== 'function') return;
      try {
        map.setSky({
          'sky-color': '#79b9f2',
          'sky-horizon-blend': 0.36,
          'horizon-color': '#dceeff',
          'horizon-fog-blend': 0.24,
          'fog-color': '#eff7fd',
          'fog-ground-blend': 0.10
        });
      } catch (error) {
        console.warn('No se pudo aplicar la atmósfera de Pitoviento:', error);
      }
    };

    if (map.isStyleLoaded?.()) applySky();
    map.on('style.load', applySky);
    installCloudLayer(map);
  }

  class AtmosphericMap extends OriginalMap {
    constructor(options) {
      super(options);
      applyAtmosphere(this);
      window.__pitovientoMap = this;
    }
  }

  window.maplibregl.Map = AtmosphericMap;
  window.__pitovientoAtmosphereInstalled = true;
})();
