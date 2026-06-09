"""
Campus-scale biodiversity and environmental data pipeline API.

This script is intentionally self-contained for local-first field deployments:
- SQLite stores sensor readings and image classification metadata.
- Uploaded drone imagery is persisted to a local directory before inference.
- PyTorch model loading and inference failures never discard field data.

Run locally:
    uvicorn main:app --reload
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Local configuration
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("BIODIVERSITY_DB_PATH", BASE_DIR / "data" / "biodiversity.db"))
UPLOAD_DIR = Path(os.getenv("BIODIVERSITY_UPLOAD_DIR", BASE_DIR / "data" / "uploads"))

# In offline deployments, pretrained weights may not be cached. Keep this false
# by default so model construction does not try to download anything.
LOAD_TORCH_WEIGHTS = os.getenv("LOAD_TORCH_WEIGHTS", "false").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/tiff",
    "image/webp",
}


# ---------------------------------------------------------------------------
# Pydantic API models
# ---------------------------------------------------------------------------

class SensorReadingCreate(BaseModel):
    """Incoming environmental sensor payload."""

    device_id: str = Field(..., min_length=1, max_length=120)
    temperature_c: float = Field(..., description="Ambient temperature in Celsius.")
    humidity_percent: float = Field(..., ge=0, le=100)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    altitude_m: Optional[float] = Field(None, description="Optional GPS altitude in meters.")
    observed_at: Optional[datetime] = Field(
        None,
        description="Sensor timestamp. Defaults to server receipt time when omitted.",
    )
    notes: Optional[str] = Field(None, max_length=2000)


class SensorReadingResponse(BaseModel):
    """Stored environmental reading returned to clients."""

    id: int
    device_id: str
    temperature_c: float
    humidity_percent: float
    latitude: float
    longitude: float
    altitude_m: Optional[float]
    observed_at: datetime
    received_at: datetime
    notes: Optional[str]


class ImageClassificationResponse(BaseModel):
    """Stored drone image metadata plus model inference result."""

    id: int
    sensor_reading_id: Optional[int]
    original_filename: str
    stored_filename: str
    stored_path: str
    content_type: Optional[str]
    file_size_bytes: int
    model_name: str
    predicted_label: Optional[str]
    confidence: Optional[float]
    status: str
    error_message: Optional[str]
    created_at: datetime


class HealthResponse(BaseModel):
    """Operational health response for local field checks."""

    status: str
    database_path: str
    database_available: bool
    upload_dir: str
    upload_dir_available: bool
    models_loaded: bool
    model_status: Dict[str, str]
    offline_mode: bool


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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sensor_readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                temperature_c REAL NOT NULL,
                humidity_percent REAL NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                altitude_m REAL,
                observed_at TEXT NOT NULL,
                received_at TEXT NOT NULL,
                notes TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS image_classifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sensor_reading_id INTEGER,
                original_filename TEXT NOT NULL,
                stored_filename TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                content_type TEXT,
                file_size_bytes INTEGER NOT NULL,
                model_name TEXT NOT NULL,
                predicted_label TEXT,
                confidence REAL,
                status TEXT NOT NULL,
                error_message TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(sensor_reading_id)
                    REFERENCES sensor_readings(id)
                    ON DELETE SET NULL
            )
            """
        )
        conn.commit()


