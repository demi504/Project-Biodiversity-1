/**
 * UNIBEN Biodiversity Pipeline — ESP32 Sensor Firmware
 * =====================================================
 *
 * Hardware: ESP32-WROOM-32 (or equivalent DevKit)
 *
 * Sensors wired:
 *   • DHT22          — Temperature (°C) + Humidity (%)
 *   • BMP280/BMP180  — Barometric Pressure (hPa) + Altitude (m)
 *   • BH1750 / LDR   — Ambient Light (Lux)
 *   • MAX4466 / INMP441 — Sound Level (dB SPL, approximated)
 *
 * Network target:
 *   WiFi SSID    : Demmy
 *   Server IP    : 10.235.213.234  (laptop wireless IPv4)
 *   Server Port  : 8000
 *   WS Path      : /ws/telemetry
 *   Full URI     : ws://10.235.213.234:8000/ws/telemetry
 *
 * Serial monitor: 115200 baud
 *
 * Transmission cycle: every 2500 ms (matches frontend POLL_MS = 2500)
 *
 * Build with Arduino IDE ≥ 2.x or PlatformIO.
 * Board: "ESP32 Dev Module" (esp32 by Espressif ≥ 3.0.0)
 *
 * Required libraries (install via Library Manager):
 *   - ArduinoWebsockets  (Links2004/arduinoWebSockets or similar)
 *   - ArduinoJson        (≥ 6.x)
 *   - DHT sensor library (Adafruit)
 *   - Adafruit BMP280    (or BMP085/BMP180 variant)
 *   - BH1750             (claws/BH1750, optional — falls back to ADC)
 */

// ─── Library includes ────────────────────────────────────────────────────────
#include <WiFi.h>
#include <WebSocketsClient.h>   // Links2004/arduinoWebSockets
#include <ArduinoJson.h>        // bblanchon/ArduinoJson ≥ 6
#include <DHT.h>                // Adafruit DHT sensor library
#include <Adafruit_BMP280.h>    // Adafruit BMP280 library
// Uncomment if BH1750 module is wired via I2C:
// #include <BH1750.h>

// ─── Network constants ───────────────────────────────────────────────────────

// WiFi credentials — campus wireless network
// ⚠ SECURITY: Replace with your actual credentials before flashing.
//   Do NOT commit real passwords to version control.
//   Copy firmware_secrets_template.h → firmware_secrets.h and fill in values.
const char* WIFI_SSID     = "YOUR_WIFI_SSID";      // e.g. "Demmy"
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";   // your WiFi passphrase

// FastAPI backend — laptop wireless IPv4 on the same LAN
const char* SERVER_HOST   = "10.235.213.234"; // Laptop LAN IP (uvicorn --host 0.0.0.0)
const uint16_t SERVER_PORT = 8000;            // Must match uvicorn --port 8000
const char* WS_PATH       = "/ws/telemetry"; // FastAPI WebSocket route

// ─── Sensor pin / bus configuration ─────────────────────────────────────────

#define DHT_PIN       4          // GPIO4 — DATA line of DHT22
#define DHT_TYPE      DHT22      // DHT22 (AM2302) — 18-bit precision

// BMP280 uses I2C (SDA=GPIO21, SCL=GPIO22 on most ESP32 DevKits)
// Ensure SDO pin is pulled LOW for address 0x76, HIGH for 0x77
#define BMP_I2C_ADDR  0x76

// Sound level — analogue mic module (e.g. MAX4466)
// Reads 0–4095 from ADC and maps to approximate dB SPL range 30–90 dB
#define MIC_PIN       34         // GPIO34 (input-only, no pull-up needed)

// ─── Timing ──────────────────────────────────────────────────────────────────

#define TRANSMIT_INTERVAL_MS  2500   // Send telemetry frame every 2.5 seconds
#define WIFI_RETRY_DELAY_MS   500    // Delay between WiFi connection attempts
#define WIFI_MAX_RETRIES      40     // Give up after 20 s (40 × 500 ms)
#define RECONNECT_INTERVAL_MS 5000   // WebSocket reconnect back-off

// ─── Device identity ─────────────────────────────────────────────────────────

#define DEVICE_ID  "ESP32-BIODIVERSITY-001"  // Matches sensor_readings.device_id

// ─── Global objects ──────────────────────────────────────────────────────────

DHT             dht(DHT_PIN, DHT_TYPE);
Adafruit_BMP280 bmp;
WebSocketsClient wsClient;
// BH1750 lightMeter;  // Uncomment if I2C light sensor is available

// ─── State ───────────────────────────────────────────────────────────────────

bool     wsConnected      = false;
uint32_t lastTransmitMs   = 0;
uint32_t lastReconnectMs  = 0;

// ─── Forward declarations ─────────────────────────────────────────────────────

void connectWiFi();
void connectWebSocket();
void wsEventHandler(WStype_t type, uint8_t* payload, size_t length);
void sendTelemetryFrame();
float readSoundDb();
float readLightLux();

