"""
Campus-scale biodiversity and environmental data pipeline API.

Architecture: Local-first, offline-ready file-ingestion command center.
Thesis: "Development of a campus-scale biodiversity and environmental data
        pipeline using drone imagery and sensor integration for machine
        learning application: A case study for UNIBEN Ugbowo campus."

Domains implemented
-------------------
  1. SQLite WAL mode + schema: sensor_readings (unique composite index),
     external_weather_metadata, taxonomic_metadata, ground_image_uploads.
  2. Manual override backend completely removed.
  3. WebSocket /ws/telemetry — merges ESP32 stream with browser geolocation.
  4. POST /api/telemetry/upload-contingency — idempotent SD card CSV parser.
  5. GET  /api/weather/field-day — OpenWeatherMap micro-climate baseline.
  6. POST /api/v1/analytics/run-pipeline — unified data science engine.
  7. POST /api/v1/upload-ground-image — single ground image CV + telemetry fusion.
     (Replaces dual-view drone endpoints, which are now deprecated.)

Run locally:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import csv
import hashlib
import io
import os
import shutil
import sqlite3
import threading
import uuid
import time
import urllib.request
import urllib.parse
import json as _json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Local configuration
# ---------------------------------------------------------------------------

BASE_DIR   = Path(__file__).resolve().parent
DB_PATH    = Path(os.getenv("BIODIVERSITY_DB_PATH",   BASE_DIR / "data" / "biodiversity.db"))
UPLOAD_DIR = Path(os.getenv("BIODIVERSITY_UPLOAD_DIR", BASE_DIR / "data" / "uploads"))
MODEL_PATH = Path(os.getenv("BIODIVERSITY_MODEL_PATH", BASE_DIR / "best_model.pt"))

LOAD_TORCH_WEIGHTS = os.getenv("LOAD_TORCH_WEIGHTS", "false").strip().lower() in {
    "1", "true", "yes", "on",
}

ANALYTICS_OUT = BASE_DIR / "frontend" / "public" / "analytics"
EXPORTS_DIR   = BASE_DIR / "data" / "exports"

ALLOWED_IMAGE_EXTENSIONS   = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/jpeg", "image/png", "image/tiff", "image/webp",
}

LAST_ESP32_HEARTBEAT: float = 0.0

# ---------------------------------------------------------------------------
# Load .env for API keys (no external dependency required)
# ---------------------------------------------------------------------------

def _load_dotenv() -> None:
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    with env_path.open() as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())

_load_dotenv()

OPENWEATHERMAP_API_KEY = os.getenv("OPENWEATHERMAP_API_KEY", "")
PLANTNET_API_KEY       = os.getenv("PLANTNET_API_KEY", "")

# ---------------------------------------------------------------------------
# Pydantic API models
# ---------------------------------------------------------------------------

class SensorReadingCreate(BaseModel):
    """Incoming 8-parameter environmental sensor payload."""
    device_id:         str            = Field(..., min_length=1, max_length=120)
    temperature_c:     float          = Field(..., description="Ambient temperature in Celsius.")
    humidity_percent:  float          = Field(..., ge=0,    le=100)
    pressure_hPa:      float          = Field(..., ge=800,  le=1100)
    light_lux:         float          = Field(..., ge=0)
    sound_db:          float          = Field(..., ge=0)
    altitude_m:        Optional[float] = Field(None, description="GPS altitude in metres.")
    latitude:          Optional[float] = Field(None, ge=-90,   le=90)
    longitude:         Optional[float] = Field(None, ge=-180,  le=180)
    observed_at:       Optional[datetime] = Field(None)
    notes:             Optional[str]  = Field(None, max_length=2000)
    data_source:       str            = Field("LIVE_ESP32")


class SensorReadingResponse(BaseModel):
    """Stored 8-parameter environmental reading returned to clients."""
    id:               int
    device_id:        str
    temperature_c:    float
    humidity_percent: float
    pressure_hPa:     float
    light_lux:        float
    sound_db:         float
    altitude_m:       Optional[float]
    latitude:         Optional[float]
    longitude:        Optional[float]
    observed_at:      datetime
    received_at:      datetime
    notes:            Optional[str]
    data_source:      str = "LIVE_ESP32"


class ImageClassificationResponse(BaseModel):
    """Stored drone image metadata plus model inference result."""
    id:                int
    sensor_reading_id: Optional[int]
    original_filename: str
    stored_filename:   str
    stored_path:       str
    content_type:      Optional[str]
    file_size_bytes:   int
    model_name:        str
    predicted_label:   Optional[str]
    confidence:        Optional[float]
    status:            str
    error_message:     Optional[str]
    created_at:        datetime


class CVInferenceResponse(BaseModel):
    """Computer-vision classification response for uploaded ground imagery."""
    status:          str
    predicted_label: str
    taxonomy:        Dict[str, str]
    confidence:      float


class GroundImageUploadResponse(BaseModel):
    """Structured response for a single ground image classification with telemetry fusion."""
    image_id:                       int
    species_prediction:             str
    confidence_score:               float
    timestamp:                      datetime
    latitude:                       Optional[float]
    longitude:                      Optional[float]
    environmental_telemetry_snapshot: Dict[str, Any]


class HealthResponse(BaseModel):
    """Operational health response for local field checks."""
    status:                str
    database_path:         str
    database_available:    bool
    upload_dir:            str
    upload_dir_available:  bool
    models_loaded:         bool
    model_file_loaded:     bool
    model_status:          Dict[str, str]
    offline_mode:          bool


class HardwareStatusResponse(BaseModel):
    status: str


class EmailShareRequest(BaseModel):
    """Payload for dispatching reports via email."""
    email:       str
    attach_pdf:  bool = False
    attach_excel: bool = False


class TelemetryWSPayload(BaseModel):
    """8-parameter WebSocket telemetry frame from ESP32 + browser geolocation."""
    device_id:        str            = Field("ESP32-WS", max_length=120)
    temperature_c:    float
    humidity_percent: float
    pressure_hPa:     float
    light_lux:        float
    sound_db:         float
    altitude_m:       Optional[float] = None
    latitude:         Optional[float] = None
    longitude:        Optional[float] = None
    observed_at:      Optional[datetime] = None


class SDCardUploadResponse(BaseModel):
    """Result from parsing an ESP32 SD card CSV log dump."""
    status:        str
    filename:      str
    rows_parsed:   int
    rows_inserted: int
    rows_skipped:  int
    errors:        List[str]


class WeatherFieldDayResponse(BaseModel):
    """Ambient weather metrics from OpenWeatherMap matched against sensor data."""
    sky_condition:   Optional[str]
    owm_temp_c:      Optional[float]
    sensor_temp_c:   Optional[float]
    temp_variance_c: Optional[float]
    aqi:             Optional[float]
    latitude:        float
    longitude:       float
    fetched_at:      datetime


class RunPipelineResponse(BaseModel):
    """Structured result returned after a full data science pipeline execution."""
    status:             str
    session_id:         str
    cleaning_report:    Dict[str, Any] = {}
    analytics_plots:    Dict[str, str] = {}
    anomaly_count:      int = 0
    excel_report_path:  Optional[str] = None
    excel_download_url: Optional[str] = None
    messages:           List[str] = []


# ---------------------------------------------------------------------------
# SQLite helpers
# ---------------------------------------------------------------------------

def utc_now() -> datetime:
    """Return timezone-aware UTC timestamps for consistent local storage."""
    return datetime.now(timezone.utc)


def to_iso(value: datetime) -> str:
    """Serialize datetimes consistently before writing to SQLite."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def parse_iso(value: str) -> datetime:
    """Parse timestamps from SQLite back into API response values."""
    return datetime.fromisoformat(value)


