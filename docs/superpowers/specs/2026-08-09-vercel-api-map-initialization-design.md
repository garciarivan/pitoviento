# Diseño: rutas FastAPI y arranque robusto del mapa

## Contexto

En producción, `GET /api` llega a `api/index.py`, pero Vercel devuelve su propio 404 para `/api/health` y `/api/wind-field`. Por separado, MapLibre dibuja el mapa y carga el JavaScript más reciente, pero el estado permanece en `Inicializando mapa…`: el frontend espera exclusivamente el evento global `load` para activar la petición y el renderer.

## Objetivos

- Encaminar `/api` y cualquier subruta `/api/*` a una sola aplicación FastAPI.
- Solicitar el campo de viento aunque el evento global `load` se retrase indefinidamente.
- Inicializar relieve, renderer GPU y cliente API de manera independiente.
- Mostrar en el panel un error útil cuando falle el mapa, la API o la GPU.
- Conservar el mismo origen en producción y el backend local en desarrollo.

## Enfoque

### Enrutamiento de Vercel

`vercel.json` declarará, antes de cualquier fallback de frontend, esta reescritura:

```json
{
  "source": "/api/:path*",
  "destination": "/api/index"
}
```

`/api` seguirá resolviendo el archivo `api/index.py`; `/api/health` y `/api/wind-field?...` se reescribirán a esa misma función. La URL pública y su query string se conservarán, de modo que el scope ASGI que recibe FastAPI siga coincidiendo con las rutas `/api/*`. No se duplicarán endpoints ni lógica del backend.

### Ciclo de vida del mapa

La petición API se iniciará en su propio efecto al montar el componente y no dependerá de `load`, `isStyleLoaded()`, la fuente DEM, el terreno ni la capa GPU.

Por separado, el componente tendrá una función idempotente de arranque de funciones visuales que:

1. Activa el terreno cuando la fuente y el estilo están disponibles.
2. Intenta crear la capa GPU sin bloquear la petición a la API si falla.

Ningún estado, evento o error del mapa habilitará, retrasará o cancelará por sí mismo la petición del campo.

La función visual se llamará desde `style.load` y `styledata`. Un temporizador de 1500 ms comprobará `isStyleLoaded()` y repetirá la inicialización si los eventos ya ocurrieron o no llegan. Las operaciones visuales comprobarán sus propias precondiciones y guards `once`; el temporizador y todos los listeners se retirarán al desmontar, y ninguna continuación asíncrona actualizará estado después del desmontaje.

### Flujo del campo

`ServerFieldClient` solicitará `/api/wind-field` inmediatamente. Si el campo llega antes de que exista la capa GPU, la respuesta más reciente se conservará en una referencia y se entregará a la capa al crearla. `GpuVectorParticleLayerV2.setField()` ya admite recibir el campo antes de `onAdd`; la subida a GPU ocurrirá al quedar lista la capa. Cada respuesta vigente sustituirá a la anterior y se entregará una sola vez por capa.

### Estados y errores

El componente mantendrá estados separados para `map`, `api`, `gpu` y `terrain`. El panel distinguirá:

- mapa base disponible y petición en curso;
- campo recibido y aplicado;
- error HTTP o respuesta binaria inválida;
- renderer GPU no disponible;
- relieve no disponible.

Un fallo de relieve o GPU no impedirá pedir el campo ni sustituirá un error de API más accionable. Si hay varios fallos se mostrarán juntos, con API primero, después GPU, terreno y mapa. “Campo recibido” significará respuesta validada y guardada; “campo aplicado” significará entregado a una capa creada, aunque su `onAdd` todavía esté completando la subida WebGL.

`map` pasará de `initializing` a `ready` en el primer `style.load`, `styledata` con `isStyleLoaded() === true` o comprobación temporizada equivalente. `map.on('error')` clasificará como `terrain` los errores cuya fuente sea cualquiera de las fuentes DEM; los errores del custom layer serán `gpu`; el resto serán `map`, incluidos fallos de teselas base u ortofoto. Un error de recurso no deshará un estado `ready`, pero quedará visible como advertencia específica.

### Contrato del cliente

Además del tamaño exacto del payload, el cliente exigirá `application/octet-stream`, dimensiones enteras positivas, límites finitos y ordenados, y `X-Field-Valid` dentro de `0..width*height`. Una respuesta que incumpla cualquiera de esas condiciones producirá un error de API visible.

### Fuente DEM

El hillshade y el terreno usarán dos fuentes MapLibre separadas con la misma plantilla de teselas. Esto elimina la advertencia conocida de MapLibre y evita compartir estado de render entre ambos usos.

## Verificación

- Pruebas ASGI para `/api`, `/api/health` y una versión controlada de `/api/wind-field`.
- Prueba obligatoria mediante `vercel dev` o deployment preview: `/api` devuelve el identificador del servicio, `/api/health` devuelve su JSON de salud y `/api/wind-field` devuelve `application/octet-stream` con dimensiones y cabeceras `X-Field-*`. Un código 200 aislado no será suficiente.
- Compilación de producción de Vite.
- Pruebas del ciclo de vida confirmando una sola petición aun sin `load`, retención del campo antes de GPU, aplicación posterior, fallo GPU sin bloquear API, error API visible y desmontaje sin actualizaciones tardías.
- Prueba de clasificación que simule un fallo de tesela base y confirme que aparece como error de mapa sin borrar el estado de API.
- Prueba en navegador confirmando que el estado sale de `Inicializando mapa…`, que el campo se recibe y que el panel informa si se aplicó o si falló la GPU.
- Tras desplegar, comprobación HTTP de las tres rutas y verificación visual de relieve y partículas.

## Fuera de alcance

- Cambiar el modelo aerológico.
- Separar frontend y backend en proyectos distintos.
- Rediseñar la interfaz o sustituir MapLibre.
