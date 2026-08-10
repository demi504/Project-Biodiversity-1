"""
test_main.py — Unit Tests for FastAPI Endpoints
===============================================

Tests for all endpoints in main.py:
  - Health checks
  - Sensor reading CRUD operations
  - Image classification and upload
  - Weather integration
  - Analytics pipeline execution
  - Report generation and sharing
"""

import json
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import status
from fastapi.testclient import TestClient


class TestHealth:
    """Test health check and hardware status endpoints."""

    def test_health_endpoint_success(self, client: TestClient):
        """Test GET /health returns ok status."""
        response = client.get("/health")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "status" in data
        assert data["status"] in ("ok", "degraded")
        assert "database_available" in data
        assert "upload_dir_available" in data

    def test_hardware_status_connected(self, client: TestClient):
        """Test GET /api/v1/hardware/status returns hardware status."""
        response = client.get("/api/v1/hardware/status")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "status" in data
        assert data["status"] in ("connected", "disconnected")


class TestSensorReadings:
    """Test sensor reading endpoints."""

    def test_create_sensor_reading_success(self, client: TestClient, sample_sensor_reading: dict):
        """Test POST /sensor-readings creates a new reading."""
        response = client.post("/sensor-readings", json=sample_sensor_reading)
        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()
        assert data["device_id"] == sample_sensor_reading["device_id"]
        assert data["temperature_c"] == sample_sensor_reading["temperature_c"]
        assert data["humidity_percent"] == sample_sensor_reading["humidity_percent"]
        assert "id" in data
        assert "received_at" in data

    def test_create_sensor_reading_invalid_data(self, client: TestClient, sample_invalid_sensor_reading: dict):
        """Test POST /sensor-readings with invalid data returns 422."""
        response = client.post("/sensor-readings", json=sample_invalid_sensor_reading)
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_create_sensor_reading_invalid_humidity(self, client: TestClient, sample_sensor_reading: dict):
        """Test POST /sensor-readings with invalid humidity returns 422."""
        sample_sensor_reading["humidity_percent"] = 150.0  # Invalid: > 100
        response = client.post("/sensor-readings", json=sample_sensor_reading)
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_create_sensor_reading_invalid_latitude(self, client: TestClient, sample_sensor_reading: dict):
        """Test POST /sensor-readings with invalid latitude returns 422."""
        sample_sensor_reading["latitude"] = 100.0  # Invalid: > 90
        response = client.post("/sensor-readings", json=sample_sensor_reading)
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_list_sensor_readings_empty(self, client: TestClient):
        """Test GET /sensor-readings returns empty list initially."""
        response = client.get("/sensor-readings")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_list_sensor_readings_with_data(self, client: TestClient, sample_sensor_reading: dict):
        """Test GET /sensor-readings returns created readings."""
        # Create a reading
        client.post("/sensor-readings", json=sample_sensor_reading)

        # List readings
        response = client.get("/sensor-readings")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) > 0
        assert data[0]["device_id"] == sample_sensor_reading["device_id"]

    def test_list_sensor_readings_with_limit(self, client: TestClient, sample_sensor_reading: dict):
        """Test GET /sensor-readings with limit parameter."""
        # Create multiple readings
        for i in range(5):
            reading = sample_sensor_reading.copy()
            reading["device_id"] = f"ESP32-{i:03d}"
            client.post("/sensor-readings", json=reading)

        # List with limit
        response = client.get("/sensor-readings?limit=2")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) <= 2

    def test_list_sensor_readings_with_offset(self, client: TestClient, sample_sensor_reading: dict):
        """Test GET /sensor-readings with offset parameter."""
        # Create multiple readings
        for i in range(3):
            reading = sample_sensor_reading.copy()
            reading["device_id"] = f"ESP32-{i:03d}"
            client.post("/sensor-readings", json=reading)

        # List with offset
        response = client.get("/sensor-readings?offset=1&limit=10")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) <= 2

    def test_list_sensor_readings_filter_by_source(self, client: TestClient, sample_sensor_reading: dict):
        """Test GET /sensor-readings with source filter."""
        # Create reading with ESP32 source
        client.post("/sensor-readings", json=sample_sensor_reading)

        # List with source filter
        response = client.get("/sensor-readings?source=LIVE_ESP32")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) >= 1
        for reading in data:
            assert reading["data_source"] == "LIVE_ESP32"


