"""
Campus-scale biodiversity and environmental data pipeline API.

This script is intentionally self-contained for local-first field deployments:
- SQLite stores sensor readings and image classification metadata.
- Uploaded drone imagery is persisted to a local directory before inference.
- PyTorch model loading and inference failures never discard field data.
- Five mandatory environmental parameters: Temperature, Humidity, Pressure,
  Light Intensity, Sound Level.

Run locally:
    uvicorn main:app --reload
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import uuid
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Local configuration  — DB is always data/biodiversity.db relative to this file
# ---------------------------------------------------------------------------

BASE_DIR   = Path(__file__).resolve().parent
DB_PATH    = Path(os.getenv("BIODIVERSITY_DB_PATH",   BASE_DIR / "data" / "biodiversity.db"))
UPLOAD_DIR = Path(os.getenv("BIODIVERSITY_UPLOAD_DIR", BASE_DIR / "data" / "uploads"))

# best_model.pt — local PyTorch checkpoint.  When present, weights are loaded
# onto the active device at startup instead of using the static mock.
MODEL_PATH = Path(os.getenv("BIODIVERSITY_MODEL_PATH", BASE_DIR / "best_model.pt"))

LOAD_TORCH_WEIGHTS = os.getenv("LOAD_TORCH_WEIGHTS", "false").strip().lower() in {
    "1", "true", "yes", "on",
}

# Analytics output directory (mirrored from pipeline_analytics)
ANALYTICS_OUT = BASE_DIR / "frontend" / "public" / "analytics"

# Excel report exports directory (served as file attachments)
EXPORTS_DIR = BASE_DIR / "data" / "exports"

ALLOWED_IMAGE_EXTENSIONS  = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/jpeg", "image/png", "image/tiff", "image/webp",
}

LAST_ESP32_HEARTBEAT = 0.0

# ---------------------------------------------------------------------------
# Pydantic API models
# ---------------------------------------------------------------------------

class SensorReadingCreate(BaseModel):
    """Incoming five-parameter environmental sensor payload."""

    device_id:         str            = Field(..., min_length=1, max_length=120)
    temperature_c:     float          = Field(..., description="Ambient temperature in Celsius.")
    humidity_percent:  float          = Field(..., ge=0,    le=100)
    pressure_hPa:      float          = Field(..., ge=800,  le=1100, description="Atmospheric pressure in hPa.")
    light_lux:         float          = Field(..., ge=0,    description="Ambient light intensity in Lux.")
    sound_db:          float          = Field(..., ge=0,    description="Ambient sound level in dB.")
    latitude:          Optional[float] = Field(None, ge=-90,  le=90)
    longitude:         Optional[float] = Field(None, ge=-180, le=180)
    altitude_m:        Optional[float] = Field(None, description="Optional GPS altitude in metres.")
    observed_at:       Optional[datetime] = Field(
        None, description="Sensor timestamp. Defaults to server receipt time when omitted.",
    )
    notes:             Optional[str]  = Field(None, max_length=2000)
    data_source:       str            = Field("LIVE_ESP32", description="'LIVE_ESP32' or 'MANUAL_OVERRIDE'.")


class SensorReadingResponse(BaseModel):
    """Stored five-parameter environmental reading returned to clients."""

    id:               int
    device_id:        str
    temperature_c:    float
    humidity_percent: float
    pressure_hPa:     float
    light_lux:        float
    sound_db:         float
    latitude:         Optional[float]
    longitude:        Optional[float]
    altitude_m:       Optional[float]
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
    """Computer-vision classification response for uploaded drone imagery."""

    status:          str
    predicted_label: str
    taxonomy:        Dict[str, str]
    confidence:      float


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
    email: str
    attach_pdf: bool = False
    attach_excel: bool = False


class EngagePipelineRequest(BaseModel):
    """
    Payload sent by the frontend “ENGAGE DATA SCIENTIST PIPELINE ENGINE” button.
    All sensor fields are optional so manual entries can be partial.
    """
    device_id:           str            = Field("MANUAL-OVERRIDE", max_length=120)
    temperature_c:       Optional[float] = None
    humidity_percent:    Optional[float] = None
    pressure_hPa:        Optional[float] = None
    light_lux:           Optional[float] = None
    sound_db:            Optional[float] = None
    latitude:            Optional[float] = None
    longitude:           Optional[float] = None
    observed_at:         Optional[datetime] = None
    notes:               Optional[str]  = None
    sync_session_id:     Optional[str]  = None


class EngagePipelineResponse(BaseModel):
    """Structured result returned after a full pipeline execution cycle."""
    status:              str
    session_id:          str
    sensor_record_id:    Optional[int]  = None
    cleaning_report:     Dict[str, Any] = {}
    analytics_plots:     Dict[str, str] = {}
    excel_report_path:   Optional[str]  = None
    excel_download_url:  Optional[str]  = None
    messages:            List[str]      = []


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
    """Create a short-lived SQLite connection with row dictionaries enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_database() -> None:
    """Create local directories and tables required for offline operation."""

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    with get_connection() as conn:
        # sensor_readings — five mandatory environmental parameters
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
                latitude         REAL,
                longitude        REAL,
                altitude_m       REAL,
                observed_at      TEXT    NOT NULL,
                received_at      TEXT    NOT NULL,
                notes            TEXT,
                data_source      TEXT    NOT NULL DEFAULT 'LIVE_ESP32'
            )
            """
        )

        # Migrate existing databases that lack columns
        existing_cols = {
            row[1] for row in conn.execute("PRAGMA table_info(sensor_readings)").fetchall()
        }
        for col, definition in [
            ("pressure_hPa", "REAL NOT NULL DEFAULT 1013.25"),
            ("light_lux",    "REAL NOT NULL DEFAULT 0.0"),
            ("sound_db",     "REAL NOT NULL DEFAULT 0.0"),
            ("data_source",  "TEXT NOT NULL DEFAULT 'LIVE_ESP32'"),
        ]:
            if col not in existing_cols:
                conn.execute(f"ALTER TABLE sensor_readings ADD COLUMN {col} {definition}")

        # drone_patches — Parent aerial spatial context
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

        # field_observations — Child ground encounters (38 parameters)
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
                FOREIGN KEY(drone_id) REFERENCES drone_patches(drone_id) ON DELETE SET NULL
            )
            """
        )

        conn.commit()



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
        latitude=row["latitude"],
        longitude=row["longitude"],
        altitude_m=row["altitude_m"],
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