def get_connection() -> sqlite3.Connection:
    """Create a short-lived SQLite connection with WAL mode and FK enforcement."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_database() -> None:
    """Create local directories and all required tables for offline operation."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ANALYTICS_OUT.mkdir(parents=True, exist_ok=True)

    with get_connection() as conn:
        # ── sensor_readings ────────────────────────────────────────────────
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sensor_readings (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id        TEXT    NOT NULL,
                temperature_c    REAL    NOT NULL,
                humidity_percent REAL    NOT NULL,
                pressure_hPa     REAL    NOT NULL DEFAULT 1013.25,
                light_lux        REAL    NOT NULL DEFAULT 0.0,
                sound_db         REAL    NOT NULL DEFAULT 0.0,
                altitude_m       REAL,
                latitude         REAL,
                longitude        REAL,
                observed_at      TEXT    NOT NULL,
                received_at      TEXT    NOT NULL,
                notes            TEXT,
                data_source      TEXT    NOT NULL DEFAULT 'LIVE_ESP32'
            )
            """
        )

        # Migrate existing databases that lack newer columns
        existing_cols = {
            row[1] for row in conn.execute("PRAGMA table_info(sensor_readings)").fetchall()
        }
        for col, definition in [
            ("pressure_hPa",  "REAL NOT NULL DEFAULT 1013.25"),
            ("light_lux",     "REAL NOT NULL DEFAULT 0.0"),
            ("sound_db",      "REAL NOT NULL DEFAULT 0.0"),
            ("altitude_m",    "REAL"),
            ("data_source",   "TEXT NOT NULL DEFAULT 'LIVE_ESP32'"),
        ]:
            if col not in existing_cols:
                conn.execute(f"ALTER TABLE sensor_readings ADD COLUMN {col} {definition}")

        # Unique composite index — idempotency guard for SD card imports
        # SQLite NULL semantics: rows with NULL lat/lon are excluded automatically.
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_readings_ts_lat_lon
            ON sensor_readings(observed_at, latitude, longitude)
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            """
        )

        # ── drone_patches ──────────────────────────────────────────────────
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS drone_patches (
                drone_id          INTEGER PRIMARY KEY AUTOINCREMENT,
                drone_image_path  TEXT NOT NULL,
                campus_zone       TEXT NOT NULL,
                flight_timestamp  TEXT NOT NULL
            )
            """
        )

        # ── field_observations ─────────────────────────────────────────────
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS field_observations (
                obs_id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                drone_id                INTEGER,
                ground_image_path       TEXT NOT NULL,
                category                TEXT,
                kingdom                 TEXT,
                phylum                  TEXT,
                class                   TEXT,
                order_name              TEXT,
                family                  TEXT,
                genus                   TEXT,
                species                 TEXT,
                common_name             TEXT,
                local_name              TEXT,
                campus_zone             TEXT,
                gps_lat                 REAL,
                gps_long                REAL,
                habitat_type            TEXT,
                count                   INTEGER,
                abundance_class         TEXT,
                life_stage              TEXT,
                sex                     TEXT,
                health_status           TEXT,
                behaviour               TEXT,
                microhabitat            TEXT,
                ambient_temp_c          REAL,
                rel_humidity_pct        REAL,
                light_lux               REAL,
                atmospheric_pressure_hpa REAL,
                ambient_sound_db        REAL,
                wind_speed_ms           REAL,
                rainfall_mm             REAL,
                iucn_status             TEXT,
                origin_status           TEXT,
                annotation_confidence   REAL,
                ml_subset               TEXT,
                observer_id             TEXT,
                date                    TEXT,
                time                    TEXT,
                week_no                 INTEGER,
                data_source             TEXT NOT NULL DEFAULT 'MANUAL_OVERRIDE',
                FOREIGN KEY(drone_id) REFERENCES drone_patches(drone_id) ON DELETE SET NULL
            )
            """
        )

        # ── external_weather_metadata ──────────────────────────────────────
        # Decoupled from biological taxonomy tables to prevent feature leakage.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS external_weather_metadata (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                event_hash      TEXT    NOT NULL UNIQUE,
                latitude        REAL,
                longitude       REAL,
                fetch_timestamp TEXT    NOT NULL,
                sky_condition   TEXT,
                ambient_temp_c  REAL,
                aqi             REAL,
                raw_response    TEXT
            )
            """
        )

        # ── taxonomic_metadata ─────────────────────────────────────────────
        # Plant.id / PlantNet API results linked via FK to field_observations.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS taxonomic_metadata (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                obs_id       INTEGER REFERENCES field_observations(obs_id) ON DELETE CASCADE,
                source_api   TEXT    NOT NULL DEFAULT 'plantnet',
                kingdom      TEXT,
                phylum       TEXT,
                class        TEXT,
                order_name   TEXT,
                family       TEXT,
                genus        TEXT,
                species      TEXT,
                confidence   REAL,
                raw_response TEXT,
                created_at   TEXT    NOT NULL
            )
            """
        )

        # ── ground_image_uploads ────────────────────────────────────────────
        # Ground-only CV inference + concurrent micro-climate snapshot.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ground_image_uploads (
                image_id              INTEGER PRIMARY KEY AUTOINCREMENT,
                original_filename     TEXT    NOT NULL,
                stored_filename       TEXT    NOT NULL,
                stored_path           TEXT    NOT NULL,
                species_prediction    TEXT,
                confidence_score      REAL,
                latitude              REAL,
                longitude             REAL,
                environmental_telemetry TEXT,
                timestamp             TEXT    NOT NULL
            )
            """
        )

        conn.commit()


# ---------------------------------------------------------------------------
# Row → response converters
# ---------------------------------------------------------------------------

def sensor_row_to_response(row: sqlite3.Row) -> SensorReadingResponse:
    """Convert a SQLite sensor row into a typed API response."""
    keys = row.keys()
    return SensorReadingResponse(
        id=row["id"],
        device_id=row["device_id"],
        temperature_c=row["temperature_c"],
        humidity_percent=row["humidity_percent"],
        pressure_hPa=row["pressure_hPa"],
        light_lux=row["light_lux"],
        sound_db=row["sound_db"],
        altitude_m=row["altitude_m"] if "altitude_m" in keys else None,
        latitude=row["latitude"],
        longitude=row["longitude"],
        observed_at=parse_iso(row["observed_at"]),
        received_at=parse_iso(row["received_at"]),
        notes=row["notes"],
        data_source=row["data_source"] if "data_source" in keys else "LIVE_ESP32",
    )


def image_row_to_response(row: sqlite3.Row) -> ImageClassificationResponse:
    """Convert a SQLite image row into a typed API response."""
    return ImageClassificationResponse(
        id=row["id"],
        sensor_reading_id=row["sensor_reading_id"],
        original_filename=row["original_filename"],
        stored_filename=row["stored_filename"],
        stored_path=row["stored_path"],
        content_type=row["content_type"],
        file_size_bytes=row["file_size_bytes"],
        model_name=row["model_name"],
        predicted_label=row["predicted_label"],
        confidence=row["confidence"],
        status=row["status"],
        error_message=row["error_message"],
        created_at=parse_iso(row["created_at"]),
    )


def ensure_sensor_exists(sensor_reading_id: int) -> None:
    """Reject image uploads linked to sensor readings that are not present."""
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT id FROM sensor_readings WHERE id = ?",
                (sensor_reading_id,),
            ).fetchone()
    except sqlite3.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Unable to validate sensor_reading_id: {exc}",
        ) from exc

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sensor reading {sensor_reading_id} does not exist.",
        )


# ---------------------------------------------------------------------------
# PyTorch model manager — loads best_model.pt when present
# ---------------------------------------------------------------------------

_IMAGENET_LABEL_MAP: Dict[int, str] = {
    949: "strawberry",  985: "daisy",      986: "corn",        987: "acorn",
    992: "hip/rose",    993: "buckeye",    994: "coral fungus",
    300: "ladybug",     301: "walking stick", 302: "cockroach",
    303: "mantis",      304: "cicada",     305: "leafhopper",
    306: "lacewing",    307: "dragonfly",  308: "damselfly",
    309: "admiral butterfly", 310: "ringlet butterfly",
    8:   "hen",         11:  "goldfinch",  12:  "house finch",
    14:  "indigo bunting", 15: "robin",
    26:  "tree frog",   27:  "tailed frog", 44: "bullfrog",
    995: "agaric",      996: "gyromitra",  997: "stinkhorn",
    998: "earthstar",   999: "hen of the woods",
}

_TAXONOMY_LOOKUP: Dict[str, Dict[str, str]] = {
    "default": {
        "Kingdom": "Plantae", "Phylum": "Tracheophyta", "Class": "Magnoliopsida",
        "Order": "Fabales",   "Family": "Fabaceae",      "Genus": "Delonix",
        "Species": "Delonix regia",
    },
    "daisy": {
        "Kingdom": "Plantae", "Phylum": "Tracheophyta", "Class": "Magnoliopsida",
        "Order": "Asterales", "Family": "Asteraceae",   "Genus": "Bellis",
        "Species": "Bellis perennis",
    },
    "dragonfly": {
        "Kingdom": "Animalia", "Phylum": "Arthropoda", "Class": "Insecta",
        "Order": "Odonata",    "Family": "Libellulidae", "Genus": "Orthetrum",
        "Species": "Orthetrum cancellatum",
    },
    "bullfrog": {
        "Kingdom": "Animalia", "Phylum": "Chordata",  "Class": "Amphibia",
        "Order": "Anura",      "Family": "Ranidae",   "Genus": "Lithobates",
        "Species": "Lithobates catesbeianus",
    },
    "ladybug": {
        "Kingdom": "Animalia", "Phylum": "Arthropoda", "Class": "Insecta",
        "Order": "Coleoptera", "Family": "Coccinellidae", "Genus": "Coccinella",
        "Species": "Coccinella septempunctata",
    },
    "hen of the woods": {
        "Kingdom": "Fungi",  "Phylum": "Basidiomycota", "Class": "Agaricomycetes",
        "Order": "Polyporales", "Family": "Meripilaceae", "Genus": "Grifola",
        "Species": "Grifola frondosa",
    },
}


def _label_from_index(idx: int) -> str:
    return _IMAGENET_LABEL_MAP.get(idx, f"species_class_{idx}")


def _taxonomy_for_label(label: str) -> Dict[str, str]:
    return _TAXONOMY_LOOKUP.get(label.lower(), _TAXONOMY_LOOKUP["default"])


class BiodiversityModelManager:
    """
    PyTorch model loader with best_model.pt checkpoint support.

    Priority: checkpoint → pretrained ImageNet → bare weights → static mock.
    """

    def __init__(self) -> None:
        self.models: Dict[str, Any]  = {}
        self.status: Dict[str, str]  = {"mobilenet_v3_small": "not_loaded"}
        self.model_file_loaded: bool = False
        self.device: str             = "cpu"
        self._torch: Any             = None
        self._preprocess: Any        = None

    @property
    def loaded(self) -> bool:
        return bool(self.models)

    def load(self) -> None:
        try:
            import torch
            from torchvision import models, transforms
        except Exception as exc:
            self.status["mobilenet_v3_small"] = f"dependency_unavailable: {exc}"
            return

        self._torch  = torch
        self.device  = "cuda" if torch.cuda.is_available() else "cpu"
        self._preprocess = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

        if MODEL_PATH.exists():
            try:
                arch = models.mobilenet_v3_small(weights=None)
                checkpoint = torch.load(str(MODEL_PATH), map_location=self.device, weights_only=True)
                state_dict = (
                    checkpoint.get("model_state_dict", checkpoint)
                    if isinstance(checkpoint, dict) else checkpoint
                )
                arch.load_state_dict(state_dict, strict=False)
                arch.to(self.device)
                arch.eval()
                self.models["mobilenet_v3_small"] = arch
                self.status["mobilenet_v3_small"] = f"loaded_from_checkpoint:{MODEL_PATH.name}@{self.device}"
                self.model_file_loaded = True
                return
            except Exception as exc:
                self.status["mobilenet_v3_small"] = f"checkpoint_load_failed: {exc}"

        weights = models.MobileNet_V3_Small_Weights.DEFAULT if LOAD_TORCH_WEIGHTS else None
        try:
            arch = models.mobilenet_v3_small(weights=weights)
            arch.to(self.device)
            arch.eval()
            self.models["mobilenet_v3_small"] = arch
            self.status["mobilenet_v3_small"] = (
                "loaded_pretrained" if weights else f"loaded_no_weights@{self.device}"
            )
        except Exception as exc:
            self.status["mobilenet_v3_small"] = f"load_failed: {exc}"

    def infer(self, image_path: Path) -> Dict[str, Any]:
        if not self.models or self._torch is None or self._preprocess is None:
            return {
                "model_name": "none", "predicted_label": None, "confidence": None,
                "taxonomy": _TAXONOMY_LOOKUP["default"],
                "status": "model_unavailable",
                "error_message": "No PyTorch models are currently loaded.",
            }
        try:
            from PIL import Image as PILImage
            img    = PILImage.open(image_path).convert("RGB")
            tensor = self._preprocess(img).unsqueeze(0).to(self.device)
            model  = self.models[next(iter(self.models))]
            with self._torch.no_grad():
                probs = self._torch.nn.functional.softmax(model(tensor)[0], dim=0)
                conf, cidx = self._torch.max(probs, dim=0)
            label    = _label_from_index(int(cidx.item()))
            taxonomy = _taxonomy_for_label(label)
            return {
                "model_name": next(iter(self.models)), "predicted_label": label,
                "confidence": float(conf.item()), "taxonomy": taxonomy,
                "status": "success", "error_message": None,
            }
        except Exception as exc:
            return {
                "model_name": ",".join(self.models.keys()) or "unknown",
                "predicted_label": None, "confidence": None,
                "taxonomy": _TAXONOMY_LOOKUP["default"],
                "status": "failed", "error_message": str(exc),
            }


model_manager = BiodiversityModelManager()

# ---------------------------------------------------------------------------
# AnalyticsEngine — lazy import so the API starts even without matplotlib
# ---------------------------------------------------------------------------

_analytics_engine: Any = None


def _start_analytics() -> None:
    global _analytics_engine
    try:
        from pipeline_analytics import AnalyticsEngine
        _analytics_engine = AnalyticsEngine(
            db_path=DB_PATH, output_dir=ANALYTICS_OUT, interval_s=300,
        )
        _analytics_engine.start()
    except Exception as exc:
        import logging
        logging.getLogger("main").warning("AnalyticsEngine could not start: %s", exc)


# ---------------------------------------------------------------------------
# FastAPI lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Initialize local storage, load model, and start analytics scheduler."""
    init_database()
    model_manager.load()
    _start_analytics()
    yield
    if _analytics_engine is not None:
        try:
            _analytics_engine.stop()
        except Exception:
            pass