def sensor_row_to_response(row: sqlite3.Row) -> SensorReadingResponse:
    """Convert a SQLite sensor row into a typed API response."""

    return SensorReadingResponse(
        id=row["id"],
        device_id=row["device_id"],
        temperature_c=row["temperature_c"],
        humidity_percent=row["humidity_percent"],
        latitude=row["latitude"],
        longitude=row["longitude"],
        altitude_m=row["altitude_m"],
        observed_at=parse_iso(row["observed_at"]),
        received_at=parse_iso(row["received_at"]),
        notes=row["notes"],
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
# PyTorch model manager
# ---------------------------------------------------------------------------

class BiodiversityModelManager:
    """
    Lazy PyTorch model loader for local-first operation.

    The API can run without torch/torchvision installed. It can also run without
    internet because pretrained weights are opt-in through LOAD_TORCH_WEIGHTS.
    """

    def __init__(self) -> None:
        self.models: Dict[str, Any] = {}
        self.status: Dict[str, str] = {
            "mobilenet_v3_small": "not_loaded",
            "resnet50": "not_loaded",
        }
        self._torch: Any = None
        self._preprocess: Any = None

    @property
    def loaded(self) -> bool:
        return bool(self.models)

    def load(self) -> None:
        """Instantiate MobileNetV3-Small and ResNet50 if dependencies permit."""

        try:
            import torch
            from PIL import Image
            from torchvision import models, transforms
        except Exception as exc:  # pragma: no cover - depends on local packages.
            message = f"dependency_unavailable: {exc}"
            self.status["mobilenet_v3_small"] = message
            self.status["resnet50"] = message
            return

        self._torch = torch

        # Basic ImageNet-style preprocessing. Replace this with training-time
        # transforms once campus-specific biodiversity models are available.
        self._preprocess = transforms.Compose(
            [
                transforms.Resize(256),
                transforms.CenterCrop(224),
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=[0.485, 0.456, 0.406],
                    std=[0.229, 0.224, 0.225],
                ),
            ]
        )

        model_specs = {
            "mobilenet_v3_small": (
                models.mobilenet_v3_small,
                models.MobileNet_V3_Small_Weights.DEFAULT if LOAD_TORCH_WEIGHTS else None,
            ),
            "resnet50": (
                models.resnet50,
                models.ResNet50_Weights.DEFAULT if LOAD_TORCH_WEIGHTS else None,
            ),
        }

        for model_name, (factory, weights) in model_specs.items():
            try:
                model = factory(weights=weights)
                model.eval()
                self.models[model_name] = model
                self.status[model_name] = "loaded_with_weights" if weights else "loaded_without_weights"
            except Exception as exc:  # pragma: no cover - depends on local packages.
                self.status[model_name] = f"load_failed: {exc}"

        # Keep imports visibly used for dependency checks and future extension.
        _ = Image

    def infer(self, image_path: Path) -> Dict[str, Any]:
        """
        Run placeholder inference over loaded models.

        This demonstrates the correct PyTorch flow: open image, preprocess,
        add a batch dimension, call models under torch.no_grad(), and inspect
        softmax probabilities. Because no campus-specific label map is provided,
        labels are returned as ImageNet index placeholders.
        """

        if not self.models or self._torch is None or self._preprocess is None:
            return {
                "model_name": "none",
                "predicted_label": None,
                "confidence": None,
                "status": "model_unavailable",
                "error_message": "No PyTorch models are currently loaded.",
            }

        try:
            from PIL import Image

            image = Image.open(image_path).convert("RGB")
            tensor = self._preprocess(image).unsqueeze(0)

            predictions: List[Dict[str, Any]] = []
            with self._torch.no_grad():
                for model_name, model in self.models.items():
                    output = model(tensor)
                    probabilities = self._torch.nn.functional.softmax(output[0], dim=0)
                    confidence, class_index = self._torch.max(probabilities, dim=0)
                    predictions.append(
                        {
                            "model_name": model_name,
                            "predicted_label": f"imagenet_class_{int(class_index.item())}",
                            "confidence": float(confidence.item()),
                        }
                    )

            if not predictions:
                return {
                    "model_name": "none",
                    "predicted_label": None,
                    "confidence": None,
                    "status": "model_unavailable",
                    "error_message": "Model registry is empty after loading.",
                }

            # For this placeholder, store the highest-confidence result across
            # both models. A production version may store all model outputs.
            best_prediction = max(predictions, key=lambda item: item["confidence"])
            return {
                **best_prediction,
                "status": "success",
                "error_message": None,
            }
        except Exception as exc:
            return {
                "model_name": ",".join(self.models.keys()) or "unknown",
                "predicted_label": None,
                "confidence": None,
                "status": "failed",
                "error_message": str(exc),
            }


model_manager = BiodiversityModelManager()


# ---------------------------------------------------------------------------
# FastAPI lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Initialize local storage and try model loading during app startup."""

    init_database()
    model_manager.load()
    yield


app = FastAPI(
    title="Campus Biodiversity Data Pipeline",
    description="Local-first API for environmental sensor data and drone image inference.",
    version="1.0.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# File validation and persistence helpers
# ---------------------------------------------------------------------------

def validate_image_upload(file: UploadFile) -> str:
    """Validate image extension and MIME type before saving to disk."""

    original_name = file.filename or ""
    extension = Path(original_name).suffix.lower()

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
    stored_path = UPLOAD_DIR / stored_filename

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
    """Report whether local storage and models are ready for field use."""

    database_available = False
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
        model_status=model_manager.status,
        offline_mode=not LOAD_TORCH_WEIGHTS,
    )


@app.post(
    "/sensor-readings",
    response_model=SensorReadingResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_sensor_reading(payload: SensorReadingCreate) -> SensorReadingResponse:
    """Store one environmental sensor reading in local SQLite."""

    observed_at = payload.observed_at or utc_now()
    received_at = utc_now()

    try:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO sensor_readings (
                    device_id,
                    temperature_c,
                    humidity_percent,
                    latitude,
                    longitude,
                    altitude_m,
                    observed_at,
                    received_at,
                    notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.device_id,
                    payload.temperature_c,
                    payload.humidity_percent,
                    payload.latitude,
                    payload.longitude,
                    payload.altitude_m,
                    to_iso(observed_at),
                    to_iso(received_at),
                    payload.notes,
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
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> List[SensorReadingResponse]:
    """Return recent environmental readings for dashboard display."""

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


@app.post(
    "/drone-images",
    response_model=ImageClassificationResponse,
    status_code=status.HTTP_201_CREATED,
)
def upload_drone_image(
    file: UploadFile = File(...),
    sensor_reading_id: Optional[int] = Form(None),
) -> ImageClassificationResponse:
    """
    Save a drone image locally, run placeholder inference, and persist results.

    The file is saved before inference. If PyTorch or the model call fails, the
    metadata row still records that failure so field uploads are not lost.
    """

    if sensor_reading_id is not None:
        ensure_sensor_exists(sensor_reading_id)

    extension = validate_image_upload(file)
    stored_filename, stored_path, file_size = save_upload_to_disk(file, extension)
    inference = model_manager.infer(stored_path)
    created_at = utc_now()

    try:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO image_classifications (
                    sensor_reading_id,
                    original_filename,
                    stored_filename,
                    stored_path,
                    content_type,
                    file_size_bytes,
                    model_name,
                    predicted_label,
                    confidence,
                    status,
                    error_message,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sensor_reading_id,
                    file.filename or "unknown",
                    stored_filename,
                    str(stored_path),
                    file.content_type,
                    file_size,
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
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
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