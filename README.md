# Pitoviento · Server Field

Rama experimental para mover el calculo aerologico fuera del navegador.

## Arquitectura

```text
MDT IGN/CNIG
    ↓
FastAPI + NumPy
    ↓
CDN / Runtime Cache / memoria de funcion
    ↓
campo vectorial binario Float32
    ↓
MapLibre + adveccion WebGL2 en el navegador
```

El navegador sigue renderizando mapa, terreno y particulas, pero ya no construye el campo aerologico ni recorre el MDT para calcularlo.

## Frontend

La entrada principal es `index.html`, construida con Vite y React. En produccion usa la API del mismo dominio (`/api`). Para apuntar a un backend externo se puede definir:

```bash
VITE_WIND_API_URL=https://mi-backend.example.com
```

## Backend

El entrypoint para Vercel es `api/index.py`, que exporta la aplicacion FastAPI de `backend/main.py`.

Endpoints:

- `GET /api`
- `GET /api/health`
- `GET /api/wind-field`

`/api/wind-field` devuelve un buffer `Float32` RGBA por celda con componentes horizontales del viento, componente vertical estimada y Venturi. Los limites, dimensiones y metadatos se devuelven en cabeceras HTTP.

## Cache

Se usan tres niveles cuando la aplicacion esta en Vercel:

1. Cache corta en memoria de la instancia Python.
2. Vercel Runtime Cache para reutilizar campos entre ejecuciones.
3. Vercel CDN Cache para que peticiones identicas puedan evitar la ejecucion de Python.

El Runtime Cache es opcional: si no esta disponible, la API sigue funcionando con cache local y calculo normal.

## Desarrollo local

Frontend:

```bash
npm install
npm run dev
```

Backend:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Vite usa `http://localhost:8000` automaticamente durante desarrollo. Tambien se puede usar `vercel dev` para probar frontend y Python bajo el mismo origen.

## Despliegue en Vercel

La rama incluye:

- `vercel.json`
- `.python-version` con Python 3.12
- `requirements.txt` en la raiz
- `api/index.py`
- build Vite a `dist/`

Conecta el repositorio a un proyecto de Vercel y selecciona la rama `server-field` para un Preview Deployment, o despliega desde CLI con Vercel CLI.

No hace falta configurar `VITE_WIND_API_URL` si frontend y backend se despliegan juntos en el mismo proyecto.

## Fuentes

- MDT/Raster DEM: IGN/CNIG.
- Ortofoto PNOA: IGN/CNIG.
- MapLibre GL JS para el terreno 3D.
- FastAPI y NumPy para el campo calculado en servidor.

## Limitacion fisica

El campo sigue siendo un modelo diagnostico y exploratorio basado en relieve y parametrizaciones de canalizacion, pendiente y Venturi. No es CFD ni resuelve Navier-Stokes y no debe usarse como unica fuente para decisiones de seguridad de vuelo.
