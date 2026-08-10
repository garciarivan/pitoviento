# Diseño: relieve y viento muy marcados

## Contexto

La versión desplegada ya recibe el campo aerológico, activa el terreno y ejecuta el renderer GPU. Sin embargo, el preset actual prioriza discreción: usa 8.000 partículas de 1,8 px y una exageración de terreno de 1,45. Sobre la ortofoto clara, el viento apenas se distingue y la deformación del relieve parece plana.

## Objetivo

Crear un preset visual deliberadamente intenso en el que el relieve y el movimiento del viento sean evidentes a primera vista, aceptando una representación menos realista a cambio de legibilidad.

## Terreno y cámara

- Aumentar la exageración del terreno de `1.45` a `3.2`.
- Elevar la exageración del hillshade de `0.42` a aproximadamente `0.75`.
- Oscurecer sombras y reforzar acentos del hillshade sin ocultar nombres ni referencias geográficas.
- Reducir la opacidad de la ortofoto de `0.74` a aproximadamente `0.62`, permitiendo que el sombreado del relieve domine.
- Usar una cámara inicial cercana a `zoom 10.8`, `pitch 74` y un bearing que mantenga visible el corredor montañoso principal.

El terreno conservará la fuente DEM real del IGN; sólo cambia su exageración visual.

## Partículas

- Dibujar 14.000 partículas en escritorio y 7.000 en móvil.
- Aumentar el punto a aproximadamente 3 px.
- Mantener la posición y altitud basadas en el campo y la elevación reales.
- Sustituir el círculo plano por un sprite procedural con halo suave y núcleo claro.
- Saturar los colores existentes: azul para flujo casi horizontal, verde para ascenso y rojo para descenso.
- Mantener oclusión 3D y mezcla alfa premultiplicada compatible con MapLibre.

El halo no deberá convertir el campo en una capa opaca: deben seguir distinguiéndose partículas individuales y ortofoto entre ellas.

## Rendimiento y adaptación

- Conservar el cálculo y la advección en WebGL2.
- Reducir a la mitad la densidad en pantallas de hasta 720 px.
- No añadir buffers de historial ni estelas largas en esta iteración.
- Mantener una sola llamada de render por frame y reutilizar los buffers actuales.

## Estados y errores

No cambia el flujo de API ni los estados separados de mapa, terreno y GPU. Un error del shader nuevo seguirá apareciendo como error GPU y no bloqueará la petición del campo.

## Verificación

- Compilación de producción sin errores.
- Carga limpia en navegador sin mensajes de consola.
- Capturas de escritorio y móvil donde la silueta 3D de laderas/valles sea inequívoca.
- Partículas distinguibles a primera vista sobre zonas claras, oscuras y nevadas.
- Dos capturas separadas en el tiempo que confirmen movimiento.
- Comprobación de que el panel sigue informando campo recibido, partículas renderizándose y relieve activo.
- Comprobación manual de que la interacción del mapa sigue siendo fluida en escritorio y utilizable en móvil.

## Fuera de alcance

- Estelas persistentes.
- Heatmap continuo del viento.
- Cambios al modelo aerológico o al backend.