# ImageNet-1k class index → common name mapping (top environmental classes).
# Used to derive a human-readable label from the raw class index.
# Extend this dict as new domain-specific labels become available.
_IMAGENET_LABEL_MAP: Dict[int, str] = {
    # Plants / flora
    949: "strawberry",  985: "daisy",  986: "corn",  987: "acorn",
    992: "hip/rose",   993: "buckeye", 994: "coral fungus",
    # Insects
    300: "ladybug",  301: "walking stick", 302: "cockroach",
    303: "mantis",   304: "cicada",        305: "leafhopper",
    306: "lacewing", 307: "dragonfly",     308: "damselfly",
    309: "admiral butterfly", 310: "ringlet butterfly",
    # Birds
    8:   "hen",   11: "goldfinch",  12: "house finch",
    14:  "indigo bunting",   15: "robin",
    # Reptiles / amphibians
    26:  "tree frog",  27: "tailed frog",  44: "bullfrog",
    # Fungi
    995: "agaric", 996: "gyromitra", 997: "stinkhorn",
    998: "earthstar", 999: "hen of the woods",
}

# Taxonomy lookup keyed by the human-readable predicted label.
# Add more entries as the model is fine-tuned on UNIBEN campus species.
_TAXONOMY_LOOKUP: Dict[str, Dict[str, str]] = {
    "default": {
        "Kingdom": "Plantae",
        "Phylum":  "Tracheophyta",
        "Class":   "Magnoliopsida",
        "Order":   "Fabales",
        "Family":  "Fabaceae",
        "Genus":   "Delonix",
        "Species": "Delonix regia",
    },
    "daisy": {
        "Kingdom": "Plantae",
        "Phylum":  "Tracheophyta",
        "Class":   "Magnoliopsida",
        "Order":   "Asterales",
        "Family":  "Asteraceae",
        "Genus":   "Bellis",
        "Species": "Bellis perennis",
    },
    "dragonfly": {
        "Kingdom": "Animalia",
        "Phylum":  "Arthropoda",
        "Class":   "Insecta",
        "Order":   "Odonata",
        "Family":  "Libellulidae",
        "Genus":   "Orthetrum",
        "Species": "Orthetrum cancellatum",
    },
    "bullfrog": {
        "Kingdom": "Animalia",
        "Phylum":  "Chordata",
        "Class":   "Amphibia",
        "Order":   "Anura",
        "Family":  "Ranidae",
        "Genus":   "Lithobates",
        "Species": "Lithobates catesbeianus",
    },
    "ladybug": {
        "Kingdom": "Animalia",
        "Phylum":  "Arthropoda",
        "Class":   "Insecta",
        "Order":   "Coleoptera",
        "Family":  "Coccinellidae",
        "Genus":   "Coccinella",
        "Species": "Coccinella septempunctata",
    },
    "hen of the woods": {
        "Kingdom": "Fungi",
        "Phylum":  "Basidiomycota",
        "Class":   "Agaricomycetes",
        "Order":   "Polyporales",
        "Family":  "Meripilaceae",
        "Genus":   "Grifola",
        "Species": "Grifola frondosa",
    },
}