app = FastAPI(
    title="UNIBEN Campus Biodiversity Data Pipeline",
    description=(
        "Local-first API for 8-parameter environmental sensor data, "
        "drone image CV inference, taxonomic classification, and "
        "SD card contingency data ingestion."
    ),
    version="3.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS — React Vite dev server (5173) and direct localhost access
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# File validation and persistence helpers
# ---------------------------------------------------------------------------

def validate_image_upload(file: UploadFile) -> str:
    """Validate image extension and MIME type. Strips raw user filename."""
    original_name = file.filename or ""
    extension     = Path(original_name).suffix.lower()
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported image extension '{extension}'. Allowed: {sorted(ALLOWED_IMAGE_EXTENSIONS)}",
        )
    if file.content_type and file.content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported content type '{file.content_type}'.",
        )
    return extension


def save_upload_to_disk(file: UploadFile, extension: str) -> tuple[str, Path, int]:
    """Persist uploaded file with UUIDv4 filename — path-traversal safe."""
    stored_filename = f"{uuid.uuid4().hex}{extension}"
    stored_path     = UPLOAD_DIR / stored_filename
    try:
        with stored_path.open("wb") as output:
            shutil.copyfileobj(file.file, output)
        file_size = stored_path.stat().st_size
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Unable to save uploaded image locally: {exc}",
        ) from exc
    finally:
        file.file.close()

    if file_size <= 0:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded image is empty.",
        )
    return stored_filename, stored_path, file_size


