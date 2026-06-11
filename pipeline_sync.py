"""
pipeline_sync.py — Multimodal Timestamp Synchronisation Engine
==============================================================
UNIBEN Biodiversity Pipeline · Root Module

Algorithmically merges drone image upload metadata with the closest
environmental sensor reading using pandas.merge_asof within a strict
±2-minute tolerance window.

Usage
-----
    from pipeline_sync import sync_image_to_sensor

    result = sync_image_to_sensor(
        image_path="data/uploads/abc123.jpg",
        db_path="data/biodiversity.db",
        tolerance_seconds=120,   # default: 120s = 2 minutes
    )
    print(result)

The function returns a SyncResult TypedDict with keys:
    - synced      : bool
    - image_path  : str
    - image_ts    : datetime | None  (EXIF or file-mtime fallback)
    - matched_row : dict | None      (nearest sensor reading within window)
    - delta_s     : float | None     (time delta in seconds, signed)
    - bucket      : "synced" | "unsynced"
"""

from __future__ import annotations

import sqlite3
import struct
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Optional dependency guard — pandas is required; Pillow/piexif are optional
# but strongly recommended for EXIF extraction.
# ---------------------------------------------------------------------------
try:
    import pandas as pd
    _HAS_PANDAS = True
except ImportError as _pandas_err:
    _HAS_PANDAS = False
    _PANDAS_ERR = _pandas_err

try:
    from PIL import Image as _PILImage
    from PIL.ExifTags import TAGS as _EXIF_TAGS
    _HAS_PIL = True
except ImportError:
    _HAS_PIL = False


# ---------------------------------------------------------------------------
# Type alias
# ---------------------------------------------------------------------------

class SyncResult(dict):
    """Lightweight TypedDict-style wrapper for merge_asof results."""
    pass


# ---------------------------------------------------------------------------
# EXIF timestamp extraction
# ---------------------------------------------------------------------------

_EXIF_DATE_TAGS = ("DateTimeOriginal", "DateTime", "DateTimeDigitized")
_EXIF_FMT       = "%Y:%m:%d %H:%M:%S"


def _extract_exif_timestamp(image_path: Path) -> Optional[datetime]:
    """
    Extract creation timestamp from image EXIF metadata.

    Attempts PIL first (supports JPEG / TIFF / PNG with embedded EXIF),
    falls back to file modification time if EXIF is absent or unreadable.

    Returns a timezone-aware UTC datetime, or None if all attempts fail.
    """
    if _HAS_PIL:
        try:
            img  = _PILImage.open(image_path)
            exif = img._getexif() if hasattr(img, "_getexif") else None
            if exif:
                tag_map = {v: k for k, v in _EXIF_TAGS.items()}
                for tag_name in _EXIF_DATE_TAGS:
                    tag_id = tag_map.get(tag_name)
                    if tag_id and tag_id in exif:
                        raw = exif[tag_id]
                        try:
                            dt = datetime.strptime(raw, _EXIF_FMT)
                            return dt.replace(tzinfo=timezone.utc)
                        except ValueError:
                            continue
        except Exception:
            pass  # fall through to mtime

    # Fallback: file modification time
    try:
        mtime = image_path.stat().st_mtime
        return datetime.fromtimestamp(mtime, tz=timezone.utc)
    except OSError:
        return None


# ---------------------------------------------------------------------------
# SQLite sensor loader
# ---------------------------------------------------------------------------

def _load_sensor_readings(db_path: Path) -> "pd.DataFrame":
    """
    Load the full sensor_readings table into a pandas DataFrame sorted by
    observed_at ascending (required for merge_asof direction='nearest').
    """
    if not _HAS_PANDAS:
        raise ImportError(
            f"pandas is required for pipeline_sync: {_PANDAS_ERR}"
        )

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        """
        SELECT
            id,
            device_id,
            temperature_c,
            humidity_percent,
            pressure_hPa,
            light_lux,
            sound_db,
            latitude,
            longitude,
            altitude_m,
            observed_at,
            received_at,
            notes
        FROM sensor_readings
        ORDER BY observed_at ASC
        """
    ).fetchall()
    conn.close()

    if not rows:
        return pd.DataFrame()

    records = [dict(r) for r in rows]
    df = pd.DataFrame(records)

    # Parse timestamps — SQLite stores them as ISO-8601 strings
    df["observed_at"] = pd.to_datetime(df["observed_at"], utc=True)
    df["received_at"] = pd.to_datetime(df["received_at"], utc=True)

    return df.sort_values("observed_at").reset_index(drop=True)


# ---------------------------------------------------------------------------
# Core merge_asof synchronisation function
# ---------------------------------------------------------------------------