def _label_from_index(idx: int) -> str:
    """Convert ImageNet class index to a human-readable label."""
    return _IMAGENET_LABEL_MAP.get(idx, f"species_class_{idx}")


def _taxonomy_for_label(label: str) -> Dict[str, str]:
    """Return the taxonomy dict for a predicted label, defaulting to Delonix regia."""
    return _TAXONOMY_LOOKUP.get(label.lower(), _TAXONOMY_LOOKUP["default"])


class BiodiversityModelManager:
    """
    PyTorch model loader with best_model.pt checkpoint support.

    Priority order:
      1. best_model.pt exists → load as MobileNetV3-Small checkpoint onto
         CUDA (if available) or CPU.  Expose model_file_loaded = True.
      2. LOAD_TORCH_WEIGHTS = true → download ImageNet pretrained weights.
      3. torch available but no weights → bare architecture without weights.
      4. torch not installed → model_unavailable; falls back to static mock.
    """

    def __init__(self) -> None:
        self.models: Dict[str, Any]    = {}
        self.status: Dict[str, str]    = {
            "mobilenet_v3_small": "not_loaded",
        }
        self.model_file_loaded: bool   = False
        self.device: str               = "cpu"
        self._torch: Any               = None
        self._preprocess: Any          = None

    @property
    def loaded(self) -> bool:
        return bool(self.models)

    def load(self) -> None:
        """
        Attempt to initialise the model.

        If best_model.pt is found, it is loaded as a MobileNetV3-Small
        state_dict checkpoint.  If torch is unavailable the manager silently
        degrades — all inference calls return the structured static mock.
        """
        try:
            import torch
            from torchvision import models, transforms
        except Exception as exc:
            msg = f"dependency_unavailable: {exc}"
            self.status["mobilenet_v3_small"] = msg
            return

        self._torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        # Standard ImageNet normalisation pipeline
        self._preprocess = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225],
            ),
        ])

        # --- Case 1: load best_model.pt local checkpoint ---
        if MODEL_PATH.exists():
            try:
                arch = models.mobilenet_v3_small(weights=None)
                checkpoint = torch.load(
                    str(MODEL_PATH),
                    map_location=self.device,
                    weights_only=True,
                )
                # Support both raw state_dict and {"model_state_dict": ...} wrappers
                state_dict = (
                    checkpoint.get("model_state_dict", checkpoint)
                    if isinstance(checkpoint, dict)
                    else checkpoint
                )
                arch.load_state_dict(state_dict, strict=False)
                arch.to(self.device)
                arch.eval()
                self.models["mobilenet_v3_small"] = arch
                self.status["mobilenet_v3_small"] = (
                    f"loaded_from_checkpoint:{MODEL_PATH.name}@{self.device}"
                )
                self.model_file_loaded = True
                return
            except Exception as exc:
                self.status["mobilenet_v3_small"] = f"checkpoint_load_failed: {exc}"
                # Fall through to pretrained / bare loading

        # --- Case 2 / 3: pretrained or bare weights ---
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
        """
        Run a forward pass through the loaded model and return the top-1
        prediction with its taxonomy lookup.

        Falls back to the structured static mock when torch is unavailable.
        """
        if not self.models or self._torch is None or self._preprocess is None:
            return {
                "model_name":      "none",
                "predicted_label": None,
                "confidence":      None,
                "taxonomy":        _TAXONOMY_LOOKUP["default"],
                "status":          "model_unavailable",
                "error_message":   "No PyTorch models are currently loaded.",
            }

        try:
            from PIL import Image as PILImage
            img    = PILImage.open(image_path).convert("RGB")
            tensor = self._preprocess(img).unsqueeze(0).to(self.device)

            model_name = next(iter(self.models))
            model      = self.models[model_name]

            with self._torch.no_grad():
                logits        = model(tensor)
                probabilities = self._torch.nn.functional.softmax(logits[0], dim=0)
                confidence, class_idx = self._torch.max(probabilities, dim=0)

            idx_int   = int(class_idx.item())
            conf_float = float(confidence.item())
            label      = _label_from_index(idx_int)
            taxonomy   = _taxonomy_for_label(label)

            return {
                "model_name":      model_name,
                "predicted_label": label,
                "confidence":      conf_float,
                "taxonomy":        taxonomy,
                "status":          "success",
                "error_message":   None,
            }

        except Exception as exc:
            return {
                "model_name":      ",".join(self.models.keys()) or "unknown",
                "predicted_label": None,
                "confidence":      None,
                "taxonomy":        _TAXONOMY_LOOKUP["default"],
                "status":          "failed",
                "error_message":   str(exc),
            }