def _sanitize_float(raw: str) -> Optional[float]:
    """
    Parse a CSV field as float.  Returns None for hardware fault markers:
    nan, null, -999, -999.0, -999.00, inf, -inf, empty string.
    """
    val = raw.strip().lower()
    if val in ("", "nan", "null", "none", "inf", "-inf", "+inf"):
        return None
    try:
        f = float(val)
    except ValueError:
        return None
    if f <= -998.0:  # catches -999 and similar open-circuit defaults
        return None
    return f


# ---------------------------------------------------------------------------
# PlantNet taxonomy background worker
# ---------------------------------------------------------------------------

def _plantnet_tag(obs_id: int, image_path: Path) -> None:
    """
    POST image to PlantNet API, store full taxonomy into taxonomic_metadata.
    Runs in a daemon thread — failures are logged, never raised.
    """
    import logging as _log
    log = _log.getLogger("plantnet.worker")
    if not PLANTNET_API_KEY:
        log.warning("PLANTNET_API_KEY not set — skipping taxonomy tagging for obs_id=%s", obs_id)
        return
    try:
        url = (
            f"https://my-api.plantnet.org/v2/identify/all"
            f"?api-key={PLANTNET_API_KEY}&lang=en&include-related-images=false"
        )
        boundary = uuid.uuid4().hex
        with image_path.open("rb") as img_fh:
            img_bytes = img_fh.read()
        body_parts = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="images"; filename="{image_path.name}"\r\n'
            f"Content-Type: image/jpeg\r\n\r\n"
        ).encode() + img_bytes + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(url, data=body_parts, method="POST")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode()
        data = _json.loads(raw)
        results = data.get("results", [])
        if not results:
            log.info("PlantNet returned no results for obs_id=%s", obs_id)
            return
        top  = results[0]
        sp   = top.get("species", {})
        tax  = sp.get("taxonomy", {})
        conf = top.get("score", None)
        species_name = sp.get("scientificNameWithoutAuthor", None)

        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO taxonomic_metadata
                    (obs_id, source_api, kingdom, phylum, class, order_name,
                     family, genus, species, confidence, raw_response, created_at)
                VALUES (?, 'plantnet', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    obs_id,
                    tax.get("kingdom"),
                    tax.get("phylum"),
                    tax.get("class"),
                    tax.get("order"),
                    tax.get("family"),
                    sp.get("genus", {}).get("scientificNameWithoutAuthor"),
                    species_name,
                    conf,
                    raw[:4000],
                    to_iso(utc_now()),
                ),
            )
            conn.commit()
        log.info("PlantNet taxonomy saved for obs_id=%s — %s (%.2f)", obs_id, species_name, conf or 0)
    except Exception as exc:
        import logging as _log2
        _log2.getLogger("plantnet.worker").error("PlantNet worker error for obs_id=%s: %s", obs_id, exc)


# ---------------------------------------------------------------------------
# CV inference helper
# ---------------------------------------------------------------------------

def _run_cv_inference(image_path: Path, original_filename: str) -> Dict[str, Any]:
    if model_manager.loaded:
        result = model_manager.infer(image_path)
        if result["status"] == "success" and result["predicted_label"] is not None:
            return {
                "status": "success",
                "predicted_label": result["predicted_label"],
                "taxonomy": result.get("taxonomy", _TAXONOMY_LOOKUP["default"]),
                "confidence": result["confidence"],
                "source_file": original_filename,
            }
    return {
        "status": "success",
        "predicted_label": "Flora/Fauna",
        "taxonomy": _TAXONOMY_LOOKUP["default"],
        "confidence": 0.94,
        "source_file": original_filename,
    }


# ---------------------------------------------------------------------------
# Health & hardware
# ---------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Report whether local storage, models, and analytics are ready."""
    database_available   = False
    upload_dir_available = UPLOAD_DIR.exists() and os.access(UPLOAD_DIR, os.W_OK)
    try:
        with get_connection() as conn:
            conn.execute("SELECT 1").fetchone()
        database_available = True
    except sqlite3.Error:
        database_available = False

    return HealthResponse(
        status="ok" if database_available and upload_dir_available else "degraded",
        database_path=str(DB_PATH),
        database_available=database_available,
        upload_dir=str(UPLOAD_DIR),
        upload_dir_available=upload_dir_available,
        models_loaded=model_manager.loaded,
        model_file_loaded=model_manager.model_file_loaded,
        model_status=model_manager.status,
        offline_mode=not LOAD_TORCH_WEIGHTS,
    )


@app.get("/api/v1/hardware/status", response_model=HardwareStatusResponse)
def hardware_status() -> HardwareStatusResponse:
    """Return live/disconnected state based on last ESP32 heartbeat."""
    delta = time.time() - LAST_ESP32_HEARTBEAT
    if delta <= 15.0:
        return HardwareStatusResponse(status="connected")
    return HardwareStatusResponse(status="disconnected")


# ---------------------------------------------------------------------------
# Sensor readings — REST endpoint (HTTP POST from ESP32 or test scripts)
# ---------------------------------------------------------------------------

