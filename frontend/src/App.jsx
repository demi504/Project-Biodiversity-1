/**
 * UNIBEN Biodiversity Pipeline — v7 Refactor
 *
 * Dual Telemetry Ingestion + Ground Photography AI Pipeline
 *
 * Tab 1 — Sensor Telemetry
 *   Toggle: Live WebSocket Stream (/ws/telemetry) | Offline MicroSD CSV Ingestion (/api/telemetry/upload-csv)
 *   Live mode: 6-gauge metric cards + sparklines + telemetry history table
 *   CSV mode: drag-and-drop field log, statistical summary, ingested records table
 *
 * Tab 2 — Ground Field Photo AI Ingestion
 *   Upload JPG/PNG · select focal zone · POST /api/ground-image/scan
 *   Returns: taxa/vegetation class · confidence · Excess Green Index (ExG) · ±5 min telemetry match
 *
 * Tab 3 — Fused Multi-Modal Records
 *   GET /api/ground-image/records — historical ground + telemetry fusion table
 *   Pipeline engine trigger + Excel/CSV export
 *
 * Parameters streamed from ESP32:
 *   Temperature (°C) · Humidity (%) · Pressure (hPa) · Light (Lux) · Sound (dB) · Altitude (m)
 *
 * 3-Zone spatial segmentation (UNIBEN Ugbowo campus):
 *   ZONE_A — Dense Canopy / Forested Sector
 *   ZONE_B — Mixed Urban / Shrub Perimeter
 *   ZONE_C — Open Ground / Bare Soil
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Thermometer, Droplets, Gauge, Sun, Volume2, Mountain,
  Activity, RefreshCw, CheckCircle2, XCircle,
  Wifi, WifiOff, Cpu, Database, UploadCloud,
  BarChart2, Zap, ChevronRight, Download,
  Camera, Leaf, HardDrive, MapPin, AlertTriangle,
  ScanSearch, TableProperties, FileText, FlaskConical,
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, Tooltip } from 'recharts';

/* ─────────────────────────────────────────────────────────────────────────── */
const API     = 'http://127.0.0.1:8000';
const WS_URL  = 'ws://127.0.0.1:8000/ws/telemetry';
const POLL_MS = 2500;

/* ── Focal Zone definitions ──────────────────────────────────────────────── */
const FOCAL_ZONES = [
  { id: 'ZONE_A', label: 'ZONE A — Dense Canopy / Forested Sector',  color: '#10B981', bg: 'bg-emerald-900/30', text: 'text-emerald-300', border: 'border-emerald-600/40' },
  { id: 'ZONE_B', label: 'ZONE B — Mixed Urban / Shrub Perimeter',   color: '#F59E0B', bg: 'bg-amber-900/30',   text: 'text-amber-300',   border: 'border-amber-600/40'   },
  { id: 'ZONE_C', label: 'ZONE C — Open Ground / Bare Soil',         color: '#EF4444', bg: 'bg-red-900/30',     text: 'text-red-300',     border: 'border-red-600/40'     },
];

/* ── Framer-motion variants ─────────────────────────────────────────────── */
const panelV = {
  hidden:  { opacity: 0, y: 18, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 200, damping: 22 } },
};
const stagger = { visible: { transition: { staggerChildren: 0.06 } } };

/* ── Tab definitions ────────────────────────────────────────────────────── */
const TABS = [
  { id: 'telemetry', label: 'Sensor Telemetry',            icon: Activity  },
  { id: 'ground',    label: 'Ground Field Photo AI',        icon: Camera    },
  { id: 'fused',     label: 'Fused Multi-Modal Records',    icon: Database  },
];

/* ── Metric definitions — 6 parameters ─────────────────────────────────── */
const METRICS = [
  { key: 'temperature_c',    label: 'Temperature',  unit: '°C',   Icon: Thermometer, color: '#f97316' },
  { key: 'humidity_percent', label: 'Humidity',     unit: '%',    Icon: Droplets,    color: '#38bdf8' },
  { key: 'pressure_hPa',     label: 'Pressure',     unit: ' hPa', Icon: Gauge,       color: '#a78bfa' },
  { key: 'light_lux',        label: 'Illuminance',  unit: ' Lux', Icon: Sun,         color: '#fbbf24' },
  { key: 'sound_db',         label: 'Sound',        unit: ' dB',  Icon: Volume2,     color: '#34d399' },
  { key: 'altitude_m',       label: 'Altitude',     unit: ' m',   Icon: Mountain,    color: '#2dd4bf' },
];

/* ── ENV_PARAMS — reusable for telemetry snapshot cards ─────────────────── */
const ENV_PARAMS = [
  { key: 'temperature_c',    label: 'Temp',        unit: '°C',   color: '#f97316', Icon: Thermometer },
  { key: 'humidity_percent', label: 'Humidity',    unit: '%',    color: '#38bdf8', Icon: Droplets    },
  { key: 'pressure_hPa',     label: 'Pressure',    unit: ' hPa', color: '#a78bfa', Icon: Gauge       },
  { key: 'light_lux',        label: 'Illuminance', unit: ' Lux', color: '#fbbf24', Icon: Sun         },
  { key: 'sound_db',         label: 'Sound',       unit: ' dB',  color: '#34d399', Icon: Volume2     },
  { key: 'altitude_m',       label: 'Altitude',    unit: ' m',   color: '#2dd4bf', Icon: Mountain    },
];

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Shared helper components                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function SparkTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass px-2 py-1 text-[10px] font-grotesk text-emerald-300">
      {Number(payload[0].value).toFixed(2)}
    </div>
  );
}

