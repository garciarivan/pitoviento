# Rama `server-field`

Esta rama prueba una arquitectura en la que el navegador deja de calcular el campo aerológico. El backend descarga y cachea el MDT del IGN, construye una rejilla de elevaciones y devuelve un campo vectorial binario listo para la GPU del cliente.

## Arquitectura

```text
IGN raster-dem
    ↓
FastAPI + NumPy
    ↓
canalización + Venturi + w
    ↓
cache RAM (TTL)
    ↓
Float32 binario (u, v, w, boost)
    ↓
React + MapLibre
    ↓
GpuVectorParticleLayer (solo render/advección)
```

El navegador sigue dibujando MapLibre y las partículas, pero ya no recorre el DEM ni calcula el campo de viento.

## Backend

Desde la raíz del repositorio:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Comprobación:

```text
GET http://localhost:8000/api/health
```

Campo de viento:

```text
GET /api/wind-field?lat=40.136184&lon=-5.979353&area_km=40&direction=315&speed=20&stability=neutral&width=128&height=128
```

La respuesta es `application/octet-stream`: `width × height × 4` valores `Float32` little-endian. Cada celda contiene:

1. velocidad hacia el Este (m/s)
2. velocidad hacia el Norte (m/s)
3. velocidad vertical `w` (m/s)
4. incremento Venturi (0..0.70)

Los límites, resolución, porcentaje válido, tiempo de cálculo y estado de cache se devuelven en cabeceras `X-Field-*`.

## Frontend

En otra terminal:

```bash
npm install
VITE_WIND_API_URL=http://localhost:8000 npm run dev
```

Abrir la entrada Vite `/server.html`.

El laboratorio usa `GpuVectorParticleLayer`; no llama a `queryTerrainElevation()` para calcular el campo.

## Docker backend

Desde la raíz:

```bash
docker build -f backend/Dockerfile -t pitoviento-field-api .
docker run --rm -p 8000:8000 pitoviento-field-api
```

## Variables de entorno del servidor

- `DEM_ZOOM=12`
- `FIELD_CACHE_TTL=1800`
- `FIELD_CACHE_SIZE=128`
- `CORS_ORIGINS=*`

Para producción conviene restringir `CORS_ORIGINS` al dominio del frontend y colocar una cache persistente/Redis delante si se despliegan varias réplicas.

## Alcance físico

El modelo sigue siendo heurístico, no CFD. Esta rama mueve al servidor la estimación de canalización, Venturi y velocidad vertical. Una ventaja de esta arquitectura es que el backend se puede sustituir más adelante por un modelo más costoso, campos precalculados o CFD sin cambiar el renderer del navegador.