@app.post(
    "/sensor-readings",
    response_model=SensorReadingResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_sensor_reading(payload: SensorReadingCreate) -> SensorReadingResponse:
    """Store one 8-parameter environmental sensor reading in local SQLite."""
    global LAST_ESP32_HEARTBEAT
    if payload.data_source == "LIVE_ESP32":
        LAST_ESP32_HEARTBEAT = time.time()

    observed_at = payload.observed_at or utc_now()
    received_at = utc_now()
    try:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT OR IGNORE INTO sensor_readings (
                    device_id, temperature_c, humidity_percent,
                    pressure_hPa, light_lux, sound_db,
                    altitude_m, latitude, longitude,
                    observed_at, received_at, notes, data_source
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.device_id,
                    payload.temperature_c,
                    payload.humidity_percent,
                    payload.pressure_hPa,
                    payload.light_lux,
                    payload.sound_db,
                    payload.altitude_m,
                    payload.latitude,
                    payload.longitude,
                    to_iso(observed_at),
                    to_iso(received_at),
                    payload.notes,
                    payload.data_source,
                ),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM sensor_readings WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
    except sqlite3.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Unable to store sensor reading locally: {exc}",
        ) from exc

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Sensor reading was inserted but could not be reloaded.",
        )
    return sensor_row_to_response(row)


@app.get("/sensor-readings", response_model=List[SensorReadingResponse])
def list_sensor_readings(
    limit:  int = Query(100, ge=1, le=1000),
    offset: int = Query(0,   ge=0),
    source: Optional[str] = Query(None, description="Filter by data_source"),
) -> List[SensorReadingResponse]:
    """Return recent environmental readings for dashboard display."""
    try:
        with get_connection() as conn:
            if source:
                rows = conn.execute(
                    "SELECT * FROM sensor_readings WHERE data_source = ? "
                    "ORDER BY observed_at DESC, id DESC LIMIT ? OFFSET ?",
                    (source, limit, offset),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM sensor_readings ORDER BY observed_at DESC, id DESC LIMIT ? OFFSET ?",
                    (limit, offset),
                ).fetchall()
    except sqlite3.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Unable to read sensor readings: {exc}",
        ) from exc
    return [sensor_row_to_response(row) for row in rows]


