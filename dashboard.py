"""
Streamlit frontend for the campus biodiversity FastAPI backend.

Run after starting the API server:
    streamlit run dashboard.py

Expected backend:
    http://127.0.0.1:8000
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pandas as pd
import requests
import streamlit as st


API_BASE_URL = "http://127.0.0.1:8000"
REQUEST_TIMEOUT_SECONDS = 10


st.set_page_config(
    page_title="Biodiversity Pipeline Dashboard",
    page_icon="🌿",
    layout="wide",
)


def api_get(path: str, params: Optional[Dict[str, Any]] = None) -> Optional[Any]:
    """Safely call a GET endpoint and return decoded JSON or None."""

    try:
        response = requests.get(
            f"{API_BASE_URL}{path}",
            params=params,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        st.error("Cannot connect to the FastAPI backend. Start it with `uvicorn main:app --reload`.")
    except requests.exceptions.Timeout:
        st.error("The FastAPI backend did not respond before the request timed out.")
    except requests.exceptions.HTTPError as exc:
        detail = _response_detail(exc.response)
        st.error(f"Backend returned an error: {detail}")
    except requests.exceptions.RequestException as exc:
        st.error(f"Request failed: {exc}")
    return None


def api_post_json(path: str, payload: Dict[str, Any]) -> Optional[Any]:
    """Safely POST JSON to the backend and return decoded JSON or None."""

    try:
        response = requests.post(
            f"{API_BASE_URL}{path}",
            json=payload,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        st.error("Cannot connect to the FastAPI backend. Start it with `uvicorn main:app --reload`.")
    except requests.exceptions.Timeout:
        st.error("The FastAPI backend did not respond before the request timed out.")
    except requests.exceptions.HTTPError as exc:
        detail = _response_detail(exc.response)
        st.error(f"Backend returned an error: {detail}")
    except requests.exceptions.RequestException as exc:
        st.error(f"Request failed: {exc}")
    return None


def api_post_file(
    path: str,
    file_name: str,
    file_bytes: bytes,
    content_type: str,
    form_data: Optional[Dict[str, Any]] = None,
) -> Optional[Any]:
    """Safely POST a multipart image upload to the backend."""

    try:
        files = {"file": (file_name, file_bytes, content_type)}
        response = requests.post(
            f"{API_BASE_URL}{path}",
            files=files,
            data=form_data or {},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        st.error("Cannot connect to the FastAPI backend. Start it with `uvicorn main:app --reload`.")
    except requests.exceptions.Timeout:
        st.error("The FastAPI backend did not respond before the request timed out.")
    except requests.exceptions.HTTPError as exc:
        detail = _response_detail(exc.response)
        st.error(f"Backend returned an error: {detail}")
    except requests.exceptions.RequestException as exc:
        st.error(f"Request failed: {exc}")
    return None


def _response_detail(response: Optional[requests.Response]) -> str:
    """Extract a useful error message from a FastAPI error response."""

    if response is None:
        return "unknown backend error"

    try:
        body = response.json()
    except ValueError:
        return response.text or f"HTTP {response.status_code}"

    detail = body.get("detail", body)
    return str(detail)


def render_health_sidebar() -> None:
    """Render backend health status in the sidebar."""

    st.sidebar.header("API Status")
    st.sidebar.caption(API_BASE_URL)

    health = api_get("/health")
    if not health:
        st.sidebar.error("Offline")
        return

    status_text = health.get("status", "unknown")
    if status_text == "ok":
        st.sidebar.success("Online")
    else:
        st.sidebar.warning(f"Degraded: {status_text}")

    st.sidebar.metric("Database", "Available" if health.get("database_available") else "Unavailable")
    st.sidebar.metric("Uploads", "Available" if health.get("upload_dir_available") else "Unavailable")
    st.sidebar.metric("Models", "Loaded" if health.get("models_loaded") else "Unavailable")

    with st.sidebar.expander("Model details", expanded=False):
        model_status = health.get("model_status", {})
        if model_status:
            for model_name, model_state in model_status.items():
                st.write(f"**{model_name}**: {model_state}")
        else:
            st.write("No model status returned.")


def render_sensor_tab() -> None:
    """Render sensor submission form and historical readings table."""

    st.subheader("Submit Sensor Reading")

    with st.form("sensor_reading_form", clear_on_submit=True):
        col_a, col_b = st.columns(2)
        with col_a:
            device_id = st.text_input("Device ID", value="field-unit-001")
            temperature_c = st.number_input("Temperature (C)", value=25.0, step=0.1)
            latitude = st.number_input("Latitude", value=6.5244, format="%.6f")
        with col_b:
            humidity_percent = st.number_input("Humidity (%)", min_value=0.0, max_value=100.0, value=70.0, step=0.1)
            longitude = st.number_input("Longitude", value=3.3792, format="%.6f")
            altitude_m = st.number_input("Altitude (m)", value=0.0, step=0.1)

        notes = st.text_area("Notes", placeholder="Optional field notes")
        submitted = st.form_submit_button("Save Sensor Reading", type="primary")

    if submitted:
        payload = {
            "device_id": device_id,
            "temperature_c": temperature_c,
            "humidity_percent": humidity_percent,
            "latitude": latitude,
            "longitude": longitude,
            "altitude_m": altitude_m,
            "observed_at": datetime.now(timezone.utc).isoformat(),
            "notes": notes or None,
        }
        created = api_post_json("/sensor-readings", payload)
        if created:
            st.success(f"Saved sensor reading #{created['id']}.")

    st.divider()
    st.subheader("Historical Sensor Data")

    readings = api_get("/sensor-readings", params={"limit": 500})
    if readings:
        st.dataframe(pd.DataFrame(readings), use_container_width=True, hide_index=True)
    else:
        st.info("No sensor readings available yet, or the backend is offline.")


def render_drone_tab() -> None:
    """Render drone image upload and classification result view."""

    st.subheader("Upload Drone Image")

    readings = api_get("/sensor-readings", params={"limit": 1000}) or []
    sensor_options = {"No linked sensor reading": None}
    for reading in readings:
        label = (
            f"#{reading['id']} | {reading['device_id']} | "
            f"{reading['latitude']:.5f}, {reading['longitude']:.5f}"
        )
        sensor_options[label] = reading["id"]

    selected_sensor_label = st.selectbox(
        "Optional linked sensor reading",
        options=list(sensor_options.keys()),
    )
    sensor_reading_id = sensor_options[selected_sensor_label]

    uploaded_file = st.file_uploader(
        "Choose a drone image",
        type=["jpg", "jpeg", "png", "tif", "tiff", "webp"],
    )

    if uploaded_file is None:
        st.info("Upload an image to run classification.")
        return

    image_bytes = uploaded_file.getvalue()
    left, right = st.columns([1, 1])

    with left:
        st.image(image_bytes, caption=uploaded_file.name, use_container_width=True)

    with right:
        if st.button("Upload and Classify", type="primary"):
            form_data = {}
            if sensor_reading_id is not None:
                form_data["sensor_reading_id"] = str(sensor_reading_id)

            result = api_post_file(
                "/drone-images",
                file_name=uploaded_file.name,
                file_bytes=image_bytes,
                content_type=uploaded_file.type or "application/octet-stream",
                form_data=form_data,
            )

            if result:
                st.success("Image stored locally by the API.")
                st.metric("Status", result.get("status", "unknown"))
                st.write(f"**Model:** {result.get('model_name')}")
                st.write(f"**Predicted label:** {result.get('predicted_label') or 'N/A'}")

                confidence = result.get("confidence")
                if confidence is None:
                    st.write("**Confidence:** N/A")
                else:
                    st.write(f"**Confidence:** {confidence:.4f}")

                if result.get("error_message"):
                    st.warning(result["error_message"])

                with st.expander("Full API response", expanded=False):
                    st.json(result)


def main() -> None:
    """Application entrypoint."""

    st.title("Campus Biodiversity Pipeline")
    st.caption("Local-first environmental sensor and drone imagery dashboard")

    render_health_sidebar()

    sensor_tab, drone_tab = st.tabs(["Sensor Data", "Drone Imagery"])
    with sensor_tab:
        render_sensor_tab()
    with drone_tab:
        render_drone_tab()


if __name__ == "__main__":
    main()