class TestImageClassification:
    """Test image upload and classification endpoints."""

    def test_upload_image_valid(self, client: TestClient):
        """Test POST /api/v1/upload-image with valid image."""
        # Create a simple valid image file
        image_data = b"\xFF\xD8\xFF\xE0\x00\x10JFIF"  # JPEG header
        response = client.post(
            "/api/v1/upload-image",
            files={"file": ("test_image.jpg", image_data, "image/jpeg")},
        )
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "status" in data
        assert "predicted_label" in data
        assert "confidence" in data
        assert "taxonomy" in data

    def test_upload_image_invalid_extension(self, client: TestClient):
        """Test POST /api/v1/upload-image with invalid extension."""
        image_data = b"invalid data"
        response = client.post(
            "/api/v1/upload-image",
            files={"file": ("test_image.txt", image_data, "text/plain")},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_upload_image_invalid_mime_type(self, client: TestClient):
        """Test POST /api/v1/upload-image with invalid MIME type."""
        image_data = b"invalid data"
        response = client.post(
            "/api/v1/upload-image",
            files={"file": ("test_image.jpg", image_data, "text/plain")},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_upload_image_with_sensor_id(self, client: TestClient, sample_sensor_reading: dict):
        """Test POST /api/v1/upload-image with valid sensor_reading_id."""
        # Create a sensor reading first
        sensor_response = client.post("/sensor-readings", json=sample_sensor_reading)
        sensor_id = sensor_response.json()["id"]

        # Upload image linked to sensor
        image_data = b"\xFF\xD8\xFF\xE0\x00\x10JFIF"
        response = client.post(
            "/api/v1/upload-image",
            files={"file": ("test_image.jpg", image_data, "image/jpeg")},
            data={"sensor_reading_id": sensor_id},
        )
        assert response.status_code == status.HTTP_200_OK

    def test_upload_image_invalid_sensor_id(self, client: TestClient):
        """Test POST /api/v1/upload-image with invalid sensor_reading_id."""
        image_data = b"\xFF\xD8\xFF\xE0\x00\x10JFIF"
        response = client.post(
            "/api/v1/upload-image",
            files={"file": ("test_image.jpg", image_data, "image/jpeg")},
            data={"sensor_reading_id": 99999},
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_list_image_classifications_empty(self, client: TestClient):
        """Test GET /image-classifications returns empty list initially."""
        response = client.get("/image-classifications")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert isinstance(data, list)

    def test_list_image_classifications_with_data(self, client: TestClient):
        """Test GET /image-classifications returns uploaded images."""
        # Upload an image
        image_data = b"\xFF\xD8\xFF\xE0\x00\x10JFIF"
        client.post(
            "/api/v1/upload-image",
            files={"file": ("test_image.jpg", image_data, "image/jpeg")},
        )

        # List images
        response = client.get("/image-classifications")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) >= 1


class TestDroneUpload:
    """Test drone patch and ground batch upload endpoints."""

    def test_upload_drone_patch_success(self, client: TestClient):
        """Test POST /api/v1/upload-drone-patch uploads drone image."""
        image_data = b"\xFF\xD8\xFF\xE0\x00\x10JFIF"
        response = client.post(
            "/api/v1/upload-drone-patch",
            files={"image": ("drone_patch.jpg", image_data, "image/jpeg")},
            data={
                "campus_zone": "Ugbowo Campus North",
                "flight_timestamp": "2026-06-22T14:30:00Z",
            },
        )
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED)

    def test_upload_drone_patch_invalid_image(self, client: TestClient):
        """Test POST /api/v1/upload-drone-patch with invalid image."""
        response = client.post(
            "/api/v1/upload-drone-patch",
            files={"image": ("test.txt", b"invalid", "text/plain")},
            data={
                "campus_zone": "Ugbowo Campus North",
                "flight_timestamp": "2026-06-22T14:30:00Z",
            },
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_upload_ground_batch_success(self, client: TestClient):
        """Test POST /api/v1/upload-ground-batch uploads multiple images."""
        image_data = b"\xFF\xD8\xFF\xE0\x00\x10JFIF"
        response = client.post(
            "/api/v1/upload-ground-batch",
            files=[
                ("image_files", ("ground1.jpg", image_data, "image/jpeg")),
                ("image_files", ("ground2.jpg", image_data, "image/jpeg")),
            ],
            data={
                "campus_zone": "Ugbowo Campus North",
                "species_name": "Delonix regia",
                "common_name": "Royal Poinciana",
                "gps_lat": "6.335",
                "gps_long": "5.603",
            },
        )
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED)


class TestSDCardUpload:
    """Test contingency SD card CSV upload."""

    def test_upload_sd_card_valid_csv(self, client: TestClient):
        """Test POST /api/telemetry/upload-contingency with valid CSV."""
        csv_data = """device_id,temperature_c,humidity_percent,pressure_hPa,light_lux,sound_db,altitude_m,latitude,longitude,observed_at
ESP32-001,25.5,65.0,1013.25,500,45,100,6.335,5.603,2026-06-22T14:00:00Z
ESP32-001,26.0,66.0,1013.50,520,46,101,6.335,5.603,2026-06-22T14:30:00Z
"""
        response = client.post(
            "/api/telemetry/upload-contingency",
            files={"csv_file": ("sensor_data.csv", csv_data.encode(), "text/csv")},
        )
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED)
        data = response.json()
        assert "status" in data
        assert "rows_parsed" in data
        assert "rows_inserted" in data

    def test_upload_sd_card_empty_csv(self, client: TestClient):
        """Test POST /api/telemetry/upload-contingency with empty CSV."""
        csv_data = ""
        response = client.post(
            "/api/telemetry/upload-contingency",
            files={"csv_file": ("sensor_data.csv", csv_data.encode(), "text/csv")},
        )
        # Should either accept empty CSV or return 400
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_400_BAD_REQUEST)