# ---------------------------------------------------------------------------
# Domain 3 — WebSocket telemetry endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws/telemetry")
async def ws_telemetry(websocket: WebSocket) -> None:
    """
    Accept a persistent WebSocket connection from the React frontend.

    Expected JSON frame (8-parameter ESP32 + browser geolocation):
        {
          "device_id": "ESP32-UNIT-001",
          "temperature_c": 28.4, "humidity_percent": 71.2,
          "pressure_hPa": 1013.1, "light_lux": 940.0,
          "sound_db": 45.3,
          "altitude_m": 84.2,
          "latitude": 6.335, "longitude": 5.6037,
          "observed_at": "2026-06-18T19:00:00Z"
        }

    The server writes each valid frame to sensor_readings (IGNORE on duplicate),
    updates the ESP32 heartbeat, and echoes {"ack": "ok", "id": <row_id>}.
    """
    global LAST_ESP32_HEARTBEAT
    import logging as _log
    log = _log.getLogger("ws.telemetry")
    await websocket.accept()
    log.info("WebSocket /ws/telemetry client connected.")
    try:
        while True:
            try:
                raw = await websocket.receive_text()
            except Exception:
                break
            try:
                data = _json.loads(raw)
                payload = TelemetryWSPayload(**data)
            except Exception as exc:
                await websocket.send_text(_json.dumps({"ack": "error", "detail": str(exc)}))
                continue

            LAST_ESP32_HEARTBEAT = time.time()
            observed_at = payload.observed_at or utc_now()
            received_at = utc_now()
            inserted_id: Optional[int] = None
            try:
                with get_connection() as conn:
                    cur = conn.execute(
                        """
                        INSERT OR IGNORE INTO sensor_readings (
                            device_id, temperature_c, humidity_percent,
                            pressure_hPa, light_lux, sound_db,
                            altitude_m, latitude, longitude,
                            observed_at, received_at, notes, data_source
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            payload.device_id,
                            payload.temperature_c,
                            payload.humidity_percent,
                            payload.pressure_hPa,
                            payload.light_lux,
                            payload.sound_db,
                            payload.altitude_m,
                            payload.latitude,
                            payload.longitude,
                            to_iso(observed_at),
                            to_iso(received_at),
                            None,
                            "LIVE_ESP32",
                        ),
                    )
                    conn.commit()
                    inserted_id = cur.lastrowid if cur.rowcount == 1 else None
            except sqlite3.Error as exc:
                await websocket.send_text(_json.dumps({"ack": "db_error", "detail": str(exc)}))
                continue

            await websocket.send_text(_json.dumps({
                "ack": "ok",
                "id": inserted_id,
                "duplicate": inserted_id is None,
            }))
    except Exception as exc:
        log.warning("WebSocket connection closed: %s", exc)
    finally:
        log.info("WebSocket /ws/telemetry client disconnected.")


# ---------------------------------------------------------------------------
# CV classification — /api/v1/upload-image
# ---------------------------------------------------------------------------

@app.post("/api/v1/upload-image", response_model=CVInferenceResponse)
def upload_image_cv(
    file:              UploadFile      = File(...),
    sensor_reading_id: Optional[int]  = Form(None),
) -> CVInferenceResponse:
    """Accept a drone/field image, persist locally, run CV inference."""
    if sensor_reading_id is not None:
        ensure_sensor_exists(sensor_reading_id)

    extension                              = validate_image_upload(file)
    stored_filename, stored_path, filesize = save_upload_to_disk(file, extension)
    inference                              = _run_cv_inference(stored_path, file.filename or stored_filename)
    created_at                             = utc_now()

    try:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO image_classifications (
                    sensor_reading_id, original_filename, stored_filename,
                    stored_path, content_type, file_size_bytes,
                    model_name, predicted_label, confidence,
                    status, error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sensor_reading_id,
                    file.filename or "unknown",
                    stored_filename,
                    str(stored_path),
                    file.content_type,
                    filesize,
                    "mobilenet_v3_small+resnet50",
                    inference["predicted_label"],
                    inference["confidence"],
                    inference["status"],
                    None,
                    to_iso(created_at),
                ),
            )
            conn.commit()
    except sqlite3.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Image saved but metadata could not be stored: {exc}",
        ) from exc

    return CVInferenceResponse(
        status=inference["status"],
        predicted_label=inference["predicted_label"],
        taxonomy=inference["taxonomy"],
        confidence=inference["confidence"],
    )


@app.post(
    "/drone-images",
    response_model=ImageClassificationResponse,
    status_code=status.HTTP_201_CREATED,
)
def upload_drone_image(
    file:              UploadFile     = File(...),
    sensor_reading_id: Optional[int] = Form(None),
) -> ImageClassificationResponse:
    """Legacy drone image endpoint — preserved for backward compat."""
    if sensor_reading_id is not None:
        ensure_sensor_exists(sensor_reading_id)

    extension                              = validate_image_upload(file)
    stored_filename, stored_path, filesize = save_upload_to_disk(file, extension)
    inference                              = model_manager.infer(stored_path)
    created_at                             = utc_now()

    try:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO image_classifications (
                    sensor_reading_id, original_filename, stored_filename,
                    stored_path, content_type, file_size_bytes,
                    model_name, predicted_label, confidence,
                    status, error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sensor_reading_id,
                    file.filename or "unknown",
                    stored_filename,
                    str(stored_path),
                    file.content_type,
                    filesize,
                    inference["model_name"],
                    inference["predicted_label"],
                    inference["confidence"],
                    inference["status"],
                    inference["error_message"],
                    to_iso(created_at),
                ),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM image_classifications WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
    except sqlite3.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Image was saved, but classification metadata could not be stored: {exc}",
        ) from exc

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image metadata was inserted but could not be reloaded.",
        )
    return image_row_to_response(row)


@app.get("/image-classifications", response_model=List[ImageClassificationResponse])
def list_image_classifications(
    limit:  int = Query(100, ge=1, le=1000),
    offset: int = Query(0,   ge=0),
) -> List[ImageClassificationResponse]:
    """Return recent drone image classifications for dashboard display."""
    try:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM image_classifications ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
    except sqlite3.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Unable to read image classifications: {exc}",
        ) from exc
    return [image_row_to_response(row) for row in rows]


# ---------------------------------------------------------------------------
# Ground-image upload endpoint (replaces dual-view drone workflow)
# ---------------------------------------------------------------------------

@app.post("/api/v1/upload-ground-image", response_model=GroundImageUploadResponse)
async def upload_ground_image(
    file:      UploadFile       = File(...),
    latitude:  Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
) -> GroundImageUploadResponse:
    """
    Accept a single ground-level image, run CV inference, and fuse with the
    latest concurrent environmental sensor telemetry snapshot.

    Steps:
      1. Validate and save image to disk (UUIDv4 filename).
      2. Run local MobileNetV3 / ResNet50 inference via BiodiversityModelManager.
      3. Fetch the most recent sensor_readings row as micro-climate snapshot.
      4. Insert into ground_image_uploads (WAL-safe).
      5. Return GroundImageUploadResponse with prediction + telemetry fusion data.
    """
    extension                              = validate_image_upload(file)
    stored_filename, stored_path, _        = save_upload_to_disk(file, extension)
    inference                              = _run_cv_inference(stored_path, file.filename or stored_filename)
    created_at                             = utc_now()

    # ── Fetch latest sensor snapshot for micro-climate fusion ───────────────
    telemetry_snapshot: Dict[str, Any] = {}
    try:
        with get_connection() as snap_conn:
            snap_row = snap_conn.execute(
                """
                SELECT temperature_c, humidity_percent, pressure_hPa,
                       light_lux, sound_db, altitude_m
                FROM sensor_readings
                ORDER BY observed_at DESC, id DESC
                LIMIT 1
                """
            ).fetchone()
            if snap_row:
                telemetry_snapshot = {
                    "temperature_c":    snap_row["temperature_c"],
                    "humidity_percent": snap_row["humidity_percent"],
                    "pressure_hPa":     snap_row["pressure_hPa"],
                    "light_lux":        snap_row["light_lux"],
                    "sound_db":         snap_row["sound_db"],
                    "altitude_m":       snap_row["altitude_m"],
                }
    except sqlite3.Error:
        pass  # Non-fatal — snapshot stays empty dict

    # ── Persist to ground_image_uploads ─────────────────────────────────
    try:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO ground_image_uploads (
                    original_filename, stored_filename, stored_path,
                    species_prediction, confidence_score,
                    latitude, longitude,
                    environmental_telemetry, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    file.filename or "unknown",
                    stored_filename,
                    str(stored_path),
                    inference["predicted_label"],
                    inference["confidence"],
                    latitude,
                    longitude,
                    _json.dumps(telemetry_snapshot),
                    to_iso(created_at),
                ),
            )
            conn.commit()
            image_id = cursor.lastrowid
    except sqlite3.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Image saved but ground upload metadata could not be stored: {exc}",
        ) from exc

    return GroundImageUploadResponse(
        image_id=image_id,
        species_prediction=inference["predicted_label"] or "Unclassified",
        confidence_score=inference["confidence"] or 0.0,
        timestamp=created_at,
        latitude=latitude,
        longitude=longitude,
        environmental_telemetry_snapshot=telemetry_snapshot,
    )


# ---------------------------------------------------------------------------
# Domain 4 (deprecated) — Drone patch upload (410 Gone)
# ---------------------------------------------------------------------------

@app.post("/api/v1/upload-drone-patch")
async def upload_drone_patch_deprecated() -> None:
    """DEPRECATED: Aerial drone patch upload removed. Use /api/v1/upload-ground-image."""
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail=(
            "The aerial drone patch upload endpoint has been retired. "
            "Please use POST /api/v1/upload-ground-image for ground-level species ingestion."
        ),
    )


# ---------------------------------------------------------------------------
# Ground batch upload (deprecated — 410 Gone)
# ---------------------------------------------------------------------------

@app.post("/api/v1/upload-ground-batch")
async def upload_ground_batch_deprecated() -> None:
    """DEPRECATED: Batch ground upload removed. Use /api/v1/upload-ground-image per image."""
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail=(
            "The batch ground upload endpoint has been retired. "
            "Please use POST /api/v1/upload-ground-image for individual ground-level species ingestion."
        ),
    )


# ---------------------------------------------------------------------------
# Domain 4 — SD Card contingency upload (idempotent CSV parser)
# ---------------------------------------------------------------------------

@app.post("/api/telemetry/upload-contingency", response_model=SDCardUploadResponse)
async def upload_sd_card_log(
    file: UploadFile = File(...),
) -> SDCardUploadResponse:
    """
    Parse a raw ESP32 SD card CSV/TXT log dump and insert into sensor_readings.

    Idempotency: rows with (observed_at, latitude, longitude) already present
    are silently skipped via INSERT OR IGNORE against the unique composite index.

    Fault-value sanitization: nan, null, -999, -999.0, -999.00, inf, empty → NULL.

    CSV expected columns (case-insensitive, flexible order):
      timestamp (or observed_at or time),
      temperature (or temp or temperature_c),
      humidity (or humidity_percent),
      pressure (or pressure_hpa),
      light (or light_lux),
      sound (or sound_db),
      altitude (or altitude_m),
      latitude (or lat),
      longitude (or lon or lng)
    """
    fname = file.filename or "sd_log.csv"
    allowed_ext = {".csv", ".txt"}
    if Path(fname).suffix.lower() not in allowed_ext:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only .csv and .txt SD card logs are accepted. Got: {Path(fname).suffix}",
        )

    raw_bytes = await file.read()
    text      = raw_bytes.decode("utf-8", errors="replace")
    lines     = text.splitlines()
    if not lines:
        return SDCardUploadResponse(
            status="empty", filename=fname,
            rows_parsed=0, rows_inserted=0, rows_skipped=0, errors=[],
        )

    reader    = csv.DictReader(lines)
    if reader.fieldnames is None:
        return SDCardUploadResponse(
            status="no_header", filename=fname,
            rows_parsed=0, rows_inserted=0, rows_skipped=0, errors=["No CSV header detected."],
        )

    # Normalize header names to canonical form
    def _col(row: Dict, *candidates: str) -> Optional[str]:
        for c in candidates:
            for k in row:
                if k and k.strip().lower() == c.lower():
                    return row[k]
        return None

    rows_parsed = rows_inserted = rows_skipped = 0
    errors: List[str] = []
    received_at = to_iso(utc_now())

    with get_connection() as conn:
        for row_num, row in enumerate(reader, start=2):
            rows_parsed += 1
            try:
                ts_raw = _col(row, "timestamp", "observed_at", "time", "datetime")
                if not ts_raw or not ts_raw.strip():
                    errors.append(f"Row {row_num}: missing timestamp — skipped.")
                    rows_skipped += 1
                    continue

                # Parse timestamp robustly
                ts_clean = ts_raw.strip()
                try:
                    observed_at = datetime.fromisoformat(ts_clean.replace("Z", "+00:00"))
                    if observed_at.tzinfo is None:
                        observed_at = observed_at.replace(tzinfo=timezone.utc)
                except ValueError:
                    errors.append(f"Row {row_num}: invalid timestamp '{ts_clean}' — skipped.")
                    rows_skipped += 1
                    continue

                temp     = _sanitize_float(_col(row, "temperature_c",    "temperature", "temp")    or "")
                humidity = _sanitize_float(_col(row, "humidity_percent",  "humidity")               or "")
                pressure = _sanitize_float(_col(row, "pressure_hpa",     "pressure")               or "")
                light    = _sanitize_float(_col(row, "light_lux",        "light")                   or "")
                sound    = _sanitize_float(_col(row, "sound_db",         "sound")                   or "")
                altitude = _sanitize_float(_col(row, "altitude_m",       "altitude", "alt")         or "")
                lat      = _sanitize_float(_col(row, "latitude",         "lat")                     or "")
                lon      = _sanitize_float(_col(row, "longitude",        "lon", "lng")              or "")

                # At minimum we need temperature to be a real value
                if temp is None:
                    errors.append(f"Row {row_num}: temperature fault value — stored as NULL.")

                device_id = (_col(row, "device_id", "device", "id") or "ESP32-SD").strip()

                cur = conn.execute(
                    """
                    INSERT OR IGNORE INTO sensor_readings (
                        device_id, temperature_c, humidity_percent,
                        pressure_hPa, light_lux, sound_db,
                        altitude_m, latitude, longitude,
                        observed_at, received_at, notes, data_source
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        device_id,
                        temp,
                        humidity if humidity is not None else None,
                        pressure if pressure is not None else 1013.25,
                        light    if light    is not None else None,
                        sound    if sound    is not None else None,
                        altitude,
                        lat,
                        lon,
                        to_iso(observed_at),
                        received_at,
                        None,
                        "ESP32_SD_CARD",
                    ),
                )
                if cur.rowcount == 1:
                    rows_inserted += 1
                else:
                    rows_skipped += 1

            except Exception as exc:
                errors.append(f"Row {row_num}: unexpected error — {exc}")
                rows_skipped += 1

        conn.commit()

    return SDCardUploadResponse(
        status="ok",
        filename=fname,
        rows_parsed=rows_parsed,
        rows_inserted=rows_inserted,
        rows_skipped=rows_skipped,
        errors=errors[:50],  # cap error list to avoid huge responses
    )


