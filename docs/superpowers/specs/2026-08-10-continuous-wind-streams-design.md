# Corrientes de viento continuas y proporcionales

## Objetivo

Sustituir la percepción de puntos que aparecen y desaparecen por corrientes continuas sobre el relieve 3D. La dirección y las variaciones locales seguirán procediendo del campo calculado por `/api/wind-field`; la velocidad elegida entre 5 y 55 km/h deberá cambiar de forma inequívoca y proporcional el avance visual.

La solución conservará la opción visual C aprobada: estelas suaves, con velocidades diferenciadas y entrada y salida gradual. No se modificarán la API, la semántica de colores, el relieve, la ortofoto PNOA ni la estructura del panel.

## Diagnóstico

`GpuVectorParticleLayerV2` ya mueve cada estado con el vector local, pero la escala geográfica produce desplazamientos de pocos píxeles por segundo en el zoom inicial. Además, `setField()` llama a `uploadField()`, vuelve a sembrar los dos buffers y hace que todo el flujo salte simultáneamente cada vez que el servidor entrega un campo nuevo. La geometría actual limita las estelas a 8–28 píxeles CSS y no aplica una envolvente de opacidad por edad; la combinación se percibe como cabezas puntuales que nacen y mueren.

## Enfoque aprobado

Se mantendrá el renderer WebGL2 de dos pasos: una actualización mediante transform feedback y un dibujo instanciado por callback de MapLibre. No se añadirán framebuffer de acumulación, historial de posiciones ni llamadas de dibujo adicionales.

El estado seguirá siendo `vec4(lon, lat, zOffset, age)`. React sólo comunicará controles de baja frecuencia; el movimiento, la geometría y la opacidad seguirán calculándose en GPU.

## Movimiento y ciclo de vida

- La edad avanzará con el tiempo real: `age += dt`.
- La advección usará `motionDt = dt * MOTION_SCALE`, con `MOTION_SCALE = 12.0`. La constante se declarará en JavaScript, se interpolará en la fuente GLSL y se exportará junto a una función pura `visualAdvectionMeters(speedMs, dt)`. Así, la prueba y el shader comparten el mismo valor. Si el vector local se duplica, el desplazamiento visual también.
- `dt` continuará limitado a 0,08 s para evitar saltos tras pausas o pestañas en segundo plano.
- La vida máxima seguirá siendo 12 s.
- La siembra inicial repartirá la edad de forma determinista en todo el intervalo `[0, 12)`. Un respawn posterior empezará cerca de edad cero para recorrer una entrada gradual completa.
- La envolvente temporal será `smoothstep(0.0, 0.8, age) * (1.0 - smoothstep(10.5, 12.0, age))`.
- Permanecen las condiciones de respawn por salida del campo, velocidad local inválida y offset vertical fuera del intervalo seguro.

## Actualización del campo sin destello global

La textura RGBA32F se actualizará para cada respuesta válida del servidor, pero los buffers de partículas sólo se sembrarán en la primera carga o cuando cambie la geometría del dominio: anchura, altura o límites oeste/sur/este/norte.

Con los mismos límites y dimensiones, cambiar dirección, velocidad o estabilidad conservará posiciones, alturas, edades y el índice ping-pong. El nuevo vector empezará a afectar al siguiente frame sin hacer desaparecer simultáneamente el flujo.

## Geometría y apariencia

El vertex shader de dibujo seguirá generando seis vértices por instancia. La dirección de pantalla se obtendrá proyectando una cola virtual sobre el vector local y después se fijará una longitud en píxeles CSS:

- `speed01 = smoothstep(1.4, 15.3, length(field.xy))`, equivalente aproximadamente al intervalo global 5–55 km/h antes de variaciones orográficas.
- `lengthCss = mix(18.0, 60.0, speed01)`.
- `widthCss = mix(1.8, 3.2, speed01)`.
- Ambos valores se convertirán a framebuffer mediante `devicePixelRatio`, limitado como en el renderer actual.

