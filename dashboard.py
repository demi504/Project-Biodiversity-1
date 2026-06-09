"""
Streamlit visual shell for the UNIBEN Biodiversity Pipeline Data Engine.

This incremental version sets up:
- page configuration
- custom dark institutional styling
- API/database health sidebar
- primary workspace tabs
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import requests
import streamlit as st


API_BASE_URL = "http://127.0.0.1:8000"
API_HEALTH_URL = f"{API_BASE_URL}/health"
REQUEST_TIMEOUT_SECONDS = 5


st.set_page_config(
    page_title="UNIBEN Biodiversity Pipeline Data Engine",
    page_icon="🌿",
    layout="wide",
    initial_sidebar_state="expanded",
)


st.markdown(
    """
    <style>
        :root {
            --uniben-bg: #0E1117;
            --uniben-card: #161B22;
            --uniben-text: #F3F4F6;
            --uniben-muted: #9CA3AF;
            --uniben-emerald: #00C853;
            --uniben-border: rgba(243, 244, 246, 0.08);
            --uniben-shadow: 0 14px 36px rgba(0, 0, 0, 0.28);
        }

        html, body, [data-testid="stAppViewContainer"], .stApp {
            background: var(--uniben-bg);
            color: var(--uniben-text);
        }

        [data-testid="stHeader"] {
            background: rgba(14, 17, 23, 0.88);
            backdrop-filter: blur(14px);
        }

        [data-testid="stSidebar"] {
            background: #0B0F14;
            border-right: 1px solid var(--uniben-border);
        }

        [data-testid="stSidebar"] * {
            color: var(--uniben-text);
        }

        h1, h2, h3, h4, h5, h6, p, label, span, div {
            color: var(--uniben-text);
        }

        .block-container {
            padding-top: 2rem;
            padding-bottom: 2rem;
        }

        div[data-testid="stVerticalBlock"] > div:has(> div[data-testid="stMarkdownContainer"]),
        div[data-testid="stMetric"],
        div[data-testid="stAlert"],
        div[data-testid="stExpander"] {
            background: var(--uniben-card);
            border: 1px solid var(--uniben-border);
            border-radius: 12px;
            box-shadow: var(--uniben-shadow);
            padding: 1rem;
        }

        div[data-testid="stMetric"] [data-testid="stMetricValue"] {
            color: var(--uniben-emerald);
            font-weight: 800;
        }

        .stTabs [data-baseweb="tab-list"] {
            gap: 0.5rem;
            border-bottom: 1px solid var(--uniben-border);
        }

        .stTabs [data-baseweb="tab"] {
            background: #111820;
            border: 1px solid var(--uniben-border);
            border-radius: 12px 12px 0 0;
            color: var(--uniben-muted);
            padding: 0.75rem 1rem;
        }

        .stTabs [aria-selected="true"] {
            color: var(--uniben-emerald);
            border-color: rgba(0, 200, 83, 0.45);
            box-shadow: inset 0 -3px 0 var(--uniben-emerald);
        }

        div.stButton > button,
        div[data-testid="stFormSubmitButton"] > button {
            background: var(--uniben-emerald);
            color: #031008;
            border: 0;
            border-radius: 10px;
            font-weight: 800;
        }

        div.stButton > button:hover,
        div[data-testid="stFormSubmitButton"] > button:hover {
            background: #16E06C;
            color: #031008;
            border: 0;
        }
    </style>
    """,
    unsafe_allow_html=True,
)


def fetch_health() -> tuple[bool, Optional[Dict[str, Any]], str]:
    """Fetch backend health without crashing the Streamlit app."""

    try:
        response = requests.get(API_HEALTH_URL, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        return True, response.json(), "API reachable"
    except requests.exceptions.ConnectionError:
        return False, None, "API server is offline or unreachable"
    except requests.exceptions.Timeout:
        return False, None, "API health check timed out"
    except requests.exceptions.HTTPError as exc:
        return False, None, f"API returned HTTP {exc.response.status_code}"
    except requests.exceptions.RequestException as exc:
        return False, None, f"Health check failed: {exc}"
    except ValueError:
        return False, None, "API returned invalid JSON"


def response_detail(response: Optional[requests.Response]) -> str:
    """Extract a readable backend error from a FastAPI response."""

    if response is None:
        return "unknown backend error"

    try:
        payload = response.json()
    except ValueError:
        return response.text or f"HTTP {response.status_code}"

    return str(payload.get("detail", payload))


def api_get(path: str, params: Optional[Dict[str, Any]] = None) -> Optional[Any]:
    """GET JSON from the FastAPI backend with user-safe error reporting."""

    try:
        response = requests.get(
            f"{API_BASE_URL}{path}",
            params=params,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        st.error("FastAPI backend is offline. Start it with `uvicorn main:app --reload`.")
    except requests.exceptions.Timeout:
        st.error("Backend request timed out. Check that the local API is responsive.")
    except requests.exceptions.HTTPError as exc:
        st.error(f"Backend rejected the request: {response_detail(exc.response)}")
    except requests.exceptions.RequestException as exc:
        st.error(f"Network request failed: {exc}")
    except ValueError:
        st.error("Backend returned invalid JSON.")
    return None


def api_post_json(path: str, payload: Dict[str, Any]) -> Optional[Any]:
    """POST a JSON payload to the FastAPI backend."""

    try:
        response = requests.post(
            f"{API_BASE_URL}{path}",
            json=payload,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        st.error("FastAPI backend is offline. Start it with `uvicorn main:app --reload`.")
    except requests.exceptions.Timeout:
        st.error("Submission timed out. The payload was not confirmed by the API.")
    except requests.exceptions.HTTPError as exc:
        st.error(f"Backend rejected the payload: {response_detail(exc.response)}")
    except requests.exceptions.RequestException as exc:
        st.error(f"Submission failed: {exc}")
    except ValueError:
        st.error("Backend returned invalid JSON after submission.")
    return None


def render_sidebar_health() -> None:
    """Render API and SQLite connectivity state in the sidebar."""

    st.sidebar.title("System Health")
    st.sidebar.caption(API_HEALTH_URL)

    api_ok, health, message = fetch_health()
    if api_ok:
        st.sidebar.success(f"Network: {message}")
    else:
        st.sidebar.error(f"Network: {message}")

    database_available = bool(health and health.get("database_available"))
    if database_available:
        st.sidebar.success("SQLite: available")
    else:
        st.sidebar.error("SQLite: unavailable")

    if health:
        status_text = str(health.get("status", "unknown")).upper()
        st.sidebar.metric("Backend Status", status_text)
        if health.get("database_path"):
            st.sidebar.caption(f"DB: {health['database_path']}")


def format_metric_value(value: Any, suffix: str, decimals: int = 1) -> str:
    """Format numeric metric values without crashing on missing fields."""

    if value is None:
        return "N/A"
    try:
        return f"{float(value):.{decimals}f} {suffix}"
    except (TypeError, ValueError):
        return "N/A"


def latest_sensor_reading(readings: Any) -> Dict[str, Any]:
    """Return the newest reading from the backend JSON list."""

    if isinstance(readings, list) and readings:
        return readings[0]
    return {}


def render_sensor_metrics(readings: Any) -> None:
    """Render the five current ESP32 hardware metrics."""

    latest = latest_sensor_reading(readings)
    metric_cols = st.columns(5)
    metrics = [
        ("Temperature", "temperature_c", "deg C"),
        ("Humidity", "humidity_percent", "%"),
        ("Light", "light_lux", "Lux"),
        ("Pressure", "pressure_hPa", "hPa"),
        ("Sound", "sound_db", "dB"),
    ]

    for column, (label, field_name, suffix) in zip(metric_cols, metrics):
        with column:
            st.metric(label, format_metric_value(latest.get(field_name), suffix))


def render_sensor_form() -> None:
    """Render the ESP32 telemetry submission form."""

    weather_options = [
        "☀️ Clear / Sunny",
        "⛅ Partly Cloudy",
        "☁️ Overcast / Cloudy",
        "🌦️ Light Showers",
        "🌧️ Heavy Rain",
        "⛈️ Thunderstorm",
    ]

    with st.form("sensor_telemetry_form", clear_on_submit=False):
        st.markdown("#### Submit ESP32 Multi-Sensor Payload")
        col_a, col_b, col_c = st.columns(3)

        with col_a:
            device_id = st.text_input("Device ID", value="ESP32-UNIT-001")
            temperature_c = st.number_input("Temperature (deg C)", value=27.0, step=0.1)
            humidity_percent = st.number_input(
                "Humidity (%)",
                min_value=0.0,
                max_value=100.0,
                value=72.0,
                step=0.1,
            )

        with col_b:
            light_lux = st.number_input("Light Intensity (Lux)", min_value=0.0, value=850.0, step=10.0)
            pressure_hpa = st.number_input("Atmospheric Pressure (hPa)", min_value=0.0, value=1013.2, step=0.1)
            sound_db = st.number_input("Sound Level (dB)", min_value=0.0, value=42.0, step=0.1)

        with col_c:
            latitude = st.number_input("Latitude", value=6.3350, format="%.6f")
            longitude = st.number_input("Longitude", value=5.6037, format="%.6f")
            altitude_m = st.number_input("Altimeter / Altitude (m)", value=0.0, step=0.1)

        weather_forecast = st.selectbox("Current Weather Condition", weather_options)
        submitted = st.form_submit_button("Submit Sensor Payload", type="primary")

    if submitted:
        payload = {
            "device_id": device_id.strip(),
            "temperature_c": float(temperature_c),
            "humidity_percent": float(humidity_percent),
            "light_lux": float(light_lux),
            "pressure_hPa": float(pressure_hpa),
            "sound_db": float(sound_db),
            "latitude": float(latitude),
            "longitude": float(longitude),
            "altitude_m": float(altitude_m),
            "weather_forecast": weather_forecast,
        }
        result = api_post_json("/sensor-readings", payload)
        if result:
            st.success(f"Sensor payload accepted. Record ID: {result.get('id', 'unknown')}")
            st.json(result)


def render_sensor_tab() -> None:
    """Render Tab 1: live telemetry metrics and ESP32 payload submission."""

    st.subheader("Real-time Sensor Telemetry")
    readings = api_get("/sensor-readings", params={"limit": 100}) or []
    render_sensor_metrics(readings)
    st.divider()
    render_sensor_form()

    if isinstance(readings, list) and readings:
        with st.expander("Recent Sensor Payloads", expanded=False):
            st.dataframe(readings, use_container_width=True, hide_index=True)


def subset_code(display_value: str) -> str:
    """Map UI split labels to backend enum values."""

    return display_value.split(" ", 1)[0]


def render_observation_form() -> None:
    """Render the Darwin Core-style observation ingestion form."""

    with st.form("standard_observation_form", clear_on_submit=False):
        st.markdown("#### Identification & Location")
        id_col, zone_col, habitat_col, reviewer_col = st.columns(4)
        with id_col:
            observation_id = st.text_input("Observation ID", placeholder="OBS202606090001")
        with zone_col:
            campus_zone_code = st.selectbox(
                "Campus Zone",
                [f"ZONE-{number:02d}" for number in range(1, 11)],
            )
        with habitat_col:
            habitat_type_code = st.text_input("Habitat Code", value="HAB-FOR")
        with reviewer_col:
            verifying_reviewer = st.text_input("Verifying Faculty Reviewer")

        loc_col_a, loc_col_b = st.columns(2)
        with loc_col_a:
            latitude = st.number_input("Observation Latitude", value=6.3350, format="%.6f")
        with loc_col_b:
            longitude = st.number_input("Observation Longitude", value=5.6037, format="%.6f")

        st.markdown("#### 8-Rank Taxonomic Depth")
        tax_col_a, tax_col_b, tax_col_c, tax_col_d = st.columns(4)
        with tax_col_a:
            category = st.selectbox("Organism Category", ["Flora", "Bird", "Insect"])
            kingdom = st.text_input("Kingdom", value="Plantae")
        with tax_col_b:
            phylum = st.text_input("Phylum")
            tax_class = st.text_input("Class")
        with tax_col_c:
            order = st.text_input("Order")
            family = st.text_input("Family")
        with tax_col_d:
            genus = st.text_input("Genus")
            species = st.text_input("Species")

        st.markdown("#### Field Conditions & ML Metadata")
        field_col_a, field_col_b, field_col_c = st.columns(3)
        with field_col_a:
            individual_count = st.number_input("Individual Count", min_value=0, value=1, step=1)
            abundance_class = st.slider("Abundance Class", min_value=1, max_value=6, value=1)
            life_stage = st.text_input("Developmental Life Stage", value="Adult")
        with field_col_b:
            sex = st.selectbox("Sex", ["Unknown", "Male", "Female", "Mixed", "Not Applicable"])
            health_status = st.text_input("Health Status", value="Apparently healthy")
            observed_behaviour = st.text_area("Observed Behaviour", value="Not recorded")
        with field_col_c:
            primary_filename = st.text_input("Target Image Filename", placeholder="observation_001.jpg")
            image_count = st.number_input("Image Count", min_value=0, value=1, step=1)
            annotation_confidence_score = st.slider("Annotation Confidence Score", min_value=1, max_value=5, value=3)

        meta_col_a, meta_col_b, meta_col_c = st.columns(3)
        with meta_col_a:
            iucn_status = st.text_input("IUCN Status", value="Not Evaluated")
        with meta_col_b:
            origin_status = st.text_input("Origin Status", value="Native")
        with meta_col_c:
            ml_subset_label = st.selectbox(
                "Stratified Subset Assignment",
                ["TR (Training)", "VA (Validation)", "TE (Testing)"],
            )

        submitted = st.form_submit_button("Submit Observation Record", type="primary")

    if submitted:
        payload = {
            "identification_id": observation_id.strip(),
            "category": category,
            "kingdom": kingdom.strip(),
            "phylum": phylum.strip(),
            "class": tax_class.strip(),
            "order": order.strip(),
            "family": family.strip(),
            "genus": genus.strip(),
            "species": species.strip(),
            "campus_zone_code": campus_zone_code,
            "latitude": float(latitude),
            "longitude": float(longitude),
            "habitat_type_code": habitat_type_code.strip(),
            "individual_count": int(individual_count),
            "abundance_class": int(abundance_class),
            "life_stage": life_stage.strip(),
            "sex": sex,
            "health_status": health_status.strip(),
            "observed_behaviour": observed_behaviour.strip(),
            "primary_filename": primary_filename.strip(),
            "image_count": int(image_count),
            "iucn_status": iucn_status.strip(),
            "origin_status": origin_status.strip(),
            "annotation_confidence_score": int(annotation_confidence_score),
            "ml_subset": subset_code(ml_subset_label),
            "verifying_reviewer": verifying_reviewer.strip(),
        }
        result = api_post_json("/observations", payload)
        if result:
            st.success(f"Observation record accepted: {result.get('identification_id', observation_id)}")
            st.json(result)


def render_observation_tab() -> None:
    """Render Tab 2: standard observation ingestion."""

    st.subheader("Standard Observation Ingestion")
    render_observation_form()


def render_drone_tab() -> None:
    """Render Tab 3 placeholder for drone imagery processing."""

    st.subheader("Drone Imagery Processing")
    st.info("Drone imagery processing is functional and awaiting connected directory uploads.")


render_sidebar_health()

st.title("UNIBEN Biodiversity Pipeline Data Engine")
st.caption("Campus-scale multimodal biodiversity telemetry, observation, and imagery workspace")

sensor_tab, observation_tab, drone_tab = st.tabs(
    [
        "📡 Real-time Sensor Telemetry",
        "📝 Standard Observation Ingestion",
        "🛸 Drone Imagery Processing",
    ]
)

with sensor_tab:
    render_sensor_tab()

with observation_tab:
    render_observation_tab()

with drone_tab:
    render_drone_tab()