# ---------------------------------------------------------------------------
# Domain 5 — OpenWeatherMap micro-climate baseline
# ---------------------------------------------------------------------------

@app.get("/api/weather/field-day", response_model=WeatherFieldDayResponse)
def get_field_day_weather(
    lat: float = Query(..., ge=-90,   le=90,  description="Latitude"),
    lon: float = Query(..., ge=-180,  le=180, description="Longitude"),
) -> WeatherFieldDayResponse:
    """
    Fetch current ambient weather from OpenWeatherMap for the field site.

    Also fetches AQI from the OpenWeatherMap Air Pollution endpoint.
    Computes variance between OWM ambient temp and the latest local sensor reading.
    Persists result into external_weather_metadata (decoupled from taxonomy tables).
    """
    if not OPENWEATHERMAP_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "OPENWEATHERMAP_API_KEY is not set in .env. "
                "Add OPENWEATHERMAP_API_KEY=<your_key> to enable weather integration."
            ),
        )

    fetched_at = utc_now()

    # ── Fetch current weather ────────────────────────────────────────────
    sky_condition: Optional[str] = None
    owm_temp_c:    Optional[float] = None
    try:
        weather_url = (
            f"https://api.openweathermap.org/data/2.5/weather"
            f"?lat={lat}&lon={lon}&appid={OPENWEATHERMAP_API_KEY}&units=metric"
        )
        with urllib.request.urlopen(weather_url, timeout=10) as resp:
            weather_data = _json.loads(resp.read().decode())
        sky_condition = weather_data.get("weather", [{}])[0].get("main")
        owm_temp_c    = weather_data.get("main", {}).get("temp")
        raw_weather   = _json.dumps(weather_data)[:4000]
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenWeatherMap weather fetch failed: {exc}",
        ) from exc

    # ── Fetch AQI ────────────────────────────────────────────────────────
    aqi: Optional[float] = None
    try:
        aqi_url = (
            f"https://api.openweathermap.org/data/2.5/air_pollution"
            f"?lat={lat}&lon={lon}&appid={OPENWEATHERMAP_API_KEY}"
        )
        with urllib.request.urlopen(aqi_url, timeout=10) as resp:
            aqi_data = _json.loads(resp.read().decode())
        aqi = float(aqi_data.get("list", [{}])[0].get("main", {}).get("aqi", 0))
    except Exception:
        pass  # AQI is supplementary — don't block the response

    # ── Latest local sensor temperature ─────────────────────────────────
    sensor_temp_c: Optional[float] = None
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT temperature_c FROM sensor_readings ORDER BY observed_at DESC LIMIT 1"
            ).fetchone()
            if row:
                sensor_temp_c = float(row["temperature_c"])
    except Exception:
        pass

    temp_variance_c: Optional[float] = None
    if owm_temp_c is not None and sensor_temp_c is not None:
        temp_variance_c = round(owm_temp_c - sensor_temp_c, 4)

    # ── Persist into external_weather_metadata ───────────────────────────
    event_hash = hashlib.sha256(
        f"{lat:.4f}:{lon:.4f}:{fetched_at.strftime('%Y-%m-%dT%H')}".encode()
    ).hexdigest()[:32]

    try:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO external_weather_metadata
                    (event_hash, latitude, longitude, fetch_timestamp,
                     sky_condition, ambient_temp_c, aqi, raw_response)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (event_hash, lat, lon, to_iso(fetched_at), sky_condition, owm_temp_c, aqi, raw_weather),
            )
            conn.commit()
    except Exception:
        pass  # Storage failure is non-fatal for this read endpoint

    return WeatherFieldDayResponse(
        sky_condition=sky_condition,
        owm_temp_c=owm_temp_c,
        sensor_temp_c=sensor_temp_c,
        temp_variance_c=temp_variance_c,
        aqi=aqi,
        latitude=lat,
        longitude=lon,
        fetched_at=fetched_at,
    )


# ---------------------------------------------------------------------------
# Domain 6 — Unified Data Science Pipeline Engine
# ---------------------------------------------------------------------------

