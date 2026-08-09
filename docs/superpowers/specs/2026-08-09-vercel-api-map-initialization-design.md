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

Se añadirá una ruta catch-all explícita que apunte a la misma aplicación exportada por `api/index.py`. No se duplicarán endpoints ni lógica del backend. La configuración se comprobará con el flujo local de Vercel cuando esté disponible y con pruebas directas de la aplicación ASGI.

### Ciclo de vida del mapa

El componente tendrá una función idempotente de arranque que:

1. Activa el terreno cuando la fuente y el estilo están disponibles.
2. Marca el cliente como listo para solicitar el campo.
3. Intenta crear la capa GPU sin bloquear la petición a la API si falla.

La función se llamará desde los eventos apropiados de MapLibre y desde un fallback temporizado. Antes de cada operación comprobará el estado del mapa para evitar dobles capas, actualizaciones tras desmontaje o llamadas prematuras.

### Flujo del campo

Cuando el cliente quede listo, `ServerFieldClient` solicitará `/api/wind-field`. Si el campo llega antes de que exista la capa GPU, se conservará temporalmente y se aplicará al crear la capa. De este modo, la API y el renderer dejan de depender entre sí.

### Estados y errores

El panel distinguirá:

- mapa base disponible y petición en curso;
- campo recibido y aplicado;
- error HTTP o respuesta binaria inválida;
- renderer GPU no disponible;
- relieve no disponible.

Un fallo de relieve o GPU no impedirá pedir el campo ni sustituirá un error de API más accionable.

## Verificación

- Pruebas ASGI para `/api`, `/api/health` y una versión controlada de `/api/wind-field`.
- Validación de la configuración y rutas de Vercel.
- Compilación de producción de Vite.
- Prueba en navegador confirmando que el estado sale de `Inicializando mapa…` y que se intenta `/api/wind-field`.
- Tras desplegar, comprobación HTTP de las tres rutas y verificación visual de relieve y partículas.

## Fuera de alcance

- Cambiar el modelo aerológico.
- Separar frontend y backend en proyectos distintos.
- Rediseñar la interfaz o sustituir MapLibre.
