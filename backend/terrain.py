import asyncio
import io
import math
from dataclasses import dataclass

import httpx
import numpy as np
from cachetools import TTLCache
from PIL import Image

DEM_URL = "https://xyz-mdt.idee.es/1.0.0/raster-dem/{z}/{x}/{y}.png"
TILE_SIZE = 512


def _clip_lat(lat: np.ndarray) -> np.ndarray:
    return np.clip(lat, -85.05112878, 85.05112878)


def lonlat_to_global_pixel(lon: np.ndarray, lat: np.ndarray, zoom: int):
    n = 2 ** zoom
    x = (lon + 180.0) / 360.0 * n * TILE_SIZE
    lat_rad = np.radians(_clip_lat(lat))
    y = (1.0 - np.arcsinh(np.tan(lat_rad)) / math.pi) / 2.0 * n * TILE_SIZE
    return x, y


def decode_mapbox_dem(content: bytes) -> np.ndarray:
    image = Image.open(io.BytesIO(content)).convert("RGB")
    rgb = np.asarray(image, dtype=np.float32)
    return -10000.0 + (rgb[..., 0] * 65536.0 + rgb[..., 1] * 256.0 + rgb[..., 2]) * 0.1


@dataclass
class TerrainGrid:
    values: np.ndarray
    west: float
    south: float
    east: float
    north: float
    valid: int


class IgnTerrainSource:
    def __init__(self, zoom: int = 12, max_concurrency: int = 10):
        self.zoom = zoom
        self.max_concurrency = max_concurrency
        self._tiles = TTLCache(maxsize=256, ttl=3600)
        self._lock = asyncio.Lock()

    async def _fetch_tile(self, client: httpx.AsyncClient, z: int, x: int, y: int, semaphore: asyncio.Semaphore):
        key = (z, x, y)
        cached = self._tiles.get(key)
        if cached is not None:
            return key, cached

        n = 2 ** z
        if x < 0 or y < 0 or x >= n or y >= n:
            return key, None

        url = DEM_URL.format(z=z, x=x, y=y)
        async with semaphore:
            response = await client.get(url, timeout=20.0)
            if response.status_code != 200:
                return key, None
            tile = decode_mapbox_dem(response.content)

        async with self._lock:
            self._tiles[key] = tile
        return key, tile

    async def sample_grid(self, west: float, south: float, east: float, north: float, width: int, height: int) -> TerrainGrid:
        lons = np.linspace(west, east, width, dtype=np.float64)
        lats = np.linspace(south, north, height, dtype=np.float64)
        lon_grid, lat_grid = np.meshgrid(lons, lats)
        gx, gy = lonlat_to_global_pixel(lon_grid, lat_grid, self.zoom)

        tx = np.floor(gx / TILE_SIZE).astype(np.int32)
        ty = np.floor(gy / TILE_SIZE).astype(np.int32)
        px = np.floor(gx - tx * TILE_SIZE).astype(np.int32)
        py = np.floor(gy - ty * TILE_SIZE).astype(np.int32)
        px = np.clip(px, 0, TILE_SIZE - 1)
        py = np.clip(py, 0, TILE_SIZE - 1)

        unique_tiles = sorted({(self.zoom, int(x), int(y)) for x, y in zip(tx.ravel(), ty.ravel())})
        semaphore = asyncio.Semaphore(self.max_concurrency)

        async with httpx.AsyncClient(headers={"User-Agent": "PitoleroWindLab/1.0"}) as client:
            fetched = await asyncio.gather(
                *(self._fetch_tile(client, z, x, y, semaphore) for z, x, y in unique_tiles)
            )

        tile_map = {key: tile for key, tile in fetched if tile is not None}
        values = np.full((height, width), np.nan, dtype=np.float32)

        for z, x, y in unique_tiles:
            tile = tile_map.get((z, x, y))
            if tile is None:
                continue
            mask = (tx == x) & (ty == y)
            values[mask] = tile[py[mask], px[mask]]

        valid = int(np.isfinite(values).sum())
        if valid:
            finite = values[np.isfinite(values)]
            fill_value = float(np.median(finite))
            values = np.where(np.isfinite(values), values, fill_value).astype(np.float32)

        return TerrainGrid(values=values, west=west, south=south, east=east, north=north, valid=valid)
