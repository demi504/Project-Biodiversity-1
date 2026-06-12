"""
pipeline_analytics.py — Automated Data Science Layer
=====================================================
UNIBEN Biodiversity Pipeline · Root Module

Provides two independently callable systems:

  1. DataCleaner         — rolling Z-score outlier detection + forward-fill
                           interpolation on any sensor_readings DataFrame.
  2. AnalyticsEngine     — scheduled background worker that queries
                           data/biodiversity.db, calculates daily summary
                           statistics, and writes two high-fidelity Matplotlib /
                           Seaborn visualisations to frontend/public/analytics/.

Usage
-----
    # One-shot run from CLI:
    python pipeline_analytics.py

    # Import into FastAPI lifespan for background scheduling:
    from pipeline_analytics import AnalyticsEngine
    engine = AnalyticsEngine(db_path="data/biodiversity.db",
                             output_dir="frontend/public/analytics")
    engine.run_once()   # synchronous single-pass
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Dependency guard
# ---------------------------------------------------------------------------

try:
    import numpy as np
    _HAS_NUMPY = True
except ImportError as _np_err:
    _HAS_NUMPY = False
    _NP_ERR = _np_err

try:
    import pandas as pd
    _HAS_PANDAS = True
except ImportError as _pd_err:
    _HAS_PANDAS = False
    _PD_ERR = _pd_err

try:
    import matplotlib
    matplotlib.use("Agg")          # non-interactive backend — safe in threads
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    import seaborn as sns
    _HAS_PLOT = True
except ImportError as _plt_err:
    _HAS_PLOT = False
    _PLT_ERR = _plt_err

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("pipeline_analytics")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SENSOR_FIELDS: List[str] = [
    "temperature_c",
    "humidity_percent",
    "pressure_hPa",
    "light_lux",
    "sound_db",
]

FIELD_LABELS: Dict[str, str] = {
    "temperature_c":    "Temperature (°C)",
    "humidity_percent": "Humidity (%)",
    "pressure_hPa":     "Pressure (hPa)",
    "light_lux":        "Light (Lux)",
    "sound_db":         "Sound (dB)",
}

# Physical plausibility bounds for outlier clamping (used as fallback)
FIELD_BOUNDS: Dict[str, Tuple[float, float]] = {
    "temperature_c":    (-40.0,  85.0),
    "humidity_percent": (  0.0, 100.0),
    "pressure_hPa":     (800.0, 1100.0),
    "light_lux":        (  0.0, 150_000.0),
    "sound_db":         (  0.0,  140.0),
}

# Z-score threshold: readings more than ±3σ from the rolling mean are flagged
Z_SCORE_LIMIT = 3.0

# Rolling window for local mean/std estimation (in number of rows)
ROLLING_WINDOW = 10

# Default scheduling interval between analytics runs (seconds)
DEFAULT_INTERVAL_SECONDS = 300   # 5 minutes


# ===========================================================================
# 1. DATA CLEANING LAYER
# ===========================================================================

class DataCleaner:
    """
    Validates and cleans a sensor_readings DataFrame in-place.

    Algorithm
    ---------
    For each of the five environmental parameter columns:

    Step 1 — Null Imputation
        Replace NaN values with the column's forward-fill value. If the
        entire column is null (edge case), fall back to the column midpoint
        of the physical bounds range.

    Step 2 — Rolling Z-score outlier detection
        Compute a rolling mean μ and rolling standard deviation σ over
        ROLLING_WINDOW rows.  Any value where |z| = |(x − μ) / σ| > Z_SCORE_LIMIT
        is marked as an anomaly.

    Step 3 — Linear interpolation correction
        Anomalous values are set to NaN, then interpolated linearly across
        time using pandas interpolate(method='time').  Boundary NaNs (at the
        head/tail where no interpolation anchor exists) are forward-filled
        and then back-filled.

    Step 4 — Physical bound clamping
        All values are finally clamped to FIELD_BOUNDS to guarantee
        physical plausibility regardless of interpolation drift.

    Parameters
    ----------
    df : pd.DataFrame
        Must contain an 'observed_at' column parseable as datetime and
        all five sensor field columns (missing columns are skipped).

    Returns
    -------
    pd.DataFrame
        Cleaned copy of the input DataFrame (original is not mutated).
    dict
        Cleaning report: {field: {"nulls_filled": int, "outliers_corrected": int}}
    """

    def clean(
        self,
        df: "pd.DataFrame",
    ) -> Tuple["pd.DataFrame", Dict[str, Dict[str, int]]]:
        if not _HAS_NUMPY or not _HAS_PANDAS:
            raise ImportError("numpy and pandas are required for DataCleaner.")

        df = df.copy()
        report: Dict[str, Dict[str, int]] = {}

        # Ensure observed_at is a proper datetime index for time-interpolation
        if "observed_at" in df.columns:
            df["observed_at"] = pd.to_datetime(df["observed_at"], utc=True, errors="coerce")
            df = df.set_index("observed_at").sort_index()

        for field in SENSOR_FIELDS:
            if field not in df.columns:
                continue

            series = df[field].astype(float)
            nulls_before = int(series.isna().sum())

            # --- Step 1: null imputation -----------------------------------------
            if series.isna().all():
                lo, hi = FIELD_BOUNDS[field]
                series = series.fillna((lo + hi) / 2.0)
            else:
                series = series.ffill().bfill()

            # --- Step 2: rolling Z-score detection ----------------------------------
            window   = min(ROLLING_WINDOW, max(3, len(series) // 5))
            roll_mu  = series.rolling(window=window, center=True, min_periods=1).mean()
            roll_std = series.rolling(window=window, center=True, min_periods=1).std(ddof=0)

            # Avoid division by zero on constant signals
            roll_std = roll_std.replace(0.0, np.nan).fillna(1e-9)

            z_scores      = (series - roll_mu).abs() / roll_std
            anomaly_mask  = z_scores > Z_SCORE_LIMIT
            outliers_count = int(anomaly_mask.sum())

            # --- Step 3: linear interpolation correction ----------------------------
            series[anomaly_mask] = np.nan
            series = series.interpolate(method="time" if isinstance(series.index, pd.DatetimeIndex)
                                        else "linear")
            series = series.ffill().bfill()

            # --- Step 4: physical bound clamping ------------------------------------
            lo, hi  = FIELD_BOUNDS[field]
            series  = series.clip(lower=lo, upper=hi)

            df[field] = series
            report[field] = {
                "nulls_filled":        nulls_before,
                "outliers_corrected":  outliers_count,
            }

        # Restore observed_at as a regular column
        if df.index.name == "observed_at":
            df = df.reset_index()

        log.info(
            "DataCleaner: %s",
            "; ".join(
                f"{f}→nulls={v['nulls_filled']}, outliers={v['outliers_corrected']}"
                for f, v in report.items()
            ),
        )
        return df, report


# ===========================================================================
# 2. ANALYTICS ENGINE
# ===========================================================================

class AnalyticsEngine:
    """
    Background analytics worker.

    On each cycle it:
      1. Queries the full sensor_readings history from SQLite.
      2. Runs DataCleaner on the raw data.
      3. Calculates daily summary statistics (mean, std, min, max).
      4. Generates and saves two publication-quality visualisations:
           - sensor_correlations.png  : Seaborn heatmap of 5-field correlations.
           - biodiversity_density.png : Distribution plot of taxonomy encounters.
      5. Logs the daily stats table to stdout.

    Parameters
    ----------
    db_path    : Path to data/biodiversity.db
    output_dir : Directory where PNG files are written (must exist or will be created)
    interval_s : Seconds between automatic re-runs when start() is called.
    """

    def __init__(
        self,
        db_path:    str | Path = Path("data/biodiversity.db"),
        output_dir: str | Path = Path("frontend/public/analytics"),
        interval_s: int        = DEFAULT_INTERVAL_SECONDS,
    ) -> None:
        self.db_path    = Path(db_path)
        self.output_dir = Path(output_dir)
        self.interval_s = interval_s
        self._cleaner   = DataCleaner()
        self._thread: Optional[threading.Thread] = None
        self._stop      = threading.Event()

        self.output_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run_once(self) -> Dict:
        """Execute a single full analytics cycle. Returns summary dict."""
        log.info("AnalyticsEngine: starting analytics cycle.")

        df_raw = self._load_sensor_readings()
        if df_raw.empty:
            log.warning("AnalyticsEngine: no sensor data in DB — skipping plots.")
            return {"status": "no_data"}

        df, clean_report = self._cleaner.clean(df_raw)
        daily_stats      = self._compute_daily_stats(df)
        corr_path        = self._plot_correlation_heatmap(df)
        dens_path        = self._plot_biodiversity_density(df)

        log.info("AnalyticsEngine: cycle complete. corr=%s dens=%s", corr_path, dens_path)
        return {
            "status":        "ok",
            "rows_processed": len(df),
            "clean_report":  clean_report,
            "daily_stats":   daily_stats,
            "plots": {
                "sensor_correlations":  str(corr_path),
                "biodiversity_density": str(dens_path),
            },
        }

    def start(self) -> None:
        """Start the background scheduling thread."""
        if self._thread and self._thread.is_alive():
            log.warning("AnalyticsEngine: already running.")
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, daemon=True, name="analytics-engine"
        )
        self._thread.start()
        log.info("AnalyticsEngine: background thread started (interval=%ds).", self.interval_s)

    def stop(self) -> None:
        """Signal the background thread to stop after its current cycle."""
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=10)
        log.info("AnalyticsEngine: background thread stopped.")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.run_once()
            except Exception as exc:
                log.exception("AnalyticsEngine: unhandled error in cycle: %s", exc)
            self._stop.wait(timeout=self.interval_s)

    def _load_sensor_readings(self) -> "pd.DataFrame":
        """Load all rows from sensor_readings into a DataFrame."""
        if not self.db_path.exists():
            return pd.DataFrame()

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """
                SELECT
                    id, device_id,
                    temperature_c, humidity_percent,
                    pressure_hPa,  light_lux, sound_db,
                    observed_at, received_at, notes
                FROM sensor_readings
                ORDER BY observed_at ASC
                """
            ).fetchall()
        finally:
            conn.close()

        if not rows:
            return pd.DataFrame()

        df = pd.DataFrame([dict(r) for r in rows])
        df["observed_at"] = pd.to_datetime(df["observed_at"], utc=True, errors="coerce")
        df["received_at"] = pd.to_datetime(df["received_at"], utc=True, errors="coerce")
        return df

    def _compute_daily_stats(self, df: "pd.DataFrame") -> Dict:
        """
        Calculate per-day mean, std, min, max for each sensor field.
        Returns a nested dict: {field: {date: {mean, std, min, max}}}
        """
        if "observed_at" not in df.columns:
            return {}

        df_work = df.copy()
        df_work["date"] = pd.to_datetime(df_work["observed_at"]).dt.date

        stats_out: Dict = {}
        for field in SENSOR_FIELDS:
            if field not in df_work.columns:
                continue
            grp = df_work.groupby("date")[field].agg(["mean", "std", "min", "max"])
            # Fill std NaN (single-row days)
            grp["std"] = grp["std"].fillna(0.0)
            stats_out[field] = {
                str(date): {
                    "mean": round(float(row["mean"]), 4),
                    "std":  round(float(row["std"]),  4),
                    "min":  round(float(row["min"]),  4),
                    "max":  round(float(row["max"]),  4),
                }
                for date, row in grp.iterrows()
            }
            log.info(
                "Daily stats [%s] → %d days | overall mean=%.3f",
                field, len(grp), df_work[field].mean(),
            )

        return stats_out

    # ------------------------------------------------------------------
    # Visualisation 1: Sensor Correlation Heatmap
    # ------------------------------------------------------------------

    def _plot_correlation_heatmap(self, df: "pd.DataFrame") -> Path:
        """
        Generate a Seaborn heatmap of Pearson correlation coefficients
        between the five environmental sensor fields.

        Saved to: frontend/public/analytics/sensor_correlations.png
        """
        if not _HAS_PLOT:
            log.error("matplotlib/seaborn unavailable — cannot plot heatmap: %s", _PLT_ERR)
            return self.output_dir / "sensor_correlations.png"

        out_path = self.output_dir / "sensor_correlations.png"

        # Select numeric sensor columns that actually exist in the dataframe
        available = [f for f in SENSOR_FIELDS if f in df.columns]
        if len(available) < 2:
            log.warning("Not enough sensor columns for correlation — skipping heatmap.")
            return out_path

        corr = df[available].corr(method="pearson")
        labels = [FIELD_LABELS.get(f, f) for f in available]

        fig, ax = plt.subplots(figsize=(9, 7))
        fig.patch.set_facecolor("#0B0F19")
        ax.set_facecolor("#111823")

        mask = np.triu(np.ones_like(corr, dtype=bool), k=1)  # hide upper triangle

        sns.heatmap(
            corr,
            mask=~mask & np.eye(len(corr), dtype=bool) == False,   # noqa: E712
            annot=True,
            fmt=".2f",
            cmap=sns.diverging_palette(145, 300, s=85, l=45, n=256),
            vmin=-1.0,
            vmax=1.0,
            linewidths=0.5,
            linecolor="#1a2234",
            square=True,
            ax=ax,
            cbar_kws={"shrink": 0.82, "pad": 0.02},
            xticklabels=labels,
            yticklabels=labels,
            annot_kws={"size": 10, "color": "white"},
        )

        # Style tweaks for dark theme
        ax.tick_params(colors="#9CA3AF", labelsize=9)
        ax.set_title(
            "UNIBEN Biodiversity · 5-Parameter Sensor Correlation Matrix",
            color="#34D399", fontsize=12, fontweight="bold", pad=14,
        )

        cbar = ax.collections[0].colorbar
        cbar.ax.yaxis.set_tick_params(color="#9CA3AF", labelsize=8)
        plt.setp(cbar.ax.yaxis.get_ticklabels(), color="#9CA3AF")
        cbar.set_label("Pearson r", color="#9CA3AF", fontsize=9)

        plt.tight_layout(pad=1.4)
        fig.savefig(out_path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)

        log.info("Saved correlation heatmap → %s", out_path)
        return out_path

    # ------------------------------------------------------------------
    # Visualisation 2: Biodiversity Density Distribution
    # ------------------------------------------------------------------

    def _plot_biodiversity_density(self, df: "pd.DataFrame") -> Path:
        """
        Generate a multi-panel distribution/density plot showing:
          - KDE + histogram distributions for each of the 5 sensor parameters.
          - A time-series readings-per-day bar chart (taxonomy encounter density).

        Saved to: frontend/public/analytics/biodiversity_density.png
        """
        if not _HAS_PLOT:
            log.error("matplotlib/seaborn unavailable — cannot plot density: %s", _PLT_ERR)
            return self.output_dir / "biodiversity_density.png"

        out_path  = self.output_dir / "biodiversity_density.png"
        available = [f for f in SENSOR_FIELDS if f in df.columns]

        n_fields = len(available)
        n_cols   = 3
        n_rows   = (n_fields + 1 + n_cols - 1) // n_cols   # +1 for timeline bar

        fig, axes = plt.subplots(
            n_rows, n_cols,
            figsize=(n_cols * 4.5, n_rows * 3.6),
        )
        fig.patch.set_facecolor("#0B0F19")
        axes_flat = axes.flatten() if hasattr(axes, "flatten") else [axes]

        palette_colors = ["#34D399", "#38bdf8", "#a78bfa", "#facc15", "#f97316"]

        # --- KDE + histogram panels for each sensor field ---
        for idx, field in enumerate(available):
            ax   = axes_flat[idx]
            col  = palette_colors[idx % len(palette_colors)]
            vals = df[field].dropna()
            ax.set_facecolor("#111823")

            if len(vals) >= 2:
                sns.histplot(
                    vals,
                    ax=ax,
                    kde=True,
                    color=col,
                    alpha=0.55,
                    edgecolor="#0B0F19",
                    line_kws={"linewidth": 2},
                )
            else:
                ax.bar([vals.mean() if len(vals) else 0], [1], color=col, alpha=0.6)

            label = FIELD_LABELS.get(field, field)
            ax.set_title(label, color=col, fontsize=10, fontweight="bold")
            ax.set_xlabel("Value", color="#9CA3AF", fontsize=8)
            ax.set_ylabel("Count", color="#9CA3AF", fontsize=8)
            ax.tick_params(colors="#6B7280", labelsize=7)
            ax.spines[:].set_edgecolor("#1e2a3a")
            for spine in ax.spines.values():
                spine.set_linewidth(0.5)

        # --- Taxonomy encounter density over time (readings per day) ---
        timeline_ax = axes_flat[n_fields]
        timeline_ax.set_facecolor("#111823")

        if "observed_at" in df.columns:
            df_time = df.copy()
            df_time["date"] = pd.to_datetime(df_time["observed_at"]).dt.date
            counts = df_time.groupby("date").size().reset_index(name="count")

            dates  = pd.to_datetime(counts["date"])
            cnts   = counts["count"].values

            bars = timeline_ax.bar(
                dates, cnts,
                color="#34D399", alpha=0.75, edgecolor="#064E3B", linewidth=0.5,
                width=0.8,
            )
            # Add gradient-like colour intensity by height
            max_c = max(cnts) if len(cnts) else 1
            for bar, c in zip(bars, cnts):
                alpha = 0.4 + 0.6 * (c / max_c)
                bar.set_alpha(alpha)

            timeline_ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
            timeline_ax.xaxis.set_major_locator(mdates.AutoDateLocator())
            plt.setp(timeline_ax.xaxis.get_majorticklabels(),
                     rotation=35, ha="right", fontsize=7, color="#9CA3AF")
        else:
            timeline_ax.text(
                0.5, 0.5, "No timestamp data",
                ha="center", va="center", color="#6B7280",
                transform=timeline_ax.transAxes,
            )

        timeline_ax.set_title(
            "Observation Density Over Time",
            color="#34D399", fontsize=10, fontweight="bold",
        )
        timeline_ax.set_xlabel("Date",  color="#9CA3AF", fontsize=8)
        timeline_ax.set_ylabel("Count", color="#9CA3AF", fontsize=8)
        timeline_ax.tick_params(colors="#6B7280", labelsize=7)
        timeline_ax.spines[:].set_edgecolor("#1e2a3a")

        # --- Hide any leftover empty axes ---
        for idx in range(n_fields + 1, len(axes_flat)):
            axes_flat[idx].set_visible(False)

        fig.suptitle(
            "UNIBEN Biodiversity Pipeline · Sensor Distribution & Encounter Analysis",
            color="#34D399", fontsize=13, fontweight="bold", y=1.01,
        )

        plt.tight_layout(pad=1.8)
        fig.savefig(out_path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)

        log.info("Saved biodiversity density plot → %s", out_path)
        return out_path


# ===========================================================================
# CLI entry point
# ===========================================================================

if __name__ == "__main__":
    import json
    engine = AnalyticsEngine(
        db_path="data/biodiversity.db",
        output_dir="frontend/public/analytics",
    )
    result = engine.run_once()
    print(json.dumps(result, indent=2, default=str))