// ═══════════════════════════════════════════════════════════════════════════════
// setup()
// ═══════════════════════════════════════════════════════════════════════════════

void setup() {
    // Initialise serial monitor at 115200 baud — must match IDE Serial Monitor setting
    Serial.begin(115200);
    while (!Serial) { delay(10); }  // Wait for USB CDC on native-USB boards
    Serial.println();
    Serial.println(F("=== UNIBEN Biodiversity ESP32 Sensor Node ==="));
    Serial.printf("Device ID  : %s\n", DEVICE_ID);
    Serial.printf("WiFi SSID  : %s\n", WIFI_SSID);
    Serial.printf("Target WS  : ws://%s:%u%s\n", SERVER_HOST, SERVER_PORT, WS_PATH);
    Serial.println(F("Baud rate  : 115200 (Serial.begin(115200))"));
    Serial.println();

    // ── Initialise DHT22 ────────────────────────────────────────────────────
    dht.begin();
    Serial.println(F("[SENSOR] DHT22 initialised on GPIO " STR(DHT_PIN)));

    // ── Initialise BMP280 via I2C ───────────────────────────────────────────
    if (!bmp.begin(BMP_I2C_ADDR)) {
        Serial.println(F("[SENSOR] WARNING: BMP280 not found — pressure/altitude will be 0"));
    } else {
        bmp.setSampling(
            Adafruit_BMP280::MODE_NORMAL,
            Adafruit_BMP280::SAMPLING_X2,   // Temperature oversampling
            Adafruit_BMP280::SAMPLING_X16,  // Pressure oversampling
            Adafruit_BMP280::FILTER_X16,    // IIR filter
            Adafruit_BMP280::STANDBY_MS_500
        );
        Serial.println(F("[SENSOR] BMP280 initialised (I2C)"));
    }

    // ── Initialise analogue mic ─────────────────────────────────────────────
    pinMode(MIC_PIN, INPUT);
    Serial.println(F("[SENSOR] Microphone (MAX4466) ready on GPIO " STR(MIC_PIN)));

    // ── Connect to WiFi ─────────────────────────────────────────────────────
    connectWiFi();

    // ── Configure WebSocket client ──────────────────────────────────────────
    wsClient.begin(SERVER_HOST, SERVER_PORT, WS_PATH);
    wsClient.onEvent(wsEventHandler);
    wsClient.setReconnectInterval(RECONNECT_INTERVAL_MS);
    // wsClient.enableHeartbeat(15000, 3000, 2);  // Uncomment for ping/pong keepalive

    Serial.println(F("[WS] WebSocket client configured — awaiting connection…"));
}

// ═══════════════════════════════════════════════════════════════════════════════
// loop()
// ═══════════════════════════════════════════════════════════════════════════════