def sync_image_to_sensor(
    image_path:         str | Path,
    db_path:            str | Path = Path("data/biodiversity.db"),
    tolerance_seconds:  int        = 120,
) -> SyncResult:
    """
    Bind a drone image to the nearest environmental sensor packet.

    Algorithm
    ---------
    1. Extract EXIF (or mtime fallback) timestamp from the image.
    2. Load sensor_readings from SQLite into a pandas DataFrame.
    3. Run pandas.merge_asof with direction='nearest' and a strict
       tolerance of `tolerance_seconds` seconds.
    4. If a match is found within tolerance → bucket = "synced".
       Otherwise → bucket = "unsynced".

    Parameters
    ----------
    image_path        : Path to the uploaded image file.
    db_path           : Path to data/biodiversity.db (default is relative
                        to the project root).
    tolerance_seconds : Maximum allowed time delta (absolute) in seconds.
                        Default = 120 (2 minutes forward/backward).

    Returns
    -------
    SyncResult dict with keys:
        synced       (bool)
        image_path   (str)
        image_ts     (str ISO-8601 or None)
        matched_row  (dict or None)
        delta_s      (float or None — signed seconds, image_ts − sensor_ts)
        bucket       ("synced" | "unsynced")
    """
    image_path = Path(image_path)
    db_path    = Path(db_path)

    # Step 1 — EXIF timestamp
    image_ts = _extract_exif_timestamp(image_path)

    base_result: SyncResult = SyncResult(
        synced=False,
        image_path=str(image_path),
        image_ts=image_ts.isoformat() if image_ts else None,
        matched_row=None,
        delta_s=None,
        bucket="unsynced",
    )

    if image_ts is None:
        return base_result

    # Step 2 — Load sensor readings
    try:
        sensor_df = _load_sensor_readings(db_path)
    except Exception as exc:
        base_result["error"] = f"DB load failed: {exc}"
        return base_result

    if sensor_df.empty:
        return base_result

    # Step 3 — merge_asof
    # merge_asof requires both keys to be sorted; sensor_df is already sorted
    # by observed_at.  We create a one-row DataFrame for the image timestamp.
    image_df = pd.DataFrame({"image_ts": [pd.Timestamp(image_ts)]})
    image_df = image_df.sort_values("image_ts").reset_index(drop=True)

    tolerance_td = pd.Timedelta(seconds=tolerance_seconds)

    merged = pd.merge_asof(
        left=image_df,
        right=sensor_df,
        left_on="image_ts",
        right_on="observed_at",
        direction="nearest",
        tolerance=tolerance_td,
    )

    # Step 4 — check if a match was found
    first = merged.iloc[0]
    if pd.isna(first.get("id")):
        # No sensor within tolerance window → unsynced bucket
        return base_result

    matched = {
        k: (v.isoformat() if isinstance(v, pd.Timestamp) else v)
        for k, v in first.to_dict().items()
        if k != "image_ts"
    }

    delta_s = (image_ts - first["observed_at"].to_pydatetime()).total_seconds()

    return SyncResult(
        synced=True,
        image_path=str(image_path),
        image_ts=image_ts.isoformat(),
        matched_row=matched,
        delta_s=round(delta_s, 3),
        bucket="synced",
    )


# ---------------------------------------------------------------------------
# Batch sync — process a list of image paths
# ---------------------------------------------------------------------------

def batch_sync(
    image_paths:       List[str | Path],
    db_path:           str | Path = Path("data/biodiversity.db"),
    tolerance_seconds: int        = 120,
) -> Dict[str, List[SyncResult]]:
    """
    Synchronise multiple images against the sensor database in one pass.

    Returns a dict with two keys:
        "synced"   — list of SyncResult where bucket == "synced"
        "unsynced" — list of SyncResult where bucket == "unsynced"
    """
    buckets: Dict[str, List[SyncResult]] = {"synced": [], "unsynced": []}

    for path in image_paths:
        result = sync_image_to_sensor(path, db_path, tolerance_seconds)
        buckets[result["bucket"]].append(result)

    return buckets


# ---------------------------------------------------------------------------
# CLI entry point for quick testing
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    import json

    if len(sys.argv) < 2:
        print("Usage: python pipeline_sync.py <image_path> [db_path] [tolerance_s]")
        sys.exit(1)

    img   = sys.argv[1]
    db    = sys.argv[2] if len(sys.argv) > 2 else "data/biodiversity.db"
    tol   = int(sys.argv[3]) if len(sys.argv) > 3 else 120

    result = sync_image_to_sensor(img, db, tol)
    print(json.dumps(result, indent=2, default=str))