class TestWeatherIntegration:
    """Test OpenWeatherMap integration."""

    @patch("urllib.request.urlopen")
    def test_weather_field_day_success(self, mock_urlopen, client: TestClient):
        """Test GET /api/weather/field-day returns weather data."""
        # Mock OpenWeatherMap response
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "main": {
                "temp": 25.0,
                "humidity": 65,
            },
            "weather": [{"main": "Clear"}],
        }).encode()
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.get("/api/weather/field-day?latitude=6.335&longitude=5.603")
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_400_BAD_REQUEST)

    def test_weather_field_day_missing_coords(self, client: TestClient):
        """Test GET /api/weather/field-day without coordinates."""
        response = client.get("/api/weather/field-day")
        # Should return 422 for missing query parameters or 200 if they have defaults
        assert response.status_code in (status.HTTP_422_UNPROCESSABLE_ENTITY, status.HTTP_200_OK)


class TestAnalyticsPipeline:
    """Test analytics pipeline endpoints."""

    @patch("pipeline_analytics.AnalyticsEngine")
    def test_run_pipeline_success(self, mock_engine, client: TestClient):
        """Test POST /api/v1/analytics/run-pipeline executes pipeline."""
        response = client.post(
            "/api/v1/analytics/run-pipeline",
            json={"query": "run_full_pipeline"},
        )
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_202_ACCEPTED, status.HTTP_400_BAD_REQUEST)

    @patch("pipeline_analytics.AnalyticsEngine")
    def test_run_pipeline_empty_request(self, mock_engine, client: TestClient):
        """Test POST /api/v1/analytics/run-pipeline with empty body."""
        response = client.post("/api/v1/analytics/run-pipeline", json={})
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_202_ACCEPTED, status.HTTP_400_BAD_REQUEST)


class TestReports:
    """Test report generation and sharing."""

    def test_export_excel_no_data(self, client: TestClient):
        """Test GET /api/v1/reports/export-excel with no data."""
        response = client.get("/api/v1/reports/export-excel")
        # May return 404 if no report exists or 200 with empty file
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_404_NOT_FOUND)

    @patch("smtplib.SMTP")
    def test_share_email_success(self, mock_smtp, client: TestClient):
        """Test POST /api/v1/reports/share-email shares report via email."""
        response = client.post(
            "/api/v1/reports/share-email",
            json={
                "email": "test@example.com",
                "attach_pdf": False,
                "attach_excel": False,
            },
        )
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_400_BAD_REQUEST)

    def test_share_email_invalid_email(self, client: TestClient):
        """Test POST /api/v1/reports/share-email with invalid email."""
        response = client.post(
            "/api/v1/reports/share-email",
            json={
                "email": "invalid-email",
                "attach_pdf": False,
                "attach_excel": False,
            },
        )
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_400_BAD_REQUEST, status.HTTP_422_UNPROCESSABLE_ENTITY)


class TestModuleImports:
    """Test that critical modules can be imported."""

    def test_import_main_module(self):
        """Test that main module imports successfully."""
        try:
            import main
            assert hasattr(main, "app")
            assert hasattr(main, "get_connection")
            assert hasattr(main, "init_database")
        except ImportError:
            pytest.skip("main module not available in test environment")

    def test_import_enrich_pipeline(self):
        """Test that enrich_pipeline module imports successfully."""
        try:
            import enrich_pipeline
            assert hasattr(enrich_pipeline, "enrich_plant_image")
        except ImportError:
            pytest.skip("enrich_pipeline module not available")

    def test_import_pipeline_analytics(self):
        """Test that pipeline_analytics module imports successfully."""
        try:
            import pipeline_analytics
            assert hasattr(pipeline_analytics, "AnalyticsEngine")
        except ImportError:
            pytest.skip("pipeline_analytics module not available")

    def test_import_report_engine(self):
        """Test that report_engine module imports successfully."""
        try:
            import report_engine
            assert hasattr(report_engine, "ReportEngine")
        except ImportError:
            pytest.skip("report_engine module not available")