void loop() {
    wsClient.loop();  // Drive the WebSocket state machine (non-blocking)

    uint32_t now = millis();

    // Transmit a sensor frame every TRANSMIT_INTERVAL_MS
    if (wsConnected && (now - lastTransmitMs >= TRANSMIT_INTERVAL_MS)) {
        lastTransmitMs = now;
        sendTelemetryFrame();
    }

    // If WiFi drops, attempt reconnection
    if (WiFi.status() != WL_CONNECTED) {
        if (now - lastReconnectMs >= RECONNECT_INTERVAL_MS) {
            lastReconnectMs = now;
            Serial.println(F("[WiFi] Connection lost — reconnecting…"));
            connectWiFi();
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// connectWiFi() — blocks until connected or retry limit hit
// ═══════════════════════════════════════════════════════════════════════════════

void connectWiFi() {
    Serial.printf("[WiFi] Connecting to '%s'", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    uint8_t retries = 0;
    while (WiFi.status() != WL_CONNECTED && retries < WIFI_MAX_RETRIES) {
        delay(WIFI_RETRY_DELAY_MS);
        Serial.print('.');
        retries++;
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("[WiFi] Connected. Local IP: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("[WiFi] Signal strength (RSSI): %d dBm\n", WiFi.RSSI());
    } else {
        Serial.println(F("[WiFi] ERROR: Failed to connect — check SSID/password and signal."));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// wsEventHandler() — WebSocket lifecycle events
// ═══════════════════════════════════════════════════════════════════════════════

void wsEventHandler(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
        case WStype_CONNECTED:
            wsConnected = true;
            Serial.printf("[WS] Connected to ws://%s:%u%s\n", SERVER_HOST, SERVER_PORT, WS_PATH);
            break;

        case WStype_DISCONNECTED:
            wsConnected = false;
            Serial.println(F("[WS] Disconnected — will retry…"));
            break;

        case WStype_TEXT: {
            // Server echoes {"ack":"ok","id":<row_id>} or {"ack":"error",...}
            StaticJsonDocument<256> ack;
            DeserializationError err = deserializeJson(ack, payload, length);
            if (!err) {
                const char* ackVal = ack["ack"] | "?";
                int rowId = ack["id"] | -1;
                if (strcmp(ackVal, "ok") == 0) {
                    Serial.printf("[WS] ACK ok — DB row id=%d\n", rowId);
                } else {
                    Serial.printf("[WS] ACK %s — %s\n", ackVal,
                        ack["detail"] | "no detail");
                }
            }
            break;
        }

        case WStype_ERROR:
            Serial.println(F("[WS] Socket error"));
            break;

        default:
            break;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// sendTelemetryFrame() — read all sensors and transmit one JSON frame
// ═══════════════════════════════════════════════════════════════════════════════

void sendTelemetryFrame() {
    // ── Read DHT22 ──────────────────────────────────────────────────────────
    float temperature = dht.readTemperature();   // °C
    float humidity    = dht.readHumidity();      // %

    if (isnan(temperature) || isnan(humidity)) {
        Serial.println(F("[SENSOR] DHT22 read failed — skipping frame"));
        return;
    }

    // ── Read BMP280 ─────────────────────────────────────────────────────────
    float pressure = bmp.readPressure() / 100.0F;  // Pa → hPa
    float altitude = bmp.readAltitude(1013.25F);   // metres above sea level

    // Clamp obviously faulty BMP readings (returns 0 if sensor not found)
    if (pressure < 800.0F || pressure > 1100.0F) pressure = 1013.25F;

    // ── Read light & sound ───────────────────────────────────────────────────
    float lightLux = readLightLux();
    float soundDb  = readSoundDb();

    // ── Build JSON payload matching TelemetryWSPayload schema ────────────────
    StaticJsonDocument<384> doc;
    doc["device_id"]        = DEVICE_ID;
    doc["temperature_c"]    = round(temperature * 100.0F) / 100.0F;
    doc["humidity_percent"] = round(humidity    * 100.0F) / 100.0F;
    doc["pressure_hPa"]     = round(pressure   * 10.0F)  / 10.0F;
    doc["light_lux"]        = round(lightLux);
    doc["sound_db"]         = round(soundDb    * 10.0F)  / 10.0F;
    doc["altitude_m"]       = round(altitude   * 10.0F)  / 10.0F;
    // latitude / longitude omitted — server fetches from browser geolocation
    // doc["latitude"]      = 6.33500;   // Uncomment if GPS module fitted
    // doc["longitude"]     = 5.60370;

    char jsonBuf[384];
    serializeJson(doc, jsonBuf, sizeof(jsonBuf));

    wsClient.sendTXT(jsonBuf);

    Serial.printf("[TX] T=%.1f°C H=%.1f%% P=%.1fhPa L=%.0fLux S=%.1fdB Alt=%.1fm\n",
        temperature, humidity, pressure, lightLux, soundDb, altitude);
}

// ═══════════════════════════════════════════════════════════════════════════════
// readSoundDb() — analogue mic → approximate dB SPL
// ═══════════════════════════════════════════════════════════════════════════════

float readSoundDb() {
    // Sample the ADC 50 times over ~50 ms to approximate RMS amplitude
    const uint8_t SAMPLES = 50;
    long sum = 0;
    int  peak = 0;
    for (uint8_t i = 0; i < SAMPLES; i++) {
        int raw = analogRead(MIC_PIN);  // 0–4095 (12-bit ADC)
        sum += raw;
        if (raw > peak) peak = raw;
        delay(1);
    }
    int avg = sum / SAMPLES;
    int amplitude = peak - avg;         // Remove DC bias
    amplitude = max(amplitude, 1);      // Guard log(0)

    // Linear map: amplitude 1–2048 → dB 30–90
    float db = 30.0F + (float)amplitude / 2048.0F * 60.0F;
    return constrain(db, 30.0F, 90.0F);
}

// ═══════════════════════════════════════════════════════════════════════════════
// readLightLux() — BH1750 I2C or LDR ADC fallback
// ═══════════════════════════════════════════════════════════════════════════════

float readLightLux() {
    // ── Option A: BH1750 digital light sensor (preferred) ───────────────────
    // Uncomment and add `BH1750 lightMeter;` + `lightMeter.begin()` in setup()
    // if (lightMeter.measurementReady()) {
    //     return lightMeter.readLightLevel();
    // }

    // ── Option B: LDR on ADC (fallback) ─────────────────────────────────────
    // Assumes a 10 kΩ LDR in voltage divider with 10 kΩ pull-down to GND.
    // ADC pin = 35 (change as needed).
    const uint8_t LDR_PIN = 35;
    int raw = analogRead(LDR_PIN);          // 0–4095
    // Simple linear map: 0 (dark) → 0 Lux, 4095 (bright) → 100,000 Lux
    float lux = (float)raw / 4095.0F * 100000.0F;
    return lux;
}

// ─── Stringification helper macro ────────────────────────────────────────────
#define STR_HELPER(x) #x
#define STR(x) STR_HELPER(x)
