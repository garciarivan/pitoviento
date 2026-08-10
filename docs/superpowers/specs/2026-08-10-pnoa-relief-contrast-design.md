# Contraste del relieve con ortofoto PNOA

## Objetivo

Conservar la ortofoto PNOA como textura principal y hacer que la orografía sea inequívoca a primera vista. El ajuste no modifica la API, el modelo de viento, el panel ni la semántica de colores de las trazas.

## Diagnóstico

La fuente `raster-dem` del IGN está cargando y MapLibre deforma la malla, pero la escena publicada pierde volumen por tres causas combinadas: la ortofoto queda demasiado clara, el `hillshade` añade luces blanquecinas y la atmósfera funde el horizonte con el terreno. La cámara actual mira una superficie visualmente suave en vez de presentar una ladera contra el horizonte.

## Diseño visual aprobado

- Mantener PNOA visible por defecto con opacidad entre 0,90 y 0,95.
- Oscurecer la ortofoto mediante `raster-brightness-max`, aumentar moderadamente `raster-contrast` y conservar suficiente saturación para reconocer carreteras, vegetación y núcleos.
- Mantener `hillshade`, con sombras oscuras y luces de baja opacidad para marcar barrancos sin cubrir la fotografía.
- Reducir al mínimo la mezcla de niebla con el suelo y el blanqueo del horizonte. El cielo seguirá siendo azul, pero la silueta del terreno deberá conservar contraste.
- Elevar la exageración inicial a 2,5× y ampliar el control hasta 3×. El renderer de viento recibirá siempre el mismo valor para conservar la alineación vertical.
- Usar una cámara más baja y cercana, orientada desde el valle hacia la cresta: pitch entre 76° y 80°, zoom entre 14,4 y 14,9 y bearing cercano a 28°. El botón «Vista Pitolero» restaurará esta misma cámara.

## Criterios de aceptación

En una captura de 1827 × 1017, tras cargar las teselas:

1. La cresta y al menos dos laderas o barrancos se distinguen sin accionar controles.
2. La ortofoto PNOA sigue siendo reconocible y no queda sustituida por un mapa hipsométrico.
3. El horizonte no presenta una franja blanca que borre la silueta del terreno.
4. Las trazas permanecen visibles, siguen el relieve exagerado y no aparecen enterradas.
5. El panel muestra 2,50× al iniciar y el deslizador permite llegar a 3,00×.
6. No aparecen errores o advertencias de la aplicación en consola.

En 390 × 844, el mapa seguirá siendo utilizable con el panel cerrado y el indicador superior visible. El panel móvil conservará desplazamiento vertical.

## Verificación

- Ejecutar el build de producción y `git diff --check`.
- Probar la escena con la API real y comprobar el estado de campo, GPU y terreno.
- Comparar una captura de escritorio antes/después con la misma cámara.
- Comprobar el panel cerrado y abierto en el viewport móvil.