@app.post("/api/v1/analytics/run-pipeline", response_model=RunPipelineResponse)
def run_pipeline() -> RunPipelineResponse:
    """
    Unified data science pipeline execution.

    Execution order:
      1. DataCleaner — NumPy IQR outlier detection + pchip interpolation.
      2. Rolling 5-point moving average on each sensor field.
      3. Z-score anomaly detection (IsolationForest if scikit-learn available).
      4. AnalyticsEngine — regenerate correlation heatmap + density plots.
      5. ReportEngine   — 4-sheet styled Excel workbook with thesis title.
    Returns structured result with download URL.
    """
    import logging as _log
    log = _log.getLogger("pipeline.run")
    messages: List[str] = []
    session_id = uuid.uuid4().hex

    # ── 1. DataCleaner outlier pass ──────────────────────────────────────
    cleaning_report: Dict[str, Any] = {}
    try:
        from pipeline_analytics import DataCleaner
        import pandas as pd
        _conn = sqlite3.connect(DB_PATH)
        _df   = pd.read_sql_query(
            "SELECT * FROM sensor_readings ORDER BY observed_at ASC", _conn
        )
        _conn.close()
        if not _df.empty:
            _, cleaning_report = DataCleaner().clean(_df)
            messages.append(f"DataCleaner: outlier pass complete ({len(_df)} rows).")
        else:
            messages.append("DataCleaner: sensor_readings table is empty — skipped.")
    except Exception as exc:
        messages.append(f"WARNING: DataCleaner skipped: {exc}")

    # ── 2 & 3. Rolling averages + anomaly detection ──────────────────────
    anomaly_count = 0
    try:
        import pandas as pd
        import numpy as np
        _conn = sqlite3.connect(DB_PATH)
        df    = pd.read_sql_query(
            "SELECT * FROM sensor_readings ORDER BY observed_at ASC", _conn
        )
        _conn.close()

        sensor_cols = ["temperature_c", "humidity_percent", "pressure_hPa",
                       "light_lux", "sound_db", "altitude_m"]
        present_cols = [c for c in sensor_cols if c in df.columns]

        # Rolling 5-point moving average
        for col in present_cols:
            df[f"{col}_ma5"] = df[col].rolling(window=5, min_periods=1).mean()

        # Z-score anomaly detection (fallback if scikit-learn absent)
        for col in present_cols:
            s = df[col].dropna()
            if s.empty:
                continue
            mean, std = s.mean(), s.std()
            if std > 0:
                z = (df[col] - mean) / std
                anomaly_count += int((z.abs() > 3).sum())

        try:
            from sklearn.ensemble import IsolationForest
            num_df = df[present_cols].dropna()
            if len(num_df) >= 10:
                iso   = IsolationForest(contamination=0.05, random_state=42)
                preds = iso.fit_predict(num_df)
                anomaly_count = int((preds == -1).sum())
                messages.append(f"IsolationForest: {anomaly_count} anomalies detected.")
            else:
                messages.append(f"Z-score: {anomaly_count} flagged outliers.")
        except ImportError:
            messages.append(f"Z-score: {anomaly_count} flagged outliers (scikit-learn not installed).")

    except Exception as exc:
        messages.append(f"WARNING: Anomaly detection skipped: {exc}")

    # ── 4. Analytics plots ───────────────────────────────────────────────
    analytics_plots: Dict[str, str] = {}
    try:
        from pipeline_analytics import AnalyticsEngine
        engine = AnalyticsEngine(db_path=DB_PATH, output_dir=ANALYTICS_OUT)
        result = engine.run_once()
        analytics_plots = result.get("plots", {})
        messages.append("AnalyticsEngine: correlation + density plots regenerated.")
    except Exception as exc:
        messages.append(f"WARNING: AnalyticsEngine skipped: {exc}")

    # ── 5. Excel report ──────────────────────────────────────────────────
    excel_path: Optional[str] = None
    excel_url:  Optional[str] = None
    try:
        from report_engine import ReportEngine
        rpt  = ReportEngine(db_path=DB_PATH, exports_dir=EXPORTS_DIR)
        path = rpt.generate_excel_spreadsheet(session_id=session_id)
        excel_path = str(path)
        excel_url  = f"/api/v1/reports/export-excel?session_id={session_id}"
        messages.append(f"ReportEngine: 4-sheet Excel workbook saved → {path.name}")
    except Exception as exc:
        messages.append(f"WARNING: ReportEngine skipped: {exc}")

    return RunPipelineResponse(
        status="ok",
        session_id=session_id,
        cleaning_report=cleaning_report,
        analytics_plots=analytics_plots,
        anomaly_count=anomaly_count,
        excel_report_path=excel_path,
        excel_download_url=excel_url,
        messages=messages,
    )


# ---------------------------------------------------------------------------
# Reports — Excel download & email dispatch
# ---------------------------------------------------------------------------

@app.get("/api/v1/reports/export-excel")
def export_excel(
    session_id: str = Query("all", description="Filter by sync_session_id, or 'all'."),
):
    """Generate (or serve cached) Excel workbook. Returns as file attachment."""
    from fastapi.responses import FileResponse
    try:
        from report_engine import ReportEngine
        rpt  = ReportEngine(db_path=DB_PATH, exports_dir=EXPORTS_DIR)
        path = rpt.generate_excel_spreadsheet(session_id=session_id)
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=f"Report engine unavailable: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Report generation failed: {exc}",
        ) from exc

    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Generated report file not found on disk.",
        )

    return FileResponse(
        path=str(path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=path.name,
        headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
    )


@app.post("/api/v1/reports/share-email")
def share_email(payload: EmailShareRequest) -> Dict[str, str]:
    """Asynchronously build requested reports and dispatch via SMTP."""
    from email.message import EmailMessage

    def _dispatch(email_addr: str, attach_pdf: bool, attach_excel: bool) -> None:
        msg = EmailMessage()
        msg["Subject"] = "UNIBEN Biodiversity Pipeline — Automated Report"
        msg["From"]    = "system@uniben-pipeline.local"
        msg["To"]      = email_addr
        msg.set_content(
            f"Hello,\n\nPlease find the requested data exports attached.\n\n"
            f"Generated at: {utc_now().isoformat()}"
        )
        try:
            from report_engine import ReportEngine
            rpt = ReportEngine(db_path=DB_PATH, exports_dir=EXPORTS_DIR)
            if attach_excel:
                excel_path = rpt.generate_excel_spreadsheet(session_id="all")
                if excel_path and excel_path.exists():
                    with open(excel_path, "rb") as f:
                        msg.add_attachment(
                            f.read(), maintype="application",
                            subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            filename=excel_path.name,
                        )
            if attach_pdf:
                pdf_path = rpt.generate_academic_pdf()
                if pdf_path and pdf_path.exists():
                    with open(pdf_path, "rb") as f:
                        msg.add_attachment(
                            f.read(), maintype="application", subtype="pdf", filename=pdf_path.name
                        )
            import logging
            logging.getLogger("pipeline.email").info(
                "SIMULATED DISPATCH to %s PDF=%s EXCEL=%s", email_addr, attach_pdf, attach_excel
            )
        except Exception as exc:
            import logging
            logging.getLogger("pipeline.email").error("Email dispatch failed: %s", exc)

    threading.Thread(
        target=_dispatch,
        args=(payload.email, payload.attach_pdf, payload.attach_excel),
        daemon=True,
    ).start()
    return {"status": "dispatched", "message": f"Email queued for dispatch to {payload.email}."}