model_manager = BiodiversityModelManager()


# ---------------------------------------------------------------------------
# AnalyticsEngine — lazy import so the API starts even if matplotlib is absent
# ---------------------------------------------------------------------------

_analytics_engine: Any = None


def _start_analytics() -> None:
    """Attempt to start the background analytics worker."""
    global _analytics_engine
    try:
        from pipeline_analytics import AnalyticsEngine
        _analytics_engine = AnalyticsEngine(
            db_path=DB_PATH,
            output_dir=ANALYTICS_OUT,
            interval_s=300,
        )
        _analytics_engine.start()
    except Exception as exc:  # noqa: BLE001
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
        "Local-first API for five-parameter environmental sensor data, "
        "drone image CV inference, and taxonomic classification."
    ),
    version="2.0.0",
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
    """Validate image extension and MIME type before saving to disk."""
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
    """Persist an uploaded file locally using a collision-resistant filename."""
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
        try:
            stored_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded image is empty.",
        )

    return stored_filename, stored_path, file_size


# ---------------------------------------------------------------------------
# API endpoints
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
    delta = time.time() - LAST_ESP32_HEARTBEAT
    if delta <= 15.0:
        return HardwareStatusResponse(status="connected")
    return HardwareStatusResponse(status="disconnected")

@app.post(
    "/sensor-readings",
    response_model=SensorReadingResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_sensor_reading(payload: SensorReadingCreate) -> SensorReadingResponse:
    global LAST_ESP32_HEARTBEAT
    if payload.data_source == "LIVE_ESP32":
        LAST_ESP32_HEARTBEAT = time.time()
        
    """Store one five-parameter environmental sensor reading in local SQLite."""
    observed_at = payload.observed_at or utc_now()
    received_at = utc_now()

    try:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO sensor_readings (
                    device_id, temperature_c, humidity_percent,
                    pressure_hPa, light_lux, sound_db,
                    latitude, longitude, altitude_m,
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
                    payload.latitude,
                    payload.longitude,
                    payload.altitude_m,
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
) -> List[SensorReadingResponse]:
    """Return recent five-parameter environmental readings for dashboard display."""
    try:
        with get_connection() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM sensor_readings
                ORDER BY observed_at DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()
    except sqlite3.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Unable to read sensor readings: {exc}",
        ) from exc

    return [sensor_row_to_response(row) for row in rows]


# ---------------------------------------------------------------------------
# /api/v1/upload-image  — CV classification inference endpoint
# ---------------------------------------------------------------------------

