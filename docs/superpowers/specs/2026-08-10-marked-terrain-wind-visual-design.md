# Diseño: escena orográfica y trazos de viento de referencia

## Contexto y objetivo

La versión server-field ya recibe `/api/wind-field`, activa el DEM y ejecuta WebGL2, pero su cámara regional y sus puntos pequeños no producen la lectura visual solicitada. La referencia aportada muestra una escena cercana y baja, una montaña con silueta inequívoca, trazos direccionales de viento, un panel de control completo a la izquierda y un indicador de viento arriba a la derecha.

El objetivo es reproducir esa composición sin volver al cálculo aerológico heredado del navegador. FastAPI, el campo binario, su caché y el mismo origen `/api` se conservan.

## Reutilización de interfaz

La versión server-field reutilizará el lenguaje visual ya presente en `src/App.jsx` y `style.css`, adaptándolo a estado React controlado. No cargará `app.js`, `LegacyEngineLoader` ni el motor v3.1.

El panel izquierdo incluirá, en este orden:

1. Cabecera, versión server-field y descripción.
2. Dirección con slider, etiqueta cardinal y ocho botones de brújula.
3. Velocidad y estabilidad.
4. Densidad visual y exageración del relieve.
5. Seis métricas: elevación, `w`, velocidad local, dirección del flujo, área y canalización.
6. Toggles de trazos, hillshade y ortofoto; acciones de restablecer vista y recalcular.
7. Leyenda de colores, estado operativo y aviso de uso diagnóstico.

El indicador superior derecho mostrará dirección cardinal, velocidad y una flecha rotada hacia donde sopla el viento. Panel, chip y controles MapLibre conservarán el comportamiento responsive existente: panel desplazable en escritorio y cajón lateral en móvil.

## Estado y controles

Los controles `direction`, `speed` y `stability` seguirán disparando la petición agrupada al servidor. `recalculate` invalidará sólo la petición vigente. Los demás controles serán locales:

- `density`: rango visual 7–27, convertido a un número activo de trazos entre 3.000 y 18.000 en escritorio y entre 1.500 y 8.000 en móvil.
- `exaggeration`: rango 1–2,2 y valor inicial 1,35; actualiza MapLibre y el uniform vertical del renderer sin solicitar otro campo.
- `traces`, `hillshade`, `ortho`: visibilidad local inmediata.
- `reset view`: restaura la cámara de referencia.

El renderer sembrará una vez el máximo de partículas y modificará `activeParticleCount`; el slider de densidad no recreará buffers.

## Cámara y terreno

La vista de referencia será determinista:

- centro aproximado `[-5.9645, 40.1245]`, al sureste del Pitolero;
- zoom `14.3`;
- pitch `72`;
- bearing `28`;
- exageración inicial `1.35`.

Durante la verificación se permitirá ajustar una sola vez el centro dentro de 1,5 km para alinear la montaña con la referencia; el valor final quedará fijado en una constante y en la prueba visual.

Hillshade y ortofoto conservarán las fuentes IGN actuales. El relieve se considerará cargado sólo si `queryTerrainElevation(SITE)` devuelve un valor finito superior a 100 m. La captura de aceptación deberá mostrar cielo, una cresta recortada contra el horizonte y valles/laderas ocupando al menos el tercio central de la imagen; la escala visible deberá estar entre 200 y 500 m.

## Renderer de trazos GPU

La advección seguirá usando transform feedback y el campo Float32 del servidor. El dibujo de puntos se sustituirá por quads instanciados:

- un draw call actualiza los estados mediante transform feedback;
- un draw call `drawArraysInstanced` dibuja seis vértices por trazo;
- cada instancia construye en el vertex shader un segmento orientado por `u/v`, con longitud proporcional a la velocidad y limitada visualmente;
- el quad se expande en espacio de pantalla para obtener grosor estable en píxeles CSS;
- longitud objetivo: 8–28 CSS px; grosor: 1,5–3,5 CSS px según velocidad y densidad;
- ambos valores se convierten con `devicePixelRatio` y se limitan a un máximo físico razonable.

Los colores serán azul para `|w| <= 0.55`, verde para ascenso y rojo para descenso. El extremo delantero tendrá más opacidad que la cola para hacer evidente la dirección.

## Sistema vertical y oclusión

Una constante/uniform compartido llevará la exageración tanto a `map.setTerrain()` como al shader. La altitud visual de la cabeza será:

`terrainElevation * exaggeration + 35 m + max(0, zOffset)`.

La cola se calculará retrocediendo en `u/v/w`; nunca bajará del suelo exagerado más 20 m. Así ningún estado dibujable atraviesa laderas y los trazos pueden quedar correctamente ocultos detrás de crestas.

El custom layer habilitará explícitamente depth testing y deshabilitará la escritura de profundidad durante los trazos. Guardará y restaurará: estado `BLEND`, los cuatro factores RGB/alpha, estado `DEPTH_TEST`, `DEPTH_FUNC` y `DEPTH_WRITEMASK`. El fragment shader emitirá alfa premultiplicada y usará `ONE, ONE_MINUS_SRC_ALPHA`.

## Métricas

Al recibir el campo se muestreará la celda más cercana al Pitolero. De sus canales se derivarán:

- elevación DEM;
- `w` y clasificación ascenso/neutro/descenso;
- velocidad horizontal local en km/h;
- rumbo del flujo mediante `atan2(u, v)`;
- texto de canalización a partir de la diferencia respecto al rumbo sinóptico.

Las métricas mostrarán `—` hasta disponer de un campo válido. Los errores de API, mapa, terreno y GPU seguirán separados y el panel mostrará todos los fallos concurrentes.

## Verificación

- Build de producción y carga limpia sin errores o warnings originados por la aplicación.
- `/api`, `/api/health` y `/api/wind-field` mantienen su contrato actual.
- Captura de escritorio a 1827×1017 que reproduzca la composición de la referencia: panel completo, chip superior, cielo/horizonte, cresta central y trazos visibles en cielo y laderas.
- Captura móvil a 390×844 que verifique cajón, chip y controles accesibles.
- Dos capturas con cámara fija separadas 1,2 segundos muestran movimiento de trazos.
- Toggles, brújula, sliders, reset y recálculo producen un único cambio esperado cada uno.
- Perfil de rendimiento documentado con Chrome, user agent, DPR, CPU y renderer WebGL del equipo de prueba. Objetivo escritorio: mediana >=45 FPS y p95 de intervalo <=33 ms durante 10 s estáticos y 10 s de paneo.
- La prueba móvil será explícitamente emulada en el mismo equipo; objetivo orientativo: mediana >=30 FPS y p95 <=50 ms. No se presentará como medición de hardware móvil real.

## Fuera de alcance

- Recuperar el cálculo v3.1 en navegador.
- Heatmap continuo o estelas persistentes entre muchos frames.
- Cambios al modelo aerológico del backend.
- Replicar el panel de detalle puntual que no aparece abierto en la referencia.
