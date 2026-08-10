# Contraste del relieve con ortofoto PNOA

## Objetivo

Conservar la ortofoto PNOA como textura principal y hacer que la orografía sea inequívoca a primera vista. El ajuste no modifica la API, el modelo de viento, el panel ni la semántica de colores de las trazas.

## Diagnóstico

La fuente `raster-dem` del IGN está cargando y MapLibre deforma la malla, pero la escena publicada pierde volumen por tres causas combinadas: la ortofoto queda demasiado clara, el `hillshade` añade luces blanquecinas y la atmósfera funde el horizonte con el terreno. La cámara actual mira una superficie visualmente suave en vez de presentar una ladera contra el horizonte.

## Diseño visual aprobado

- Mantener PNOA visible por defecto con este preset: `raster-opacity: 0.94`, `raster-brightness-min: 0.03`, `raster-brightness-max: 0.72`, `raster-contrast: 0.28` y `raster-saturation: 0.05`.
- Mantener `hillshade` con `hillshade-exaggeration: 0.80`, `hillshade-shadow-color: rgba(4, 12, 18, 0.82)`, `hillshade-highlight-color: rgba(210, 205, 180, 0.18)` y `hillshade-accent-color: rgba(42, 55, 63, 0.65)`. MapLibre no dispone de `hillshade-opacity`; la transparencia se expresa en estos colores.
- Aplicar la atmósfera exacta: `sky-color: #72b6ee`, `sky-horizon-blend: 0.12`, `horizon-color: #b9d8ed`, `horizon-fog-blend: 0.06`, `fog-color: #dbeaf2` y `fog-ground-blend: 0.01`.
- Elevar la exageración inicial a 2,5× y ampliar el control hasta 3×. El renderer de viento recibirá siempre el mismo valor para conservar la alineación vertical.
- Usar exactamente `center: [-5.965, 40.135]`, `zoom: 14.5`, `pitch: 78` y `bearing: 28`. El botón «Vista Pitolero» restaurará esos cuatro valores y la captura de aceptación usará la misma constante.
- La estructura, estilos y demás controles del panel quedan intactos. Sólo se autoriza cambiar el valor inicial del control de exageración a 2,50× y su máximo a 3,00×.

## Criterios de aceptación

En una captura de 1827 × 1017, tras cargar las teselas:

1. El marcador del Pitolero aparece a la izquierda del centro; la cresta ocupa el tercio medio de la escena y se distinguen una ladera bajo el marcador y otra hacia el cuadrante inferior derecho sin accionar controles.
2. La ortofoto PNOA sigue siendo reconocible y no queda sustituida por un mapa hipsométrico.
3. Al comparar con la captura publicada anterior usando la misma cámara, el horizonte no presenta la franja blanca que borraba la transición entre la cresta y el cielo.
4. Las trazas permanecen visibles, siguen el relieve exagerado y no aparecen enterradas.
5. El panel muestra 2,50× al iniciar y el deslizador permite llegar a 3,00×.
6. No aparecen errores o advertencias de la aplicación en consola.

En 390 × 844, el mapa seguirá siendo utilizable con el panel cerrado y el indicador superior visible. El panel móvil conservará desplazamiento vertical.

## Verificación

- Ejecutar el build de producción y `git diff --check`.
- Probar la escena con la API real y comprobar el estado de campo, GPU y terreno.
- Comparar una captura de escritorio antes/después con `center: [-5.965, 40.135]`, `zoom: 14.5`, `pitch: 78` y `bearing: 28`.
- Comprobar el panel cerrado y abierto en el viewport móvil.