const MetricCard = memo(function MetricCard({ metric, value, history }) {
  const { label, unit, Icon, color } = metric;
  const display = value != null ? Number(value).toFixed(2) : '—';
  return (
    <motion.div
      variants={panelV}
      className="glass p-4 flex flex-col gap-2"
      whileHover={{ scale: 1.025, boxShadow: `0 0 22px ${color}33` }}
      style={{ transition: 'all 0.35s cubic-bezier(0.4,0,0.2,1)' }}
    >
      <div className="flex items-center justify-between">
        <span className="font-jakarta text-[10px] uppercase tracking-widest text-gray-500">{label}</span>
        <Icon size={13} style={{ color }} />
      </div>
      <div className="font-grotesk text-2xl font-bold" style={{ color }}>
        {display}<span className="text-[11px] text-gray-600 ml-1">{unit}</span>
      </div>
      <div style={{ height: 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history}>
            <Tooltip content={<SparkTip />} />
            <Line type="monotone" dataKey="value" dot={false} strokeWidth={1.5} stroke={color} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
});

function FocalZoneBadge({ zoneId }) {
  const z = FOCAL_ZONES.find(f => f.id === zoneId) ?? { id: zoneId, label: zoneId, bg: 'bg-gray-800', text: 'text-gray-400', border: 'border-gray-700', color: '#6B7280' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-jakarta font-semibold border ${z.bg} ${z.text} ${z.border}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: z.color }} />
      {z.label}
    </span>
  );
}

