import math
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class StabilityParams:
    lift: float
    channel: float


def stability_params(name: str) -> StabilityParams:
    if name == "stable":
        return StabilityParams(lift=1.08, channel=1.12)
    if name == "unstable":
        return StabilityParams(lift=0.82, channel=0.78)
    return StabilityParams(lift=0.96, channel=1.0)


def _shift_no_wrap(values: np.ndarray, dx: int, dy: int) -> np.ndarray:
    out = np.full(values.shape, np.nan, dtype=np.float32)
    h, w = values.shape

    src_x0 = max(0, -dx)
    src_x1 = min(w, w - dx) if dx >= 0 else w
    dst_x0 = max(0, dx)
    dst_x1 = dst_x0 + (src_x1 - src_x0)

    src_y0 = max(0, -dy)
    src_y1 = min(h, h - dy) if dy >= 0 else h
    dst_y0 = max(0, dy)
    dst_y1 = dst_y0 + (src_y1 - src_y0)

    if src_x1 > src_x0 and src_y1 > src_y0:
        out[dst_y0:dst_y1, dst_x0:dst_x1] = values[src_y0:src_y1, src_x0:src_x1]
    return out


def _bearing_step(bearing_deg: float, cells: float):
    angle = math.radians(bearing_deg)
    dx = int(round(math.sin(angle) * cells))
    dy = int(round(math.cos(angle) * cells))
    if dx == 0 and dy == 0:
        dy = 1
    return dx, dy


def _candidate_score(elev: np.ndarray, bearing: float, side_cells: int, along_cells: int):
    left_dx, left_dy = _bearing_step((bearing + 270.0) % 360.0, side_cells)
    right_dx, right_dy = _bearing_step((bearing + 90.0) % 360.0, side_cells)
    ahead_dx, ahead_dy = _bearing_step(bearing, along_cells)
    behind_dx, behind_dy = _bearing_step((bearing + 180.0) % 360.0, along_cells)

    left = _shift_no_wrap(elev, left_dx, -left_dy)
    right = _shift_no_wrap(elev, right_dx, -right_dy)
    ahead = _shift_no_wrap(elev, ahead_dx, -ahead_dy)
    behind = _shift_no_wrap(elev, behind_dx, -behind_dy)

    wall_l = left - elev
    wall_r = right - elev
    wall_rise = np.maximum(0.0, np.minimum(wall_l, wall_r))
    balance = 1.0 - np.clip(np.abs(wall_l - wall_r) / (np.abs(wall_l) + np.abs(wall_r) + 80.0), 0.0, 1.0)
    along_barrier = np.maximum(0.0, np.minimum(ahead - elev, behind - elev))
    score = wall_rise * (0.58 + 0.42 * balance) - along_barrier * 0.68
    score = np.where(np.isfinite(score), score, -1e9).astype(np.float32)
    confinement = np.where(np.isfinite(wall_rise), wall_rise, 0.0).astype(np.float32)
    return score, confinement


def build_flow_field(elev: np.ndarray, *, west: float, south: float, east: float, north: float, from_deg: float, speed_kmh: float, stability: str):
    h, w = elev.shape
    center_lat = (south + north) * 0.5
    width_m = max(1.0, (east - west) * 111320.0 * math.cos(math.radians(center_lat)))
    height_m = max(1.0, (north - south) * 111320.0)
    dx_m = width_m / max(1, w - 1)
    dy_m = height_m / max(1, h - 1)

    dz_dy, dz_dx = np.gradient(elev.astype(np.float32), dy_m, dx_m)

    base_flow = (from_deg + 180.0) % 360.0
    offsets = np.array([-40.0, -20.0, 0.0, 20.0, 40.0], dtype=np.float32)
    side_cells = max(1, int(round(260.0 / max(dx_m, dy_m))))
    along_cells = max(1, int(round(210.0 / max(dx_m, dy_m))))

    scores = []
    confinements = []
    for offset in offsets:
        score, confinement = _candidate_score(elev, (base_flow + float(offset)) % 360.0, side_cells, along_cells)
        scores.append(score)
        confinements.append(confinement)

    score_stack = np.stack(scores, axis=0)
    confinement_stack = np.stack(confinements, axis=0)
    best_idx = np.argmax(score_stack, axis=0)
    best_score = np.take_along_axis(score_stack, best_idx[None, ...], axis=0)[0]
    base_score = score_stack[2]
    best_offset = offsets[best_idx]
    best_confinement = np.take_along_axis(confinement_stack, best_idx[None, ...], axis=0)[0]

    p = stability_params(stability)
    advantage = np.maximum(0.0, best_score - base_score)
    strength = np.clip((best_score - 10.0) / 115.0, 0.0, 1.0) * np.clip(advantage / 42.0, 0.0, 1.0) * p.channel
    strength = np.where(best_score > 10.0, np.clip(strength, 0.0, 1.0), 0.0)
    deflection = np.clip(best_offset * strength, -40.0, 40.0)
    local_bearing = (base_flow + deflection) % 360.0

    confinement_slope = np.maximum(0.0, best_confinement / max(side_cells * max(dx_m, dy_m), 1.0))
    boost = np.clip(confinement_slope * 2.6, 0.0, 0.70)
    local_speed_ms = (speed_kmh / 3.6) * (1.0 + boost)

    bearing_rad = np.radians(local_bearing)
    east_unit = np.sin(bearing_rad)
    north_unit = np.cos(bearing_rad)
    slope_along = dz_dx * east_unit + dz_dy * north_unit
    vertical = np.clip(local_speed_ms * slope_along * 1.55 * p.lift, -5.5, 5.5)

    east_ms = local_speed_ms * east_unit
    north_ms = local_speed_ms * north_unit

    field = np.stack([east_ms, north_ms, vertical, boost], axis=-1).astype(np.float32)
    valid = int(np.isfinite(field).all(axis=-1).sum())
    field = np.nan_to_num(field, nan=0.0, posinf=0.0, neginf=0.0)
    return field, valid