Antes de dividir por `clip.w`, ambas proyecciones deberán cumplir `abs(clip.w) >= 1e-5`. Después, `length(directionPx)` deberá ser al menos `0.25 * devicePixelRatio`. Si falla cualquiera de las dos condiciones, los seis vértices formarán un quad degenerado fuera del clip y la opacidad será cero. No se normalizará un vector por debajo de ese epsilon ni se inventará una dirección alternativa.

El fragment shader recibirá progreso longitudinal, coordenada lateral y envolvente temporal. La opacidad combinará:

- cola transparente con aumento suave hacia el cuerpo y la cabeza;
- borde lateral suavizado para evitar rectángulos duros;
- entrada y salida por edad;
- alfa premultiplicada compatible con el blend actual `ONE, ONE_MINUS_SRC_ALPHA`.

La longitud mínima de 18 px impide que una instancia visible se reduzca a un punto. Se mantienen azul para flujo neutro, verde para ascendencia y rojo para descendencia. La cabeza será luminosa pero alargada, sin un disco independiente.

## Relieve y estado WebGL

Las altitudes de cabeza y cola seguirán usando el DEM multiplicado por la exageración activa, más el offset seguro de la partícula. El depth test permanecerá habilitado y la escritura de profundidad deshabilitada durante el dibujo para conservar la oclusión detrás de crestas.

El renderer seguirá guardando y restaurando blend, factores de mezcla, depth test, depth func, depth mask y cull face. Las ubicaciones de uniforms se resolverán una sola vez al crear cada programa y se reutilizarán por frame.

## Rendimiento y React

- Una invocación del callback `render` por frame.
- Una draw call de transform feedback y una draw call instanciada.
- Sin buffers ni texturas adicionales.
- Ningún estado React se actualizará desde el bucle de animación.
- Los cambios del control seguirán agrupados por el debounce existente de 260 ms; el campo anterior continuará animándose hasta recibir la nueva textura.
- Escritorio conservará hasta 18.000 instancias activas y móvil hasta 8.000.

## Criterios de aceptación

En la cámara Pitolero aprobada y después de cargar campo y terreno:

1. La geometría generada antes de clipping y oclusión mide al menos 18 px CSS de largo. Se excluyen del mínimo las instancias recortadas por viewport, near plane o terreno; no se perciben puntos aislados dentro de la escena visible.
2. El flujo presenta cola suave, cuerpo legible y entrada/salida gradual, sin destello global periódico.
3. Al cambiar velocidad con los mismos límites y dimensiones, las partículas conservan sus posiciones y no se vuelven a sembrar.
4. Una prueba con `node:test` llamará a `visualAdvectionMeters` con la misma celda conceptual, dirección, estabilidad, estado inicial y `dt = 1/60`. Usará magnitudes `5/3.6`, `20/3.6` y `55/3.6` m/s y comprobará con tolerancia de punto flotante `1e-6` que las distancias guardan proporciones 1:4:11. Esta prueba no leerá buffers GPU ni añadirá instrumentación a la interfaz.
5. La longitud crece de aproximadamente 18 px en el extremo bajo a 60 px en el alto; la anchura permanece entre 1,8 y 3,2 px CSS.
6. Azul, verde y rojo conservan su significado actual.
7. Las estelas siguen el terreno exagerado, no atraviesan laderas y quedan ocultas detrás de crestas.
8. No aparecen errores o advertencias de la aplicación ni errores WebGL al cambiar repetidamente velocidad, dirección o estabilidad.
9. La escena sigue siendo utilizable en 1827 × 1017 y 390 × 844 con las densidades máximas existentes.

## Verificación

- Ejecutar `npm run build` y `git diff --check`.
- Ejecutar la prueba determinista de `visualAdvectionMeters` mediante `node --test`.
- Probar 5, 20 y 55 km/h durante intervalos iguales con la misma cámara.
- Cambiar 5 → 55 → 20 km/h y comprobar que la textura cambia sin reinicio global de posiciones.
- Observar al menos un ciclo completo de 12 s para verificar nacimiento y muerte gradual.
- Revisar consola y errores WebGL en escritorio y móvil.
- Confirmar visualmente oclusión, PNOA oscurecida, indicador superior y panel completo.