function SourceBadge({ source }) {
  const s = source || 'LIVE_ESP32';
  const cfg = {
    LIVE_ESP32:    { cls: 'bg-emerald-900/30 text-emerald-400', label: 'ESP32'   },
    ESP32_SD_CARD: { cls: 'bg-sky-900/30 text-sky-400',         label: 'SD CARD' },
    ESP32_CSV:     { cls: 'bg-amber-900/30 text-amber-400',     label: 'CSV'     },
  }[s] ?? { cls: 'bg-gray-800 text-gray-400', label: s };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function Pill({ ok, label }) {
  return (
    <div className="flex items-center gap-1.5">
      {ok
        ? <CheckCircle2 size={10} className="text-emerald-400" />
        : <XCircle     size={10} className="text-red-500"     />}
      <span className={`font-jakarta text-[10px] ${ok ? 'text-emerald-400' : 'text-red-500'}`}>{label}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  useDragDrop hook                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

function useDragDrop(onFile) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef(null);
  const onDragOver  = e => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop      = useCallback(e => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  }, [onFile]);
  const onInput = useCallback(e => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  }, [onFile]);
  return { ref, dragging, onDragOver, onDragLeave, onDrop, onInput };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Analytics Panel (auto-refreshing Matplotlib PNGs)                         */
/* ─────────────────────────────────────────────────────────────────────────── */

function useCacheBust(ms = 300_000) {
  const [bust, setBust] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setBust(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return bust;
}

const ANALYTICS_PLOTS = [
  { src: '/analytics/sensor_correlations.png',  title: '6-Parameter Sensor Correlation Matrix',   desc: 'Pearson coefficients · auto-refresh 5 min'     },
  { src: '/analytics/biodiversity_density.png',  title: 'Biodiversity Encounter Density',          desc: 'KDE distribution + observation frequency'      },
];

const AnalyticsPlotCard = memo(function AnalyticsPlotCard({ src, title, desc, bust }) {
  const [loaded,  setLoaded]  = useState(false);
  const [errored, setErrored] = useState(false);
  useEffect(() => { setLoaded(false); setErrored(false); }, [src, bust]);
  return (
    <motion.div variants={panelV} className="glass p-4 flex flex-col gap-3"
      whileHover={{ scale: 1.008, boxShadow: '0 0 24px rgba(52,211,153,0.15)' }}
    >
      <div className="flex items-start gap-2">
        <BarChart2 size={12} className="text-emerald-400 mt-0.5 shrink-0" />
        <div>
          <p className="font-jakarta text-[11px] font-semibold text-emerald-300">{title}</p>
          <p className="font-grotesk text-[9px] text-gray-600 mt-0.5">{desc}</p>
        </div>
      </div>
      <div className="relative rounded-xl overflow-hidden bg-[#0B0F19] border border-emerald-900/20" style={{ minHeight: 160 }}>
        {!loaded && !errored && (
          <div className="absolute inset-0 flex items-center justify-center">
            <RefreshCw size={16} className="text-emerald-800 animate-spin" />
          </div>
        )}
        {errored ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <BarChart2 size={20} className="text-emerald-900" />
            <p className="font-jakarta text-[10px] text-gray-700 text-center px-4">
              Plot appears after first analytics cycle (≤5 min).
            </p>
          </div>
        ) : (
          <img
            src={`${src}?v=${bust}`} alt={title}
            onLoad={() => setLoaded(true)} onError={() => setErrored(true)}
            className="w-full rounded-xl transition-opacity duration-500"
            style={{ opacity: loaded ? 1 : 0 }}
          />
        )}
      </div>
    </motion.div>
  );
});

function AnalyticsPanel() {
  const bust = useCacheBust();
  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-2">
      <motion.div variants={panelV} className="flex items-center gap-2">
        <BarChart2 size={11} className="text-emerald-500" />
        <span className="font-jakarta text-[9px] text-gray-600 uppercase tracking-widest">
          Data Insights · Matplotlib / Seaborn · auto-refresh 5 min
        </span>
      </motion.div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {ANALYTICS_PLOTS.map(p => <AnalyticsPlotCard key={p.src} {...p} bust={bust} />)}
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  CSV Ingestion Panel — sub-mode of Tab 1                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function CSVIngestionPanel({ onIngestComplete }) {
  const [csvFile,   setCsvFile]   = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState('');
  const [dragging,  setDragging]  = useState(false);
  const inputRef = useRef(null);

  const handleFile = useCallback(file => {
    setCsvFile(file); setResult(null); setError('');
  }, []);

  const onDragOver  = e => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop      = useCallback(e => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const upload = useCallback(async () => {
    if (!csvFile) return;
    setUploading(true); setError(''); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', csvFile);
      const res = await fetch(`${API}/api/telemetry/upload-csv`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
      const data = await res.json();
      setResult(data);
      onIngestComplete?.();
    } catch (err) { setError(err.message); }
    finally { setUploading(false); }
  }, [csvFile, onIngestComplete]);

  const STAT_METRICS = [
    { key: 'temperature_c',    label: 'Temperature', unit: '°C',   color: '#f97316' },
    { key: 'humidity_percent', label: 'Humidity',    unit: '%',    color: '#38bdf8' },
    { key: 'pressure_hPa',     label: 'Pressure',    unit: ' hPa', color: '#a78bfa' },
    { key: 'light_lux',        label: 'Illuminance', unit: ' Lux', color: '#fbbf24' },
    { key: 'sound_db',         label: 'Sound',       unit: ' dB',  color: '#34d399' },
    { key: 'altitude_m',       label: 'Altitude',    unit: ' m',   color: '#2dd4bf' },
  ];

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-4">

      {/* Header banner */}
      <motion.div variants={panelV} className="glass p-4 flex items-center gap-3"
        style={{ border: '1px solid rgba(245,158,11,0.25)' }}
      >
        <HardDrive size={16} className="text-amber-400 shrink-0" />
        <div className="flex-1">
          <p className="font-jakarta text-[11px] font-semibold text-amber-300">🗃️ Offline MicroSD CSV Ingestion</p>
          <p className="font-grotesk text-[9px] text-gray-600 mt-0.5">
            Drop a field CSV log (e.g. biodata.csv) · idempotent — duplicates silently skipped · startup 0°C transients auto-filtered
          </p>
        </div>
        <span className="font-grotesk text-[9px] text-amber-400 bg-amber-900/20 border border-amber-700/30 px-2 py-0.5 rounded-full">
          ESP32_CSV
        </span>
      </motion.div>

      {/* Drop zone */}
      <motion.div variants={panelV} className="glass p-4 flex flex-col gap-3">
        <div
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center gap-2 p-8 transition-all duration-300"
          style={{
            borderColor: dragging ? '#f59e0b' : 'rgba(245,158,11,0.3)',
            background:  dragging ? 'rgba(245,158,11,0.08)' : 'transparent',
            minHeight:   140,
          }}
        >
          <input ref={inputRef} type="file" accept=".csv,.txt" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          {csvFile ? (
            <div className="text-center">
              <HardDrive size={28} className="text-amber-400 mx-auto mb-2" />
              <p className="font-grotesk text-[11px] text-amber-300 font-semibold">{csvFile.name}</p>
              <p className="font-grotesk text-[9px] text-gray-600 mt-0.5">
                {(csvFile.size / 1024).toFixed(1)} KB · ready to ingest
              </p>
            </div>
          ) : (
            <>
              <UploadCloud size={32} className="text-amber-400 opacity-50" />
              <p className="font-jakarta text-[11px] text-gray-500">Drag &amp; drop field CSV log or click to browse</p>
              <p className="font-grotesk text-[9px] text-gray-700">.CSV · .TXT · biodata.csv · ESP32 SD card log</p>
            </>
          )}
        </div>

        {csvFile && (
          <motion.button
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            onClick={upload} disabled={uploading}
            whileHover={{ scale: uploading ? 1 : 1.015, boxShadow: '0 0 30px rgba(245,158,11,0.3)' }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3 rounded-2xl font-jakarta font-bold text-[11px] tracking-wide
              flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
            style={{
              background:  uploading ? 'linear-gradient(135deg,#78350f,#92400e)' : 'linear-gradient(135deg,#d97706,#b45309,#92400e)',
              boxShadow:   uploading ? 'none' : '0 0 24px rgba(217,119,6,0.25)',
            }}
          >
            {uploading
              ? <><RefreshCw size={13} className="animate-spin" />Parsing &amp; Ingesting CSV…</>
              : <><UploadCloud size={13} />Ingest Field CSV Log</>}
          </motion.button>
        )}
      </motion.div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="glass border border-red-700/40 p-3 rounded-xl flex items-start gap-2"
          >
            <XCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
            <p className="font-grotesk text-[10px] text-red-300">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result */}
      <AnimatePresence>
        {result && (
          <motion.div variants={stagger} initial="hidden" animate="visible" exit={{ opacity: 0 }} className="space-y-3">

            {/* Row counts */}
            <motion.div variants={panelV} className="glass border border-amber-700/30 p-4 rounded-xl space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={13} className="text-amber-400" />
                <p className="font-jakarta text-[11px] font-semibold text-amber-300">
                  CSV Ingest Complete · {result.filename}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Parsed',   value: result.rows_parsed,   color: 'text-gray-300'    },
                  { label: 'Inserted', value: result.rows_inserted, color: 'text-emerald-300'  },
                  { label: 'Skipped',  value: result.rows_skipped,  color: 'text-amber-300'    },
                ].map(({ label, value, color }) => (
                  <div key={label} className="glass p-3 rounded-xl text-center">
                    <p className={`font-grotesk text-xl font-bold ${color}`}>{value}</p>
                    <p className="font-jakarta text-[8px] text-gray-600 uppercase tracking-widest mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Statistical summary */}
            {result.stats && Object.keys(result.stats).length > 0 && (
              <motion.div variants={panelV} className="glass p-4 rounded-xl space-y-3">
                <p className="font-jakarta text-[9px] text-gray-600 uppercase tracking-widest flex items-center gap-1.5">
                  <FlaskConical size={10} className="text-emerald-500" />Statistical Summary
                </p>
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                  {STAT_METRICS.filter(m => result.stats[m.key]).map(m => {
                    const s = result.stats[m.key];
                    return (
                      <div key={m.key} className="glass p-3 rounded-xl border" style={{ borderColor: `${m.color}22` }}>
                        <p className="font-jakarta text-[9px] uppercase tracking-widest mb-1.5" style={{ color: m.color }}>
                          {m.label}
                        </p>
                        <div className="space-y-0.5">
                          {[['min', s.min], ['max', s.max], ['mean', s.mean], ['σ', s.std]].map(([k, v]) => (
                            <div key={k} className="flex justify-between">
                              <span className="font-jakarta text-[8px] text-gray-600">{k}</span>
                              <span className="font-grotesk text-[9px] text-gray-300">
                                {v != null ? Number(v).toFixed(2) : '—'}{m.unit}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* Row warnings */}
            {result.errors?.length > 0 && (
              <motion.div variants={panelV} className="glass p-3 rounded-xl">
                <details>
                  <summary className="font-jakarta text-[9px] text-amber-500 cursor-pointer">
                    {result.errors.length} row warning{result.errors.length !== 1 ? 's' : ''}
                  </summary>
                  <div className="mt-1.5 space-y-0.5 max-h-28 overflow-y-auto">
                    {result.errors.map((e, i) => (
                      <p key={i} className="font-grotesk text-[8px] text-gray-600">{e}</p>
                    ))}
                  </div>
                </details>
              </motion.div>
            )}

          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Tab 1 — Sensor Telemetry                                                   */
/*  Toggle: Live WebSocket Stream | Offline MicroSD CSV Ingestion              */
/* ─────────────────────────────────────────────────────────────────────────── */

function SensorTelemetryTab({ readings, histories, geoCoords, wsState, onIngestComplete }) {
  const [mode, setMode] = useState('live'); // 'live' | 'csv'
  const latest = readings[0] ?? null;

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-4">

      {/* Mode toggle */}
      <motion.div variants={panelV} className="glass p-1.5 rounded-xl flex gap-1">
        {[
          { id: 'live', label: 'Live WebSocket Stream',        Icon: Activity,  activeStyle: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25' },
          { id: 'csv',  label: 'Offline MicroSD CSV Ingestion', Icon: HardDrive, activeStyle: 'bg-amber-500/15 text-amber-300 border border-amber-500/25' },
        ].map(({ id, label, Icon, activeStyle }) => (
          <button
            key={id} id={`telemetry-mode-${id}`} onClick={() => setMode(id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg
              text-[10px] font-jakarta font-semibold transition-all duration-200
              ${mode === id ? activeStyle : 'text-gray-600 hover:text-gray-400 hover:bg-white/5'}`}
          >
            <Icon size={11} />{label}
          </button>
        ))}
      </motion.div>

      <AnimatePresence mode="wait">
        {mode === 'live' ? (
          <motion.div
            key="live"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="space-y-4"
          >
            {/* GPS + WS status bar */}
            <motion.div variants={panelV} className="glass p-3 flex flex-wrap items-center gap-3">
              <MapPin size={11} className="text-emerald-500 shrink-0" />
              <span className="font-jakarta text-[9px] text-gray-500 uppercase tracking-widest">Browser GPS</span>
              {geoCoords ? (
                <span className="font-grotesk text-[10px] text-emerald-300">
                  {geoCoords.latitude.toFixed(5)}, {geoCoords.longitude.toFixed(5)}
                  {geoCoords.altitude != null && ` · ${geoCoords.altitude.toFixed(1)} m`}
                </span>
              ) : (
                <span className="font-grotesk text-[10px] text-gray-600">Acquiring GPS…</span>
              )}
              <span className="ml-auto flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${wsState === 'open' ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
                <span className={`font-jakarta text-[9px] ${wsState === 'open' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {wsState === 'open' ? '📡 WS Live · /ws/telemetry' : 'WS Offline'}
                </span>
              </span>
            </motion.div>

            {/* 6-Param Metric tiles */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {METRICS.map(m => (
                <MetricCard
                  key={m.key} metric={m}
                  value={latest ? latest[m.key] : null}
                  history={(histories[m.key] || []).map(v => ({ value: v }))}
                />
              ))}
            </div>

            {/* Telemetry history table */}
            {readings.length > 0 ? (
              <motion.div variants={panelV} className="glass p-4 overflow-x-auto">
                <p className="font-jakarta text-[9px] text-gray-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Activity size={10} className="text-emerald-500" />
                  Telemetry History
                  <span className="ml-auto text-gray-700">
                    {readings.length} record{readings.length !== 1 ? 's' : ''}
                  </span>
                </p>
                <table className="w-full text-[10px] font-grotesk border-collapse">
                  <thead>
                    <tr className="text-gray-600 border-b border-emerald-900/20">
                      {['Timestamp', 'Source', 'Temp', 'Humidity', 'Pressure', 'Lux', 'Sound dB', 'Altitude', 'Device'].map(h => (
                        <th key={h} className="text-left py-1.5 pr-4 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {readings.slice(0, 40).map(r => (
                      <tr key={r.id} className="border-b border-emerald-900/10 hover:bg-emerald-900/10 transition-colors">
                        <td className="py-1.5 pr-4 text-gray-500">{new Date(r.observed_at).toLocaleString()}</td>
                        <td className="py-1.5 pr-4"><SourceBadge source={r.data_source} /></td>
                        <td className="py-1.5 pr-4 text-orange-300">{r.temperature_c?.toFixed(1)}°</td>
                        <td className="py-1.5 pr-4 text-sky-300">{r.humidity_percent?.toFixed(1)}%</td>
                        <td className="py-1.5 pr-4 text-violet-300">{r.pressure_hPa?.toFixed(1)}</td>
                        <td className="py-1.5 pr-4 text-yellow-300">{r.light_lux?.toFixed(0)}</td>
                        <td className="py-1.5 pr-4 text-emerald-300">{r.sound_db?.toFixed(1)}</td>
                        <td className="py-1.5 pr-4 text-teal-300">{r.altitude_m != null ? `${r.altitude_m.toFixed(1)} m` : '—'}</td>
                        <td className="py-1.5 pr-4 text-gray-600 truncate max-w-[80px]">{r.device_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </motion.div>
            ) : (
              <motion.div variants={panelV} className="glass p-8 text-center">
                <Wifi size={30} className="text-emerald-900 mx-auto mb-2" />
                <p className="text-gray-600 font-jakarta text-sm">Awaiting live ESP32 telemetry stream…</p>
                <p className="text-gray-700 font-grotesk text-[10px] mt-1">
                  WebSocket {wsState === 'open' ? 'connected — waiting for first frame' : 'not connected'}
                </p>
              </motion.div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="csv"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <CSVIngestionPanel onIngestComplete={onIngestComplete} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Tab 2 — Ground Field Photo AI Ingestion                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

function GroundPhotoTab({ geoCoords, readings, onScanComplete }) {
  const [groundFile, setGroundFile] = useState(null);
  const [preview,    setPreview]    = useState(null);
  const [zone,       setZone]       = useState('ZONE_B');
  const [scanning,   setScanning]   = useState(false);
  const [result,     setResult]     = useState(null);
  const [error,      setError]      = useState('');

  const handleFile = useCallback(file => {
    setGroundFile(file);
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setError('');
  }, []);

  const dd = useDragDrop(handleFile);

  const reset = useCallback(() => {
    setGroundFile(null); setPreview(null); setResult(null); setError('');
  }, []);

  const submit = useCallback(async () => {
    if (!groundFile) { setError('Please drop a ground photo first.'); return; }
    setScanning(true); setError(''); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', groundFile);
      fd.append('focal_zone', zone);
      if (geoCoords?.latitude  != null) fd.append('latitude',  geoCoords.latitude);
      if (geoCoords?.longitude != null) fd.append('longitude', geoCoords.longitude);
      const res = await fetch(`${API}/api/ground-image/scan`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
      const data = await res.json();
      setResult(data);
      onScanComplete?.();
    } catch (err) { setError(err.message); }
    finally { setScanning(false); }
  }, [groundFile, zone, geoCoords, onScanComplete]);

  const latestReading = readings?.[0] ?? null;

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-4">

      {/* Header */}
      <motion.div variants={panelV} className="glass p-4 flex items-center gap-3">
        <ScanSearch size={16} className="text-emerald-400 shrink-0" />
        <div className="flex-1">
          <p className="font-jakarta text-[11px] font-semibold text-emerald-300">
            🌿 Ground Field Photo AI Ingestion
          </p>
          <p className="font-grotesk text-[9px] text-gray-600 mt-0.5">
            Upload ground photo · select focal zone · MobileNetV3 taxa/vegetation classifier
            · Excess Green Index (ExG) · ±5 min temporal telemetry match
          </p>
        </div>
        {geoCoords && (
          <span className="font-grotesk text-[9px] text-emerald-400 bg-emerald-900/20 border border-emerald-700/30 px-2 py-0.5 rounded-full flex items-center gap-1">
            <MapPin size={9} /> GPS Active
          </span>
        )}
      </motion.div>

      {/* Zone selector + image drop zone */}
      <motion.div variants={panelV} className="glass p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Leaf size={12} className="text-emerald-400" />
          <p className="font-jakarta text-[10px] font-semibold text-emerald-300">Ground Photo Classification</p>
          <div className="ml-auto flex items-center gap-2">
            <span className="font-jakarta text-[9px] text-gray-600">Target Zone:</span>
            <select
              id="ground-zone-select"
              value={zone} onChange={e => setZone(e.target.value)}
              className="bg-[#0D1321] border border-emerald-800/40 text-emerald-300 text-[9px]
                font-jakarta rounded-lg px-2 py-1.5 outline-none cursor-pointer"
            >
              {FOCAL_ZONES.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
            </select>
          </div>
        </div>

        {/* Drop zone */}
        <div
          ref={dd.ref}
          onDragOver={dd.onDragOver} onDragLeave={dd.onDragLeave} onDrop={dd.onDrop}
          onClick={() => dd.ref.current?.querySelector('input')?.click()}
          className="relative rounded-xl border-2 border-dashed cursor-pointer
            flex flex-col items-center justify-center gap-2 p-6 transition-all duration-300"
          style={{
            borderColor: dd.dragging ? '#34d399' : '#34d39944',
            background:  dd.dragging ? '#34d39911' : 'transparent',
            minHeight:   preview ? 'auto' : 180,
          }}
        >
          <input type="file" accept="image/jpeg,image/jpg,image/png" className="hidden" onChange={dd.onInput} />
          {preview ? (
            <div className="w-full">
              <img src={preview} alt="Ground photo" className="w-full rounded-lg object-contain max-h-64" />
              <p className="font-grotesk text-[9px] text-gray-600 text-center mt-2 truncate">{groundFile?.name}</p>
            </div>
          ) : (
            <>
              <Camera size={32} className="text-emerald-500 opacity-40" />
              <p className="font-jakarta text-[11px] text-gray-500">Drag &amp; drop ground photo or click to browse</p>
              <p className="font-grotesk text-[9px] text-gray-700">JPG · PNG · Field specimen / vegetation photos</p>
            </>
          )}
        </div>

        {/* Action buttons */}
        {groundFile && (
          <div className="flex gap-3">
            <motion.button
              id="ground-classify-btn"
              onClick={submit} disabled={scanning}
              whileHover={{ scale: scanning ? 1 : 1.015, boxShadow: '0 0 30px rgba(52,211,153,0.3)' }}
              whileTap={{ scale: 0.98 }}
              className="flex-1 py-3 rounded-xl font-jakarta font-bold text-sm tracking-wide
                flex items-center justify-center gap-2 transition-all disabled:opacity-40"
              style={{
                background: scanning
                  ? 'linear-gradient(135deg,#064E3B,#065F46)'
                  : 'linear-gradient(135deg,#10B981,#059669,#047857)',
                boxShadow: scanning ? 'none' : '0 0 24px rgba(16,185,129,0.25)',
              }}
            >
              {scanning
                ? <><RefreshCw size={14} className="animate-spin" />Running AI Pipeline…</>
                : <><ScanSearch size={14} />Classify &amp; Fuse Telemetry</>}
            </motion.button>
            {!scanning && (
              <button onClick={reset}
                className="px-4 py-3 rounded-xl font-jakarta text-[10px] text-gray-600
                  hover:text-gray-400 border border-gray-800 hover:border-gray-700 transition-all"
              >
                Reset
              </button>
            )}
          </div>
        )}
      </motion.div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="glass border border-red-700/40 p-3 rounded-xl flex items-start gap-2"
          >
            <XCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
            <p className="font-grotesk text-[10px] text-red-300">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Classification result */}
      <AnimatePresence>
        {result && (
          <motion.div variants={stagger} initial="hidden" animate="visible" exit={{ opacity: 0 }} className="space-y-3">

            {/* Main result card */}
            <motion.div variants={panelV} className="glass border border-emerald-700/30 p-4 rounded-xl space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                <p className="font-jakarta text-[11px] font-semibold text-emerald-300">AI Classification Complete</p>
                <FocalZoneBadge zoneId={result.focal_zone} />
              </div>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                {[
                  { label: 'Taxa / Vegetation Class', value: result.species_prediction, color: 'text-emerald-200' },
                  { label: 'Confidence Score',         value: result.confidence_score != null ? `${(result.confidence_score * 100).toFixed(1)}%` : '—', color: 'text-sky-300' },
                  {
                    label: 'Excess Green Index (ExG)',
                    value: result.excess_green_index != null ? result.excess_green_index.toFixed(4) : '—',
                    color: result.excess_green_index != null
                      ? (result.excess_green_index > 0 ? 'text-emerald-300' : 'text-red-300')
                      : 'text-gray-500',
                  },
                  { label: 'Focal Zone', value: result.zone_label, color: 'text-amber-300' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="glass p-3 rounded-xl">
                    <p className="font-jakarta text-[8px] text-gray-600 uppercase tracking-widest">{label}</p>
                    <p className={`font-grotesk text-[12px] font-semibold truncate mt-0.5 ${color}`}>{value}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Telemetry fusion snapshot */}
            {result.environmental_telemetry_snapshot &&
             Object.keys(result.environmental_telemetry_snapshot).length > 0 && (
              <motion.div variants={panelV} className="glass p-4 rounded-xl border border-teal-900/30 space-y-2">
                <p className="font-jakarta text-[9px] text-gray-600 uppercase tracking-widest flex items-center gap-1.5">
                  <Activity size={10} className="text-teal-400" />
                  Nearest Telemetry Match · ±5 min temporal sync
                </p>
                <div className="grid grid-cols-3 xl:grid-cols-6 gap-2">
                  {ENV_PARAMS.map(({ key, label, unit, color, Icon }) => {
                    const val = result.environmental_telemetry_snapshot[key];
                    return (
                      <div key={key} className="glass p-2 rounded-lg text-center">
                        <Icon size={10} style={{ color }} className="mx-auto mb-1" />
                        <p className="font-grotesk text-[11px] font-bold" style={{ color }}>
                          {val != null ? Number(val).toFixed(1) : '—'}
                        </p>
                        <p className="font-jakarta text-[7px] text-gray-700 uppercase tracking-widest">{label}</p>
                        <p className="font-grotesk text-[7px] text-gray-700">{unit}</p>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* Taxonomy breakdown */}
            {result.taxonomy && Object.keys(result.taxonomy).length > 0 && (
              <motion.div variants={panelV} className="glass p-4 rounded-xl space-y-2">
                <p className="font-jakarta text-[9px] text-gray-600 uppercase tracking-widest flex items-center gap-1.5">
                  <Leaf size={10} className="text-emerald-500" />Taxonomic Classification
                </p>
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-1.5">
                  {Object.entries(result.taxonomy).map(([rank, name]) => (
                    <div key={rank} className="flex flex-col">
                      <span className="font-jakarta text-[8px] text-gray-600">{rank}</span>
                      <span className="font-grotesk text-[10px] text-emerald-200 italic truncate">{name}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live micro-climate context when no scan result yet */}
      {!result && latestReading && (
        <motion.div variants={panelV} className="glass p-4 rounded-xl border border-emerald-900/20 space-y-2">
          <p className="font-jakarta text-[9px] text-gray-600 uppercase tracking-widest flex items-center gap-1.5">
            <Activity size={10} className="text-emerald-500" />Live Micro-Climate Context (latest telemetry)
          </p>
          <div className="grid grid-cols-3 xl:grid-cols-6 gap-2">
            {ENV_PARAMS.map(({ key, label, unit, color, Icon }) => (
              <div key={key} className="glass p-2 rounded-lg text-center">
                <Icon size={10} style={{ color }} className="mx-auto mb-1" />
                <p className="font-grotesk text-[11px] font-bold" style={{ color }}>
                  {latestReading[key] != null ? Number(latestReading[key]).toFixed(1) : '—'}
                </p>
                <p className="font-jakarta text-[7px] text-gray-700 uppercase tracking-widest">{label}</p>
                <p className="font-grotesk text-[7px] text-gray-700">{unit}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Tab 3 — Fused Multi-Modal Records                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

function FusedRecordsTab() {
  const [records,     setRecords]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [pipeRunning, setPipeRunning] = useState(false);
  const [pipeResult,  setPipeResult]  = useState(null);
  const [pipeError,   setPipeError]   = useState('');

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/ground-image/records?limit=100`);
      if (r.ok) setRecords(await r.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const engagePipeline = useCallback(async () => {
    setPipeRunning(true); setPipeError(''); setPipeResult(null);
    try {
      const res = await fetch(`${API}/api/v1/analytics/run-pipeline`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
      setPipeResult(await res.json());
    } catch (err) { setPipeError(err.message); }
    finally { setPipeRunning(false); }
  }, []);

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-4">

      {/* Header */}
      <motion.div variants={panelV} className="glass p-4 flex items-center gap-3">
        <Database size={16} className="text-violet-400 shrink-0" />
        <div className="flex-1">
          <p className="font-jakarta text-[11px] font-semibold text-violet-300">
            🔗 Fused Multi-Modal Records
          </p>
          <p className="font-grotesk text-[9px] text-gray-600 mt-0.5">
            Ground image AI results fused with nearest-timestamp telemetry · Excess Green Index · Export to Excel/CSV
          </p>
        </div>
        <button
          id="fused-refresh-btn"
          onClick={fetchRecords}
          className="flex items-center gap-1.5 text-[9px] font-jakarta text-gray-600 hover:text-emerald-400 transition-colors"
        >
          <RefreshCw size={10} className={loading ? 'animate-spin text-emerald-400' : ''} /> Refresh
        </button>
      </motion.div>

      {/* Pipeline Engine */}
      <motion.div variants={panelV} className="glass p-4 rounded-xl border border-emerald-900/30 space-y-3">
        <div className="flex items-center gap-2">
          <Zap size={13} className="text-emerald-400" />
          <p className="font-jakarta text-[10px] font-semibold text-emerald-300">Data Science Pipeline Engine</p>
        </div>
        <motion.button
          id="engage-pipeline-btn"
          onClick={engagePipeline} disabled={pipeRunning}
          whileHover={{ scale: pipeRunning ? 1 : 1.015, boxShadow: '0 0 30px rgba(52,211,153,0.3)' }}
          whileTap={{ scale: 0.98 }}
          className="w-full py-3 rounded-2xl font-jakarta font-bold text-[11px] tracking-wide
            flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          style={{
            background: pipeRunning
              ? 'linear-gradient(135deg,#064E3B,#065F46)'
              : 'linear-gradient(135deg,#10B981,#059669,#047857)',
            boxShadow: pipeRunning ? 'none' : '0 0 24px rgba(16,185,129,0.2)',
          }}
        >
          {pipeRunning
            ? <><RefreshCw size={13} className="animate-spin" />Running Pipeline…</>
            : <><Zap size={13} />🔥 ENGAGE DATA SCIENTIST PIPELINE ENGINE</>}
        </motion.button>
        {pipeError && <p className="font-grotesk text-[10px] text-red-300">{pipeError}</p>}
        <AnimatePresence>
          {pipeResult && (
            <motion.div
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="glass border border-emerald-600/20 p-3 rounded-xl flex items-center gap-2 flex-wrap"
            >
              <CheckCircle2 size={11} className="text-emerald-400" />
              <p className="font-jakarta text-[10px] text-emerald-300">
                Pipeline complete · {pipeResult.anomaly_count} anomal{pipeResult.anomaly_count !== 1 ? 'ies' : 'y'} detected
              </p>
              {pipeResult.excel_download_url && (
                <a
                  href={`${API}${pipeResult.excel_download_url}`} target="_blank" rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 text-[9px] font-jakarta text-emerald-400
                    border border-emerald-600/30 px-2 py-0.5 rounded-lg hover:bg-emerald-900/20"
                >
                  <Download size={9} /> Excel
                </a>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Export controls */}
      <motion.div variants={panelV} className="flex gap-2">
        <a
          id="export-excel-btn"
          href={`${API}/api/v1/reports/export-excel?session_id=all`}
          target="_blank" rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-jakarta
            text-[10px] font-bold border border-emerald-700/40 text-emerald-300
            hover:bg-emerald-900/20 transition-colors"
        >
          <Download size={11} /> Download Full 4-Sheet Excel Workbook
        </a>
        <a
          href={`${API}/sensor-readings?limit=1000`}
          target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl font-jakarta
            text-[10px] border border-gray-700/40 text-gray-400 hover:bg-white/5 transition-colors"
        >
          <FileText size={11} /> Raw JSON
        </a>
      </motion.div>

      {/* Fused records table */}
      <motion.div variants={panelV} className="glass p-4 overflow-x-auto">
        <p className="font-jakarta text-[9px] text-gray-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
          <TableProperties size={10} className="text-violet-400" />
          Fused Ground + Telemetry Records
          <span className="ml-auto text-gray-700">{records.length} record{records.length !== 1 ? 's' : ''}</span>
        </p>

        {records.length > 0 ? (
          <table className="w-full text-[10px] font-grotesk border-collapse">
            <thead>
              <tr className="text-gray-600 border-b border-violet-900/20">
                {['ID', 'Timestamp', 'Zone', 'Species / Taxa', 'Confidence', 'ExG Index', 'Temp', 'Humidity', 'Pressure', 'Lux', 'Sound dB'].map(h => (
                  <th key={h} className="text-left py-1.5 pr-4 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map(r => {
                const tele = (() => {
                  try {
                    return typeof r.environmental_telemetry === 'string'
                      ? JSON.parse(r.environmental_telemetry)
                      : (r.environmental_telemetry ?? {});
                  } catch { return {}; }
                })();
                return (
                  <tr key={r.image_id} className="border-b border-violet-900/10 hover:bg-violet-900/10 transition-colors">
                    <td className="py-1.5 pr-4 text-gray-700">#{r.image_id}</td>
                    <td className="py-1.5 pr-4 text-gray-500">{new Date(r.timestamp).toLocaleString()}</td>
                    <td className="py-1.5 pr-4"><FocalZoneBadge zoneId={r.focal_zone} /></td>
                    <td className="py-1.5 pr-4 text-emerald-300 font-semibold">{r.species_prediction ?? '—'}</td>
                    <td className="py-1.5 pr-4 text-sky-300">
                      {r.confidence_score != null ? `${(r.confidence_score * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-1.5 pr-4" style={{
                      color: r.excess_green_index != null
                        ? (r.excess_green_index > 0 ? '#34d399' : '#f87171')
                        : '#6b7280'
                    }}>
                      {r.excess_green_index != null ? r.excess_green_index.toFixed(4) : '—'}
                    </td>
                    <td className="py-1.5 pr-4 text-orange-300">
                      {tele.temperature_c != null ? `${Number(tele.temperature_c).toFixed(1)}°` : '—'}
                    </td>
                    <td className="py-1.5 pr-4 text-sky-300">
                      {tele.humidity_percent != null ? `${Number(tele.humidity_percent).toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-1.5 pr-4 text-violet-300">
                      {tele.pressure_hPa != null ? Number(tele.pressure_hPa).toFixed(1) : '—'}
                    </td>
                    <td className="py-1.5 pr-4 text-yellow-300">
                      {tele.light_lux != null ? Number(tele.light_lux).toFixed(0) : '—'}
                    </td>
                    <td className="py-1.5 pr-4 text-emerald-300">
                      {tele.sound_db != null ? Number(tele.sound_db).toFixed(1) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="py-12 text-center">
            <Database size={30} className="text-violet-900 mx-auto mb-2" />
            <p className="text-gray-600 font-jakarta text-sm">No fused records yet.</p>
            <p className="text-gray-700 font-grotesk text-[10px] mt-1">
              Upload a ground photo in the AI Ingestion tab to create fused records.
            </p>
          </div>
        )}
      </motion.div>

      {/* Analytics plots */}
      <div className="pt-1">
        <AnalyticsPanel />
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Root App                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

export default function App() {
  const [activeTab, setActiveTab] = useState('telemetry');
  const [health,    setHealth]    = useState(null);
  const [hardware,  setHardware]  = useState(null);
  const [readings,  setReadings]  = useState([]);
  const [histories, setHistories] = useState({});
  const [geoCoords, setGeoCoords] = useState(null);
  const [wsState,   setWsState]   = useState('closed');
  const wsRef = useRef(null);

  /* ── Browser geolocation — auto-acquired on mount ─────────────────────── */
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      pos => setGeoCoords({
        latitude:  pos.coords.latitude,
        longitude: pos.coords.longitude,
        altitude:  pos.coords.altitude,
        accuracy:  pos.coords.accuracy,
      }),
      err => console.warn('Geolocation error:', err.message),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  /* ── WebSocket client — /ws/telemetry ─────────────────────────────────── */
  useEffect(() => {
    let ws;
    let reconnectTimer;
    const connect = () => {
      try {
        ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        ws.onopen  = () => setWsState('open');
        ws.onclose = () => { setWsState('closed'); reconnectTimer = setTimeout(connect, 5000); };
        ws.onerror = () => ws.close();
        ws.onmessage = () => fetchReadings();
      } catch {
        reconnectTimer = setTimeout(connect, 5000);
      }
    };
    connect();
    return () => { clearTimeout(reconnectTimer); ws?.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Polling ────────────────────────────────────────────────────────────── */
  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch(`${API}/health`);
      if (r.ok) setHealth(await r.json()); else setHealth(null);
    } catch { setHealth(null); }
  }, []);

  const fetchReadings = useCallback(async () => {
    try {
      const r = await fetch(`${API}/sensor-readings?limit=100`);
      if (!r.ok) return;
      const data = await r.json();
      setReadings(data);
      setHistories(prev => {
        const next = { ...prev };
        METRICS.forEach(({ key }) => {
          next[key] = data.slice(0, 20).map(row => row[key]).filter(v => v != null).reverse();
        });
        return next;
      });
    } catch {}
  }, []);

  const fetchHardware = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/hardware/status`);
      if (r.ok) setHardware(await r.json()); else setHardware(null);
    } catch { setHardware(null); }
  }, []);

  useEffect(() => {
    fetchHealth(); fetchHardware(); fetchReadings();
    const id   = setInterval(() => { fetchHealth(); fetchHardware(); fetchReadings(); }, POLL_MS);
    const hwId = setInterval(fetchHardware, 5000);
    return () => { clearInterval(id); clearInterval(hwId); };
  }, [fetchHealth, fetchHardware, fetchReadings]);

  const refreshAll = useCallback(() => {
    fetchHealth(); fetchHardware(); fetchReadings();
  }, [fetchHealth, fetchHardware, fetchReadings]);

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-[#0B0F19] text-gray-100 font-grotesk flex">

      {/* ── Sidebar ── */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-emerald-900/20
        bg-[#0D1321]/80 backdrop-blur-md p-4 gap-5">

        {/* Logo */}
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30
            flex items-center justify-center">
            <Cpu size={13} className="text-emerald-400" />
          </div>
          <div>
            <p className="font-jakarta text-[11px] font-bold text-emerald-300">UNIBEN</p>
            <p className="font-grotesk text-[8px] text-gray-700">Biodiversity Pipeline</p>
          </div>
        </div>

        {/* Nav tabs */}
        <nav className="flex flex-col gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} id={`nav-tab-${id}`} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-jakarta
                text-left transition-all duration-200
                ${activeTab === id
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                  : 'text-gray-600 hover:text-gray-400 hover:bg-white/5'
                }`}
            >
              <Icon size={11} />{label}
            </button>
          ))}
        </nav>

        {/* Hardware Status Badge */}
        <div className="mt-auto">
          {hardware?.status === 'connected' ? (
            <div className="glass flex items-center gap-3 p-3 rounded-xl border border-emerald-500/30
              bg-emerald-900/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
              <div className="relative flex items-center justify-center w-3 h-3">
                <span className="absolute inline-flex w-full h-full rounded-full opacity-75 bg-emerald-400 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
              </div>
              <span className="font-jakarta text-[10px] text-emerald-300 font-bold uppercase tracking-wider">
                📡 ESP32 Live Connected
              </span>
            </div>
          ) : (
            <div className="glass flex items-center gap-3 p-3 rounded-xl border border-red-500/30
              bg-red-900/20 animate-pulse" style={{ animationDuration: '3s' }}>
              <XCircle size={12} className="text-red-500" />
              <span className="font-jakarta text-[10px] text-red-400 font-bold uppercase tracking-wider">
                ❌ Hardware Disconnected
              </span>
            </div>
          )}
        </div>

        {/* System health pills */}
        <div>
          <p className="font-jakarta text-[9px] text-gray-700 uppercase tracking-widest mb-2">System Health</p>
          <div className="flex flex-col gap-1.5">
            <Pill ok={!!health}                     label={health ? 'API Active'     : 'API Offline'}       />
            <Pill ok={health?.database_available}   label={health?.database_available ? 'DB Synced' : 'DB Error'} />
            <Pill ok={health?.upload_dir_available} label="Upload Dir"                                       />
            <Pill ok={health?.model_file_loaded}    label={health?.model_file_loaded  ? 'Model Active' : 'No Checkpoint'} />
            <Pill ok={wsState === 'open'}            label={wsState === 'open' ? 'WS Connected' : 'WS Offline'} />
          </div>
        </div>

        {/* Refresh */}
        <button onClick={refreshAll}
          className="flex items-center gap-1.5 text-[9px] font-jakarta text-gray-700
            hover:text-emerald-400 transition-colors">
          <RefreshCw size={10} /> Refresh
        </button>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col min-w-0 p-4 lg:p-6 gap-4">

        {/* Top bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h1 className="font-jakarta text-lg font-bold text-emerald-200">
              Environmental Biodiversity Dashboard
            </h1>
            <p className="font-grotesk text-[10px] text-gray-600">
              UNIBEN Field Station · Dual Telemetry Ingestion (Live ESP32 + Offline CSV)
              · Ground Photography AI Pipeline · 3-Zone Spatial Segmentation
            </p>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px]
            font-jakarta border ${health
              ? 'border-emerald-600/30 text-emerald-400 bg-emerald-900/15'
              : 'border-red-700/30 text-red-400 bg-red-900/10'}`}>
            {health ? <Wifi size={10} /> : <WifiOff size={10} />}
            {health ? 'Connected' : 'Offline'}
          </div>
        </div>

        {/* Mobile tab bar */}
        <div className="flex lg:hidden gap-1 glass p-1 rounded-xl">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg
                text-[9px] font-jakarta transition-all duration-200
                ${activeTab === id
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-gray-600 hover:text-gray-400'
                }`}
            >
              <Icon size={10} />{label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          {activeTab === 'telemetry' && (
            <motion.div key="telemetry"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <SensorTelemetryTab
                readings={readings}
                histories={histories}
                geoCoords={geoCoords}
                wsState={wsState}
                onIngestComplete={refreshAll}
              />
            </motion.div>
          )}
          {activeTab === 'ground' && (
            <motion.div key="ground"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <GroundPhotoTab
                geoCoords={geoCoords}
                readings={readings}
                onScanComplete={refreshAll}
              />
            </motion.div>
          )}
          {activeTab === 'fused' && (
            <motion.div key="fused"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <FusedRecordsTab />
            </motion.div>
          )}
        </AnimatePresence>

      </main>
    </div>
  );
}
