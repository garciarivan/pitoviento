import asyncio
import base64
import hashlib
import math
import os
import time
from dataclasses import dataclass

from cachetools import TTLCache
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .model import build_flow_field
from .terrain import IgnTerrainSource

try:
    from vercel.functions import AsyncRuntimeCache
except ImportError:  # Desarrollo local sin el SDK de Vercel.
    AsyncRuntimeCache = None

SITE_LAT = 40.13618392931326
SITE_LON = -5.979353098143796
CACHE_VERSION = "v3-terrain-altitude"
CACHE_TTL = int(os.getenv("FIELD_CACHE_TTL", "1800"))

app = FastAPI(
    title="Pitolero Wind Field API",
    version="0.3.0",
    description="Calcula en servidor un campo vectorial aerologico sobre el MDT del IGN.",
)

origins = [item.strip() for item in os.getenv("CORS_ORIGINS", "*").split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
    expose_headers=[
        "X-Field-Width", "X-Field-Height", "X-Field-West", "X-Field-South",
        "X-Field-East", "X-Field-North", "X-Field-Valid", "X-Field-Cache",
        "X-Field-Compute-Ms", "X-DEM-Zoom"
    ],
)

terrain = IgnTerrainSource(zoom=int(os.getenv("DEM_ZOOM", "12")))
field_cache = TTLCache(maxsize=int(os.getenv("FIELD_CACHE_SIZE", "128")), ttl=CACHE_TTL)
cache_lock = asyncio.Lock()

runtime_cache = None
if os.getenv("VERCEL") == "1" and AsyncRuntimeCache is not None:
    runtime_cache = AsyncRuntimeCache(namespace=f"pitoviento-wind-field-{CACHE_VERSION}")


@dataclass
class CachedField:
    payload: bytes
    width: int
    height: int
    west: float
    south: float
    east: float
    north: float
    valid: int
    compute_ms: int


def bounds_around(lon: float, lat: float, area_km: float):
    half_m = area_km * 500.0
    dlat = half_m / 111320.0
    dlon = half_m / max(1000.0, 111320.0 * math.cos(math.radians(lat)))
    return lon - dlon, lat - dlat, lon + dlon, lat + dlat


def cache_key(lat: float, lon: float, area_km: float, direction: float, speed: float, stability: str, width: int, height: int):
    canonical = ":".join([
        CACHE_VERSION,
        f"{lat:.4f}", f"{lon:.4f}", f"{area_km:.1f}", f"{direction % 360.0:.1f}",
        f"{speed:.1f}", stability, str(width), str(height), str(terrain.zoom)
    ])
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _runtime_record(item: CachedField):
    return {
        "payload": base64.b64encode(item.payload).decode("ascii"),
        "width": item.width,
        "height": item.height,
        "west": item.west,
        "south": item.south,
        "east": item.east,
        "north": item.north,
        "valid": item.valid,
        "compute_ms": item.compute_ms,
    }


def _field_from_runtime(value):
    try:
        if not isinstance(value, dict) or "payload" not in value:
            return None
        return CachedField(
            payload=base64.b64decode(value["payload"]),
            width=int(value["width"]),
            height=int(value["height"]),
            west=float(value["west"]),
            south=float(value["south"]),
            east=float(value["east"]),
            north=float(value["north"]),
            valid=int(value["valid"]),
            compute_ms=int(value.get("compute_ms", 0)),
        )
    except (KeyError, TypeError, ValueError):
        return None


async def get_cached_field(key: str):
    local = field_cache.get(key)
    if local is not None:
        return local, "MEMORY"

    if runtime_cache is not None:
        try:
            value = await runtime_cache.get(key)
            item = _field_from_runtime(value)
            if item is not None:
                field_cache[key] = item
                return item, "RUNTIME"
        except Exception:
            pass

    return None, "MISS"


async def store_cached_field(key: str, item: CachedField):
    async with cache_lock:
        field_cache[key] = item

    if runtime_cache is not None:
        try:
            await runtime_cache.set(
                key,
                _runtime_record(item),
                {
                    "ttl": CACHE_TTL,
                    "tags": [f"wind-field-{CACHE_VERSION}"],
                    "name": f"Pitoviento {item.width}x{item.height}",
                },
            )
        except Exception:
            pass


def field_response(item: CachedField, cache_state: str):
    return Response(
        content=item.payload,
        media_type="application/octet-stream",
        headers={
            "X-Field-Width": str(item.width),
            "X-Field-Height": str(item.height),
            "X-Field-West": f"{item.west:.8f}",
            "X-Field-South": f"{item.south:.8f}",
            "X-Field-East": f"{item.east:.8f}",
            "X-Field-North": f"{item.north:.8f}",
            "X-Field-Valid": str(item.valid),
            "X-Field-Cache": cache_state,
            "X-Field-Compute-Ms": str(item.compute_ms),
            "X-DEM-Zoom": str(terrain.zoom),
            "Cache-Control": "public, max-age=60",
            "Vercel-CDN-Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
        },
    )


@app.get("/api")
async def api_root():
    return {
        "service": "pitoviento-server-field",
        "version": app.version,
        "health": "/api/health",
        "field": "/api/wind-field",
    }


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "service": "pitoviento-server-field",
        "version": app.version,
        "demZoom": terrain.zoom,
        "memoryCacheEntries": len(field_cache),
        "runtimeCache": runtime_cache is not None,
        "vercel": os.getenv("VERCEL") == "1",
    }


@app.get("/api/wind-field")
async def wind_field(
    lat: float = Query(SITE_LAT, ge=-85.0, le=85.0),
    lon: float = Query(SITE_LON, ge=-180.0, le=180.0),
    area_km: float = Query(40.0, ge=5.0, le=80.0),
    direction: float = Query(315.0, ge=0.0, lt=360.0),
    speed: float = Query(20.0, ge=2.0, le=100.0),
    stability: str = Query("neutral", pattern="^(stable|neutral|unstable)$"),
    width: int = Query(128, ge=48, le=256),
    height: int = Query(128, ge=48, le=256),
):
    key = cache_key(lat, lon, area_km, direction, speed, stability, width, height)
    cached, cache_state = await get_cached_field(key)
    if cached is not None:
        return field_response(cached, cache_state)

    started = time.perf_counter()
    west, south, east, north = bounds_around(lon, lat, area_km)
    grid = await terrain.sample_grid(west, south, east, north, width, height)
    expected = width * height
    if grid.valid < expected * 0.45:
        raise HTTPException(status_code=503, detail=f"MDT insuficiente: {grid.valid}/{expected} muestras validas")

    field, valid = await asyncio.to_thread(
        build_flow_field,
        grid.values,
        west=west,
        south=south,
        east=east,
        north=north,
        from_deg=direction,
        speed_kmh=speed,
        stability=stability,
    )
    compute_ms = int((time.perf_counter() - started) * 1000)
    item = CachedField(
        payload=field.astype("<f4", copy=False).tobytes(order="C"),
        width=width,
        height=height,
        west=west,
        south=south,
        east=east,
        north=north,
        valid=valid,
        compute_ms=compute_ms,
    )

    await store_cached_field(key, item)
    return field_response(item, "MISS")