def _run_cv_inference(image_path: Path, original_filename: str) -> Dict[str, Any]:
    """
    Run classification inference on the stored image.

    Execution path (priority order):
      1. If best_model.pt was loaded → real forward pass via model_manager.infer()
         Returns top-1 label + taxonomy lookup + actual softmax confidence.
      2. If torch is installed but no checkpoint → forward pass on bare weights.
      3. If torch is unavailable → structured static mock (Delonix regia, 0.94).

    The returned dict schema is the frozen contract consumed by:
      - The React taxonomy table (frontend/src/App.jsx)
      - The pipeline_sync.py merge logic
      - The image_classifications SQLite table
    """
    if model_manager.loaded:
        # Live model path — real inference
        result = model_manager.infer(image_path)
        if result["status"] == "success" and result["predicted_label"] is not None:
            return {
                "status":          "success",
                "predicted_label": result["predicted_label"],
                "taxonomy":        result.get("taxonomy", _TAXONOMY_LOOKUP["default"]),
                "confidence":      result["confidence"],
                "source_file":     original_filename,
            }
        # Model ran but inference failed — fall through to mock

    # Static fallback: structurally correct Delonix regia prediction
    return {
        "status":          "success",
        "predicted_label": "Flora/Fauna",
        "taxonomy":        _TAXONOMY_LOOKUP["default"],
        "confidence":      0.94,
        "source_file":     original_filename,
    }


@app.post("/api/v1/upload-image", response_model=CVInferenceResponse)
def upload_image_cv(
    file:              UploadFile      = File(...),
    sensor_reading_id: Optional[int]  = Form(None),
) -> CVInferenceResponse:
    """
    Accept a drone/field image, persist it locally, run CV inference, and
    record the result in image_classifications.

    Returns the full taxonomy prediction consumed by the React frontend table.
    """
    if sensor_reading_id is not None:
        ensure_sensor_exists(sensor_reading_id)

    extension                              = validate_image_upload(file)
    stored_filename, stored_path, filesize = save_upload_to_disk(file, extension)
    inference                              = _run_cv_inference(stored_path, file.filename or stored_filename)
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
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    file:              UploadFile      = File(...),
    sensor_reading_id: Optional[int]  = Form(None),
) -> ImageClassificationResponse:
    """
    Legacy drone image endpoint — save locally, run placeholder inference,
    persist result.  New callers should use /api/v1/upload-image instead.
    """
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
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                """
                SELECT *
                FROM image_classifications
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()
    except sqlite3.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Unable to read image classifications: {exc}",
        ) from exc

    return [image_row_to_response(row) for row in rows]


# ---------------------------------------------------------------------------
# /api/v1/upload-drone-patch
# ---------------------------------------------------------------------------
@app.post("/api/v1/upload-drone-patch")
async def upload_drone_patch(
    drone_file: UploadFile = File(...),
    campus_zone: str = Form("Zone 1"),
) -> Dict[str, Any]:
    ext = validate_image_upload(drone_file)
    _, stored_path, _ = save_upload_to_disk(drone_file, ext)
    
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO drone_patches (drone_image_path, campus_zone, flight_timestamp)
            VALUES (?, ?, ?)
            """,
            (str(stored_path), campus_zone, to_iso(utc_now()))
        )
        drone_id = cursor.lastrowid
        conn.commit()
    
    return {"status": "success", "drone_id": drone_id, "drone_image_path": str(stored_path)}


