# UNIBEN Biodiversity Pipeline

**Thesis project** — *Development of a Campus-Scale Biodiversity and Environmental Data Pipeline Using Drone Imagery and Sensor Integration for Machine Learning Application: A Case Study for UNIBEN Ugbowo Campus.*

---

## Monorepo Structure

```
.
├── frontend/          # React 18 + Vite dashboard (3-tab dual-stream UI)
│   ├── src/
│   │   └── App.jsx    # Tab 1: Telemetry · Tab 2: Drone Canopy · Tab 3: Ground Ingestion
│   ├── public/
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── backend/           # Python 3.12 + FastAPI pipeline server
│   ├── main.py        # FastAPI app — REST + WebSocket + dual-stream endpoints
│   ├── pipeline_analytics.py
│   ├── pipeline_sync.py
│   ├── report_engine.py
│   ├── enrich_pipeline.py
│   ├── dashboard.py
│   ├── firmware/
│   │   └── esp32_biodiversity_sensor.ino   # ESP32 sensor firmware
│   └── tests/
│
├── data/              # SQLite database + uploads + exports (git-ignored)
│   ├── biodiversity.db
│   ├── uploads/
│   └── exports/
│
├── .env               # API keys (git-ignored — see .env.example)
├── .gitignore
└── README.md
```

---

## 3-Zone Spatial Segmentation

Campus imagery and telemetry are automatically assigned to one of three focal zones using GPS geofencing:

| Zone | Label | Description | GPS Bounds (approx.) |
|---|---|---|---|
| `ZONE_A` | Dense Canopy / Forested Sector | Closed-canopy forest patches, riparian corridors | Lat 6.396–6.402, Lon 5.607–5.615 |
| `ZONE_B` | Mixed Urban / Shrub Perimeter | Campus roads, building margins, shrubland | Lat 6.390–6.397, Lon 5.600–5.612 |
| `ZONE_C` | Open Ground / Bare Soil | Playing fields, car parks, exposed soil | Lat 6.384–6.392, Lon 5.594–5.607 |

Zone assignment is automatic: upload any image with GPS coordinates → backend calls `assign_focal_zone(lat, lon)` → returns `ZONE_A`, `ZONE_B`, or `ZONE_C`.

---

## Dual-Stream Pipeline

### Stream 1 — Drone Aerial Canopy Mapping
- **Endpoint**: `POST /api/v1/upload-drone-patch`
- Accepts orthomosaic tiles / aerial frames
- Runs MobileNetV3 CV inference on aerial content
- GPS geofences to focal zone automatically
- Validates image integrity (Pillow corruption check)

### Stream 2 — Ground-Level Species Ingestion
- **Endpoint**: `POST /api/v1/upload-ground-image`
- Single close-up species image
- MobileNetV3 inference → species prediction + confidence
- Temporal telemetry sync: links image to nearest ESP32 sensor reading within ±5 min
- GPS geofences to focal zone automatically
- Background PlantNet taxonomy tagging (batch endpoint)

### Sensor Stream — ESP32 WebSocket
- **Endpoint**: `WS /ws/telemetry`
- 8-parameter environmental readings streamed in real-time
- Automated outlier cleaning (physical range checks)

---

## Quick Start

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev        # → http://localhost:5173
```

### ESP32 Firmware

1. Open `backend/firmware/esp32_biodiversity_sensor.ino` in Arduino IDE ≥ 2.x
2. Set WiFi credentials and server IP in the firmware constants
3. Select board **ESP32 Dev Module**, set baud rate to **115200**
4. Flash to device — sensor streams to `ws://<server-ip>:8000/ws/telemetry`

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React 18 · Vite · Tailwind CSS · Framer Motion · Recharts |
| Backend | FastAPI · Uvicorn · SQLite (WAL mode) · PyTorch (MobileNetV3) |
| Realtime | WebSocket `/ws/telemetry` — ESP32 → FastAPI → React |
| Dual-Stream | `upload-drone-patch` (aerial) + `upload-ground-image` (terrestrial) |
| Spatial | GPS geofencing → 3-zone (ZONE_A/B/C) auto-assignment |
| Temporal | ±5-min telemetry synchronization on ground image upload |
| Cleaning | Pillow integrity check · sensor outlier range filter |
| Storage | SQLite · local file uploads · Excel report export |
| Hardware | ESP32-WROOM-32 · DHT22 · BMP280 · BH1750 · MAX4466 mic |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | System health check |
| `GET` | `/api/v1/hardware/status` | ESP32 connection status |
| `WS` | `/ws/telemetry` | Live ESP32 sensor stream |
| `POST` | `/sensor-readings` | Store sensor reading (REST) |
| `GET` | `/sensor-readings` | List readings |
| `POST` | `/api/v1/upload-drone-patch` | Drone orthomosaic upload + CV + zone |
| `POST` | `/api/v1/upload-ground-image` | Ground species image + telemetry fusion |
| `POST` | `/api/v1/upload-ground-batch` | Batch ground images + PlantNet |
| `POST` | `/api/telemetry/upload-contingency` | SD card CSV import |
| `GET` | `/api/v1/zones` | List 3 focal zones with GPS bounds |
| `GET` | `/api/v1/zones/{zone_id}/summary` | Per-zone observation counts |
| `GET` | `/api/weather/field-day` | OpenWeatherMap micro-climate |
| `POST` | `/api/v1/analytics/run-pipeline` | Full data science pipeline |
| `GET` | `/api/v1/reports/export-excel` | Download Excel workbook |

---

## Environment Variables (`.env`)

```ini
OPENWEATHERMAP_API_KEY=your_key_here
PLANTNET_API_KEY=your_key_here
BIODIVERSITY_DB_PATH=            # optional override
BIODIVERSITY_UPLOAD_DIR=         # optional override
```
