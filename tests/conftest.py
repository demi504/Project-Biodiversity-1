"""
conftest.py — Pytest Configuration and Shared Fixtures
========================================================

Provides database setup, FastAPI test client, temporary directories,
and mocking utilities for the UNIBEN biodiversity pipeline test suite.
"""

import os
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def temp_dir() -> Generator[Path, None, None]:
    """Provide a temporary directory that is cleaned up after the test."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def temp_db_path(temp_dir: Path) -> Path:
    """Create a temporary database path."""
    db_path = temp_dir / "test_biodiversity.db"
    return db_path


@pytest.fixture
def temp_upload_dir(temp_dir: Path) -> Path:
    """Create a temporary upload directory."""
    upload_dir = temp_dir / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir


@pytest.fixture
def temp_analytics_dir(temp_dir: Path) -> Path:
    """Create a temporary analytics output directory."""
    analytics_dir = temp_dir / "analytics"
    analytics_dir.mkdir(parents=True, exist_ok=True)
    return analytics_dir


@pytest.fixture
def temp_exports_dir(temp_dir: Path) -> Path:
    """Create a temporary exports directory."""
    exports_dir = temp_dir / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)
    return exports_dir


@pytest.fixture
def test_db(temp_db_path: Path) -> Generator[sqlite3.Connection, None, None]:
    """Create and initialize a test database with schema."""
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")

    # Create tables
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

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS image_classifications (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            sensor_reading_id INTEGER,
            original_filename TEXT NOT NULL,
            stored_filename  TEXT NOT NULL,
            stored_path      TEXT NOT NULL,
            content_type     TEXT,
            file_size_bytes  INTEGER NOT NULL,
            model_name       TEXT NOT NULL,
            predicted_label  TEXT,
            confidence       REAL,
            status           TEXT NOT NULL,
            error_message    TEXT,
            created_at       TEXT NOT NULL,
            FOREIGN KEY(sensor_reading_id) REFERENCES sensor_readings(id)
        )
        """
    )

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

    conn.commit()
    yield conn
    conn.close()


@pytest.fixture
def app_with_test_config(temp_db_path: Path, temp_upload_dir: Path, temp_analytics_dir: Path, temp_exports_dir: Path):
    """Create a FastAPI app with test configuration."""
    # Mock environment variables
    os.environ["BIODIVERSITY_DB_PATH"] = str(temp_db_path)
    os.environ["BIODIVERSITY_UPLOAD_DIR"] = str(temp_upload_dir)
    os.environ["BIODIVERSITY_ANALYTICS_OUT"] = str(temp_analytics_dir)
    os.environ["BIODIVERSITY_EXPORTS_DIR"] = str(temp_exports_dir)
    os.environ["LOAD_TORCH_WEIGHTS"] = "false"

    # Import after setting environment variables
    from main import app

    yield app


@pytest.fixture
def client(app_with_test_config):
    """Create a FastAPI TestClient with test configuration."""
    return TestClient(app_with_test_config)


@pytest.fixture
def sample_sensor_reading() -> dict:
    """Provide sample sensor reading data."""
    return {
        "device_id": "ESP32-TEST-001",
        "temperature_c": 25.5,
        "humidity_percent": 65.0,
        "pressure_hPa": 1013.25,
        "light_lux": 500.0,
        "sound_db": 45.0,
        "altitude_m": 100.0,
        "latitude": 6.335,
        "longitude": 5.603,
        "notes": "Test reading",
        "data_source": "LIVE_ESP32",
    }


@pytest.fixture
def sample_invalid_sensor_reading() -> dict:
    """Provide invalid sensor reading data (missing required fields)."""
    return {
        "device_id": "ESP32-TEST-002",
        "temperature_c": 25.5,
        # Missing other required fields
    }


@pytest.fixture
def utc_now() -> datetime:
    """Return current UTC datetime."""
    return datetime.now(timezone.utc)


@pytest.fixture
def mock_torch():
    """Mock PyTorch for testing without GPU/dependencies."""
    mock = MagicMock()
    mock.cuda.is_available.return_value = False
    mock.no_grad.return_value.__enter__ = MagicMock(return_value=None)
    mock.no_grad.return_value.__exit__ = MagicMock(return_value=None)
    mock.nn.functional.softmax.return_value = MagicMock()
    mock.max.return_value = (MagicMock(item=lambda: 0.95), MagicMock(item=lambda: 10))
    return mock


@pytest.fixture
def mock_pillow_image():
    """Mock PIL Image for testing image processing."""
    mock = MagicMock()
    mock.convert.return_value = mock
    mock.size = (224, 224)
    return mock


@pytest.fixture(autouse=True)
def reset_env_vars():
    """Reset environment variables after each test."""
    original_env = os.environ.copy()
    yield
    os.environ.clear()
    os.environ.update(original_env)