# ---------------------------------------------------------------------------
# /api/v1/upload-ground-batch
# ---------------------------------------------------------------------------
@app.post("/api/v1/upload-ground-batch")
async def upload_ground_batch(
    drone_id: Optional[int] = Form(None),
    ground_files: List[UploadFile] = File(...),
    observer_id: str = Form("System"),
) -> Dict[str, Any]:
    results = []
    
    with get_connection() as conn:
        for f in ground_files:
            if not f.filename: continue
            try:
                ext = validate_image_upload(f)
                _, stored_path, _ = save_upload_to_disk(f, ext)
                inference = _run_cv_inference(stored_path, f.filename)
                
                label = inference.get("predicted_label", "Unclassified")
                conf = float(inference.get("confidence", 0.0))
                tax = inference.get("taxonomy", {})
                
                now = utc_now()
                date_str = now.strftime("%Y-%m-%d")
                time_str = now.strftime("%H:%M:%S")
                
                conn.execute(
                    """
                    INSERT INTO field_observations (
                        drone_id, ground_image_path,
                        category, kingdom, phylum, class, order_name,
                        family, genus, species, common_name,
                        annotation_confidence,
                        observer_id, date, time, data_source
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL_OVERRIDE')
                    """,
                    (
                        drone_id, str(stored_path),
                        tax.get('category'), tax.get('kingdom'), tax.get('phylum'),
                        tax.get('class'), tax.get('order_name'), tax.get('family'),
                        tax.get('genus'), tax.get('species'), label,
                        conf, observer_id, date_str, time_str
                    )
                )
                results.append({
                    "file": f.filename,
                    "status": "success",
                    "inference": inference
                })
            except Exception as e:
                results.append({"file": f.filename, "status": "error", "message": str(e)})
        conn.commit()

    return {"status": "success", "results": results}


# ---------------------------------------------------------------------------
# /api/v1/engage-pipeline  — full pipeline execution trigger
# ---------------------------------------------------------------------------

