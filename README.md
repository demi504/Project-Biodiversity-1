# UNIBEN Biodiversity Pipeline

**Thesis project** — *Development of a campus-scale biodiversity and environmental data pipeline using drone imagery and sensor integration for machine learning application: A case study for UNIBEN Ugbowo campus.*

---

## Monorepo Structure

```
.
├── frontend/          # React 18 + Vite + Tailwind CSS dashboard
│   ├── src/
│   │   └── App.jsx    # 3-tab dashboard (Telemetry · Field Sync · Ground Ingestion)
│   ├── public/
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── backend/           # Python 3.12 + FastAPI pipeline server
│   ├── main.py        # FastAPI app — REST + WebSocket endpoints
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

## Quick Start

### Backend

```bash
cd backend
pip install -r requirements.txt          # or: uv pip install -r requirements.txt
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
2. Create `firmware_secrets.h` from the template and fill in your WiFi credentials
3. Select board **ESP32 Dev Module**, set baud rate to **115200**
4. Flash to device

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React 18 · Vite · Tailwind CSS · Framer Motion · Recharts |
| Backend | FastAPI · Uvicorn · SQLite (WAL mode) · PyTorch (MobileNetV3) |
| Realtime | WebSocket `/ws/telemetry` — ESP32 → FastAPI → React |
| Storage | SQLite · local file uploads · Excel report export |
| Hardware | ESP32-WROOM-32 · DHT22 · BMP280 · BH1750 · MAX4466 mic |

---

## Environment Variables (`.env`)

```ini
OPENWEATHERMAP_API_KEY=your_key_here
PLANTNET_API_KEY=your_key_here
BIODIVERSITY_DB_PATH=            # optional override
BIODIVERSITY_UPLOAD_DIR=         # optional override
```
