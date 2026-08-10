# Diseño: relieve y viento muy marcados

## Contexto

La versión desplegada ya recibe el campo aerológico, activa el terreno y ejecuta el renderer GPU. Sin embargo, el preset actual prioriza discreción: usa 8.000 partículas de 1,8 px y una exageración de terreno de 1,45. Sobre la ortofoto clara, el viento apenas se distingue y la deformación del relieve parece plana.

## Objetivo

Crear un preset visual deliberadamente intenso en el que el relieve y el movimiento del viento sean evidentes a primera vista, aceptando una representación menos realista a cambio de legibilidad.

## Terreno y cámara

- Aumentar la exageración del terreno de `1.45` a `3.2`.
- Elevar la exageración del hillshade de `0.42` a aproximadamente `0.75`.
- Oscurecer sombras y reforzar acentos del hillshade. Se acepta que parte de la rotulación raster pierda contraste; no se añadirá una capa de etiquetas independiente en esta iteración.
- Reducir la opacidad de la ortofoto de `0.74` a aproximadamente `0.62`, permitiendo que el sombreado del relieve domine.
- Usar una cámara inicial determinista centrada en el sitio, con `zoom 10.8`, `pitch 74` y `bearing 28`.

El terreno conservará la fuente DEM real del IGN; sólo cambia su exageración visual.

La exageración `3.2` se definirá en una constante compartida por `map.setTerrain()` y el renderer. El shader de dibujo recibirá `u_terrain_exaggeration` y calculará la altitud visual como `field.a * exaggeration + clearance + zOffset`. La advección y el campo conservarán unidades físicas; sólo la proyección vertical seguirá al suelo exagerado. Las partículas no deberán atravesar laderas y sí podrán quedar ocultas detrás de crestas por el depth buffer.

## Partículas

- Dibujar 14.000 partículas en escritorio y 7.000 en móvil.
- Usar un diámetro objetivo de `3.2 CSS px`, convertido a framebuffer con `devicePixelRatio` y limitado al rango soportado por `ALIASED_POINT_SIZE_RANGE`, con máximo operativo de 8 px físicos.
- Mantener la posición y altitud basadas en el campo y la elevación reales.
- Sustituir el círculo plano por un sprite procedural: núcleo claro hasta radio normalizado 0,16; cuerpo saturado hasta 0,30; halo con caída suave hasta 0,50 y alfa máxima aproximada 0,32.
- Saturar los colores existentes: azul para flujo casi horizontal, verde para ascenso y rojo para descenso.
- Mantener oclusión 3D. El fragment shader emitirá `vec4(rgb * alpha, alpha)` y el draw usará `ONE, ONE_MINUS_SRC_ALPHA`. Antes de alterar blend/depth se guardará el estado relevante y se restaurará al terminar para no contaminar capas posteriores de MapLibre.

El halo no deberá convertir el campo en una capa opaca: deben seguir distinguiéndose partículas individuales y ortofoto entre ellas.

## Rendimiento y adaptación

- Conservar el cálculo y la advección en WebGL2.
- Reducir a la mitad la densidad en pantallas de hasta 720 px.
- No añadir buffers de historial ni estelas largas en esta iteración.
- Mantener una invocación del callback `render` de MapLibre por frame y los dos draw calls GPU existentes: transform feedback para advección y dibujo de partículas. Se reutilizarán los buffers actuales.

## Estados y errores

No cambia el flujo de API ni los estados separados de mapa, terreno y GPU. Un error del shader nuevo seguirá apareciendo como error GPU y no bloqueará la petición del campo.

## Verificación

- Compilación de producción sin errores.
- Carga limpia sin errores ni warnings originados por la aplicación; fallos externos transitorios de teselas se informarán por separado.
- Captura de escritorio a 1280×720 y captura móvil a 390×844, ambas con centro del sitio, zoom 10.8, pitch 74 y bearing 28.
- En las capturas, una muestra de 50×50 px sobre zona clara y otra sobre zona oscura deberá contener partículas distinguibles sin convertirse en un relleno opaco continuo.
- Dos capturas de escritorio separadas 1,2 segundos deberán mostrar posiciones diferentes manteniendo la misma cámara.
- Comprobación de que el panel sigue informando campo recibido, partículas renderizándose y relieve activo.
- Medición durante 10 segundos de cámara estática y 10 segundos de paneo: objetivo de al menos 45 FPS de mediana y p95 de intervalo de frame menor o igual a 33 ms en escritorio de prueba. En viewport móvil, objetivo de al menos 30 FPS de mediana y p95 menor o igual a 50 ms.

## Fuera de alcance

- Estelas persistentes.
- Heatmap continuo del viento.
- Cambios al modelo aerológico o al backend.