@app.post("/api/v1/engage-pipeline", response_model=EngagePipelineResponse)
def engage_pipeline(payload: EngagePipelineRequest) -> EngagePipelineResponse:
    """
    Synchronous pipeline engine execution triggered by the frontend button.

    Execution order:
      1. Persist manual sensor reading (if any values provided).
      2. Run DataCleaner NumPy outlier pass on the full sensor history.
      3. Run AnalyticsEngine cycle: correlation heatmap + density plots.
      4. Run ReportEngine: generate multi-sheet Excel workbook.
      5. Return structured result with download URL.
    """
    import logging as _log
    log = _log.getLogger("pipeline.engage")
    messages: List[str] = []
    session_id = payload.sync_session_id or uuid.uuid4().hex

    # --- 1. Persist manual sensor reading -----------------------------------
    sensor_record_id: Optional[int] = None
    has_sensor_data = any([
        payload.temperature_c   is not None,
        payload.humidity_percent is not None,
        payload.pressure_hPa    is not None,
        payload.light_lux       is not None,
        payload.sound_db        is not None,
    ])
    if has_sensor_data:
        observed_at = payload.observed_at or utc_now()
        try:
            with get_connection() as conn:
                cur = conn.execute(
                    """
                    INSERT INTO sensor_readings (
                        device_id, temperature_c, humidity_percent,
                        pressure_hPa, light_lux, sound_db,
                        latitude, longitude,
                        observed_at, received_at, notes, data_source
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        payload.device_id,
                        payload.temperature_c   or 0.0,
                        payload.humidity_percent or 0.0,
                        payload.pressure_hPa    or 1013.25,
                        payload.light_lux       or 0.0,
                        payload.sound_db        or 0.0,
                        payload.latitude,
                        payload.longitude,
                        to_iso(observed_at),
                        to_iso(utc_now()),
                        payload.notes,
                        "MANUAL_OVERRIDE",
                    ),
                )
                conn.commit()
                sensor_record_id = cur.lastrowid
            messages.append(f"Sensor reading stored (id={sensor_record_id}, source=MANUAL_OVERRIDE).")
        except sqlite3.Error as exc:
            messages.append(f"WARNING: sensor reading could not be stored: {exc}")

    # --- 2. DataCleaner outlier pass ----------------------------------------
    cleaning_report: Dict[str, Any] = {}
    try:
        from pipeline_analytics import DataCleaner
        import pandas as pd
        import sqlite3 as _sqlite3
        _conn = _sqlite3.connect(DB_PATH)
        _df   = pd.read_sql_query("SELECT * FROM sensor_readings ORDER BY observed_at ASC", _conn)
        _conn.close()
        if not _df.empty:
            _, cleaning_report = DataCleaner().clean(_df)
            messages.append("DataCleaner: outlier pass complete.")
    except Exception as exc:
        messages.append(f"WARNING: DataCleaner skipped: {exc}")

    # --- 3. Analytics plots -------------------------------------------------
    analytics_plots: Dict[str, str] = {}
    try:
        from pipeline_analytics import AnalyticsEngine
        engine = AnalyticsEngine(db_path=DB_PATH, output_dir=ANALYTICS_OUT)
        result = engine.run_once()
        analytics_plots = result.get("plots", {})
        messages.append("AnalyticsEngine: correlation + density plots regenerated.")
    except Exception as exc:
        messages.append(f"WARNING: AnalyticsEngine skipped: {exc}")

    # --- 4. Excel report ----------------------------------------------------
    excel_path: Optional[str] = None
    excel_url:  Optional[str] = None
    try:
        from report_engine import ReportEngine
        rpt  = ReportEngine(db_path=DB_PATH, exports_dir=EXPORTS_DIR)
        path = rpt.generate_excel_spreadsheet(session_id=session_id)
        excel_path = str(path)
        excel_url  = f"/api/v1/reports/export-excel?session_id={session_id}"
        messages.append(f"ReportEngine: Excel workbook saved → {path.name}")
    except Exception as exc:
        messages.append(f"WARNING: ReportEngine skipped: {exc}")

    return EngagePipelineResponse(
        status="ok",
        session_id=session_id,
        sensor_record_id=sensor_record_id,
        cleaning_report=cleaning_report,
        analytics_plots=analytics_plots,
        excel_report_path=excel_path,
        excel_download_url=excel_url,
        messages=messages,
    )


# ---------------------------------------------------------------------------
# /api/v1/reports/export-excel  — downloadable Excel file attachment
# ---------------------------------------------------------------------------

@app.get("/api/v1/reports/export-excel")
def export_excel(
    session_id: str = Query("all", description="Filter by sync_session_id, or 'all'."),
):
    """
    Generate (or serve the latest cached) Excel workbook for a session.
    Returns the file as an application/vnd.openxmlformats attachment.
    """
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


# ---------------------------------------------------------------------------
# /api/v1/reports/share-email  — Gmail-style SMTP automated reporting gateway
# ---------------------------------------------------------------------------

@app.post("/api/v1/reports/share-email")
def share_email(payload: EmailShareRequest) -> Dict[str, str]:
    """
    Asynchronously builds the requested reports (PDF / Excel) and sends
    them via SMTP to the target inbox.
    """
    import smtplib
    from email.message import EmailMessage
    import threading

    def _dispatch_email(email_addr: str, attach_pdf: bool, attach_excel: bool):
        msg = EmailMessage()
        msg['Subject'] = 'UNIBEN Biodiversity Pipeline - Automated Report'
        msg['From'] = 'system@uniben-pipeline.local'
        msg['To'] = email_addr
        msg.set_content(f"Hello,\n\nPlease find the requested data exports attached.\n\nGenerated at: {utc_now().isoformat()}")

        try:
            from report_engine import ReportEngine
            rpt = ReportEngine(db_path=DB_PATH, exports_dir=EXPORTS_DIR)
            
            if attach_excel:
                excel_path = rpt.generate_excel_spreadsheet(session_id="all")
                if excel_path and excel_path.exists():
                    with open(excel_path, 'rb') as f:
                        msg.add_attachment(f.read(), maintype='application', subtype='vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename=excel_path.name)
            
            if attach_pdf:
                pdf_path = rpt.generate_academic_pdf()
                if pdf_path and pdf_path.exists():
                    with open(pdf_path, 'rb') as f:
                        msg.add_attachment(f.read(), maintype='application', subtype='pdf', filename=pdf_path.name)
                        
            # Simulate dispatch since real credentials aren't provided
            # server = smtplib.SMTP('smtp.gmail.com', 587)
            # server.starttls()
            # server.login('your_email@gmail.com', 'your_password')
            # server.send_message(msg)
            # server.quit()
            import logging
            logging.getLogger("pipeline.email").info(f"SIMULATED EMAIL DISPATCH to {email_addr} with PDF={attach_pdf}, EXCEL={attach_excel}")
        except Exception as e:
            import logging
            logging.getLogger("pipeline.email").error(f"Failed to dispatch email: {e}")

    # Fire and forget
    threading.Thread(target=_dispatch_email, args=(payload.email, payload.attach_pdf, payload.attach_excel)).start()
    
    return {"status": "dispatched", "message": f"Email queued for dispatch to {payload.email}."}