/**
 * UNIBEN Biodiversity Pipeline — v7 Refactor
 *
 * Dual Telemetry Ingestion + Ground Photography AI Pipeline
 *
 * Tab 1 — Live ESP32 Telemetry & Sensor Buffer
 *   Toggle: Live WebSocket Stream (/ws/telemetry) | Offline MicroSD CSV Ingestion (/api/telemetry/upload-csv)
 *   Live mode: 6-gauge metric cards + sparklines + telemetry history table
 *   CSV mode: drag-and-drop field log, statistical summary, ingested records table
 *
 * Tab 2 — Ground-Level Biodiversity & Field Ingestion
 *   Upload JPG/PNG · select focal zone · POST /api/classify  (alias: /api/species/classify)
 *   Returns: taxa/vegetation class · confidence · Excess Green Index (ExG) · paired microclimate telemetry
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
  Images, FolderUp, Trash2, Layers, Search, FileSpreadsheet, Sparkles, Filter, Check,
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
  { id: 'telemetry', label: 'Live ESP32 Telemetry & Sensor Buffer',       icon: Activity  },
  { id: 'ground',    label: 'Ground-Level Biodiversity & Field Ingestion', icon: Camera    },
  { id: 'fused',     label: 'Fused Multi-Modal Records',                   icon: Database  },
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
/*  Tab 2 — Ground Field Photo AI Ingestion (Batch / Bulk Pipeline)            */
/* ─────────────────────────────────────────────────────────────────────────── */

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function GroundPhotoTab({ geoCoords, readings, onScanComplete }) {
  const [queuedFiles,    setQueuedFiles]    = useState([]);
  const [zone,           setZone]           = useState('ZONE_B');
  const [scanning,       setScanning]       = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [scanStatusMsg,  setScanStatusMsg]  = useState('');
  const [batchResults,   setBatchResults]   = useState([]);
  const [error,          setError]          = useState('');
  const [dragging,       setDragging]       = useState(false);

  // Table filtering & search
  const [searchTerm,     setSearchTerm]     = useState('');
  const [filterZone,     setFilterZone]     = useState('ALL');

  const fileInputRef   = useRef(null);
  const folderInputRef = useRef(null);
  const dropRef        = useRef(null);

  // Add files to batch queue (deduplicating by filename + size)
  const addFiles = useCallback((incomingFiles) => {
    const valid = Array.from(incomingFiles || []).filter(f =>
      f.type.startsWith('image/') || /\.(jpe?g|png|webp|tif|tiff)$/i.test(f.name)
    );
    if (!valid.length) return;

    setQueuedFiles(prev => {
      const existing = new Set(prev.map(p => `${p.file.name}_${p.file.size}`));
      const newItems = valid
        .filter(f => !existing.has(`${f.name}_${f.size}`))
        .map(file => ({
          id: `${file.name}_${file.size}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        }));
      return [...prev, ...newItems];
    });
    setError('');
  }, []);

  const removeQueuedFile = useCallback((id) => {
    setQueuedFiles(prev => {
      const item = prev.find(p => p.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  }, []);

  const clearQueue = useCallback(() => {
    queuedFiles.forEach(item => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setQueuedFiles([]);
    setError('');
    setUploadProgress(0);
    setScanStatusMsg('');
  }, [queuedFiles]);

  // Drag & drop handlers supporting multiple files
  const onDragOver = useCallback(e => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const onDrop = useCallback(e => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  // Execute batch ingestion pipeline
  const processBatch = useCallback(async () => {
    if (!queuedFiles.length) {
      setError('Please add or drop ground photos into the batch queue first.');
      return;
    }
    setScanning(true);
    setError('');
    setUploadProgress(15);
    setScanStatusMsg(`Preparing ${queuedFiles.length} photos for multipart ingestion...`);

    try {
      const fd = new FormData();
      queuedFiles.forEach(item => {
        fd.append('images', item.file);
        fd.append('files', item.file);
      });
      fd.append('zone', zone);
      fd.append('focal_zone', zone);
      if (geoCoords?.latitude != null) fd.append('latitude', geoCoords.latitude);
      if (geoCoords?.longitude != null) fd.append('longitude', geoCoords.longitude);

      setUploadProgress(40);
      setScanStatusMsg('Running parallel MobileNetV3 inference & Excess Green Index (ExG)...');

      let res = await fetch(`${API}/api/ground-image/batch-scan`, {
        method: 'POST',
        body: fd,
      });

      if (res.status === 404 || res.status === 405) {
        // Fallback: parallel classify
        setScanStatusMsg('Fallback: Running parallel /api/classify requests...');
        const parallelPromises = queuedFiles.map(async (item, idx) => {
          const sfd = new FormData();
          sfd.append('file', item.file);
          sfd.append('zone', zone);
          sfd.append('focal_zone', zone);
          if (geoCoords?.latitude != null) sfd.append('latitude', geoCoords.latitude);
          if (geoCoords?.longitude != null) sfd.append('longitude', geoCoords.longitude);
          const r = await fetch(`${API}/api/classify`, { method: 'POST', body: sfd });
          const d = await r.json();
          setUploadProgress(Math.min(90, 40 + Math.round(((idx + 1) / queuedFiles.length) * 50)));
          return d;
        });
        const fallbackItems = await Promise.all(parallelPromises);
        setBatchResults(prev => [...fallbackItems, ...prev]);
        setUploadProgress(100);
        setScanStatusMsg('Batch processing complete!');
        clearQueue();
        onScanComplete?.();
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} — ${await res.text()}`);
      }

      setUploadProgress(85);
      setScanStatusMsg('Synchronizing ESP32 microclimate telemetry snapshot & saving...');

      const data = await res.json();
      const records = data.records || [];
      setBatchResults(prev => [...records, ...prev]);
      setUploadProgress(100);
      setScanStatusMsg(`Successfully processed ${records.length} records.`);
      clearQueue();
      onScanComplete?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }, [queuedFiles, zone, geoCoords, clearQueue, onScanComplete]);

  // Export batch results to CSV
  const exportBatchCSV = useCallback(() => {
    if (!batchResults.length) return;
    const headers = [
      'Filename', 'Species_Prediction', 'Focal_Zone', 'Confidence_Score',
      'Excess_Green_Index_ExG', 'Temperature_C', 'Humidity_Pct', 'Pressure_hPa',
      'Illuminance_Lux', 'Sound_dB', 'Timestamp'
    ];
    const rows = batchResults.map(r => {
      const pt = r.paired_telemetry || r.environmental_telemetry_snapshot || {};
      return [
        `"${r.filename || r.original_filename || ''}"`,
        `"${r.species_prediction || r.predicted_class || ''}"`,
        `"${r.focal_zone || ''}"`,
        (r.confidence_score ?? r.confidence ?? 0).toFixed(4),
        (r.excess_green_index ?? r.exg_index ?? 0).toFixed(4),
        pt.temperature ?? pt.temperature_c ?? '',
        pt.humidity ?? pt.humidity_percent ?? '',
        pt.pressure ?? pt.pressure_hPa ?? '',
        pt.light ?? pt.light_lux ?? '',
        pt.sound ?? pt.sound_db ?? '',
        `"${r.timestamp || ''}"`
      ].join(',');
    });
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `UNIBEN_Batch_Ground_Classification_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [batchResults]);

  // Filtered batch results
  const filteredResults = batchResults.filter(r => {
    const fn   = (r.filename || r.original_filename || '').toLowerCase();
    const sp   = (r.species_prediction || r.predicted_class || '').toLowerCase();
    const term = searchTerm.toLowerCase();
    const matchesText = !term || fn.includes(term) || sp.includes(term);
    const matchesZone = filterZone === 'ALL' || (r.focal_zone || '').toUpperCase() === filterZone;
    return matchesText && matchesZone;
  });

  const totalQueuedBytes = queuedFiles.reduce((acc, item) => acc + (item.file.size || 0), 0);
  const latestReading = readings?.[0] ?? null;

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-4">

      {/* Header */}
      <motion.div variants={panelV} className="glass p-4 flex items-center gap-3">
        <ScanSearch size={16} className="text-emerald-400 shrink-0" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="font-jakarta text-[11px] font-semibold text-emerald-300">
              🌿 Ground Field Photo AI Ingestion (Bulk &amp; Batch Engine)
            </p>
            <span className="font-grotesk text-[8px] bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded-full font-bold">
              BATCH ENABLED
            </span>
          </div>
          <p className="font-grotesk text-[9px] text-gray-500 mt-0.5">
            Multi-file / folder drop · MobileNetV3-Small parallel taxa classifier · Excess Green Index (ExG) · ESP32 microclimate telemetry fusion
          </p>
        </div>
        {geoCoords && (
          <span className="font-grotesk text-[9px] text-emerald-400 bg-emerald-900/20 border border-emerald-700/30 px-2 py-0.5 rounded-full flex items-center gap-1">
            <MapPin size={9} /> GPS Active
          </span>
        )}
      </motion.div>

      {/* Batch Dropzone & Queue Controller */}
      <motion.div variants={panelV} className="glass p-4 flex flex-col gap-3">
        {/* Controls bar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Leaf size={13} className="text-emerald-400" />
            <p className="font-jakarta text-[10px] font-semibold text-emerald-300">
              Batch Ingestion Queue
            </p>
            {queuedFiles.length > 0 && (
              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-grotesk text-[9px] font-bold px-2 py-0.5 rounded-full">
                {queuedFiles.length} {queuedFiles.length === 1 ? 'photo' : 'photos'} queued ({formatFileSize(totalQueuedBytes)})
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <span className="font-jakarta text-[9px] text-gray-500">Target Focal Zone:</span>
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

        {/* Multi-file & Folder Dropzone */}
        <div
          ref={dropRef}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className="relative rounded-xl border-2 border-dashed cursor-pointer
            flex flex-col items-center justify-center gap-2 p-6 transition-all duration-300"
          style={{
            borderColor: dragging ? '#34d399' : queuedFiles.length ? '#10B98166' : '#34d39944',
            background:  dragging ? '#34d39911' : queuedFiles.length ? '#064E3B11' : 'transparent',
            minHeight:   queuedFiles.length ? 140 : 180,
          }}
        >
          {/* Hidden inputs */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
          />
          <input
            ref={folderInputRef}
            type="file"
            webkitdirectory="true"
            directory="true"
            multiple
            className="hidden"
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
          />

          <div className="flex items-center justify-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Images size={20} className="text-emerald-400" />
            </div>
            <div className="text-left">
              <p className="font-jakarta text-[11px] font-bold text-gray-200">
                Drag &amp; drop multiple ground photos here, or click to browse
              </p>
              <p className="font-grotesk text-[9px] text-gray-500 mt-0.5">
                Supports batch selection of JPG / PNG field photos or full directory trees
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-2" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-700/40 text-emerald-300 font-jakarta text-[9px] font-semibold flex items-center gap-1.5 transition-colors"
            >
              <UploadCloud size={11} /> Select Multiple Files
            </button>
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg bg-[#141B2D] hover:bg-[#1C263E] border border-gray-700 text-gray-300 font-jakarta text-[9px] font-semibold flex items-center gap-1.5 transition-colors"
            >
              <FolderUp size={11} /> Ingest Folder
            </button>
          </div>
        </div>

        {/* Queued thumbnails carousel / strip */}
        {queuedFiles.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-jakarta text-[9px] uppercase tracking-wider text-gray-500 font-semibold">
                Queued Image Specimens ({queuedFiles.length})
              </span>
              <button
                type="button"
                onClick={clearQueue}
                className="text-[9px] font-jakarta text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
              >
                <Trash2 size={10} /> Clear Queue
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-emerald-900/40">
              {queuedFiles.map(({ id, file, previewUrl }, idx) => (
                <div
                  key={id}
                  className="relative group shrink-0 w-24 h-24 rounded-lg overflow-hidden border border-emerald-800/40 bg-black/40"
                >
                  <img
                    src={previewUrl}
                    alt={file.name}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 flex flex-col justify-between p-1 opacity-90 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => removeQueuedFile(id)}
                      className="self-end bg-red-900/80 text-red-200 hover:bg-red-600 rounded-full p-0.5 transition-colors"
                      title="Remove image"
                    >
                      <XCircle size={11} />
                    </button>
                    <div>
                      <p className="font-grotesk text-[8px] text-gray-200 truncate font-semibold">
                        {idx + 1}. {file.name}
                      </p>
                      <p className="font-mono text-[7px] text-emerald-400">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Progress Bar & Status during processing */}
        {scanning && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="space-y-2 glass p-3 rounded-xl border border-emerald-600/40 bg-emerald-950/20"
          >
            <div className="flex items-center justify-between text-[10px] font-jakarta">
              <span className="text-emerald-300 font-bold flex items-center gap-2">
                <RefreshCw size={12} className="animate-spin text-emerald-400" />
                {scanStatusMsg || 'Processing Batch Photos...'}
              </span>
              <span className="font-mono text-emerald-400 font-bold">{uploadProgress}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-emerald-950/60 overflow-hidden border border-emerald-800/40">
              <motion.div
                className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300"
                initial={{ width: 0 }}
                animate={{ width: `${uploadProgress}%` }}
                transition={{ ease: 'easeOut', duration: 0.3 }}
              />
            </div>
          </motion.div>
        )}

        {/* Action Trigger Buttons */}
        {queuedFiles.length > 0 && !scanning && (
          <div className="flex gap-3">
            <motion.button
              id="ground-classify-btn"
              onClick={processBatch}
              disabled={scanning}
              whileHover={{ scale: 1.012, boxShadow: '0 0 30px rgba(52,211,153,0.35)' }}
              whileTap={{ scale: 0.985 }}
              className="flex-1 py-3 rounded-xl font-jakarta font-bold text-sm tracking-wide
                flex items-center justify-center gap-2 transition-all"
              style={{
                background: 'linear-gradient(135deg,#10B981,#059669,#047857)',
                boxShadow: '0 0 24px rgba(16,185,129,0.25)',
              }}
            >
              <Zap size={14} /> Process All ({queuedFiles.length} Photos)
            </motion.button>
            <button
              onClick={clearQueue}
              className="px-4 py-3 rounded-xl font-jakarta text-[10px] text-gray-500
                hover:text-gray-300 border border-gray-800 hover:border-gray-700 transition-all"
            >
              Cancel
            </button>
          </div>
        )}
      </motion.div>

      {/* Error display */}
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

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* Batch Results Display Table                                         */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {batchResults.length > 0 && (
        <motion.div variants={panelV} className="glass p-4 rounded-xl space-y-3 border border-emerald-900/30">
          
          {/* Summary metrics header */}
          <div className="flex items-center justify-between gap-3 flex-wrap border-b border-gray-800 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-400" />
              <div>
                <p className="font-jakarta text-[11px] font-bold text-emerald-300">
                  Batch Ingestion Results ({batchResults.length} records processed)
                </p>
                <p className="font-grotesk text-[8px] text-gray-500">
                  All occurrences synced with telemetry &amp; persisted to master database
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={exportBatchCSV}
                className="px-3 py-1.5 rounded-lg bg-emerald-900/30 hover:bg-emerald-800/40 border border-emerald-600/40 text-emerald-300 font-jakarta text-[9px] font-semibold flex items-center gap-1.5 transition-colors"
              >
                <FileSpreadsheet size={11} /> Export Batch CSV
              </button>
              <button
                onClick={() => setBatchResults([])}
                className="px-2.5 py-1.5 rounded-lg text-gray-600 hover:text-gray-400 text-[9px] font-jakarta transition-colors"
              >
                Clear Results
              </button>
            </div>
          </div>

          {/* Metric Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="glass p-2.5 rounded-xl text-center">
              <p className="font-jakarta text-[8px] text-gray-500 uppercase tracking-wider">Total Ingested</p>
              <p className="font-grotesk text-base font-bold text-emerald-300">{batchResults.length}</p>
            </div>
            <div className="glass p-2.5 rounded-xl text-center">
              <p className="font-jakarta text-[8px] text-gray-500 uppercase tracking-wider">Avg Softmax Confidence</p>
              <p className="font-grotesk text-base font-bold text-sky-300">
                {(
                  (batchResults.reduce((acc, r) => acc + (r.confidence_score ?? r.confidence ?? 0), 0) /
                    (batchResults.length || 1)) * 100
                ).toFixed(1)}%
              </p>
            </div>
            <div className="glass p-2.5 rounded-xl text-center">
              <p className="font-jakarta text-[8px] text-gray-500 uppercase tracking-wider">Mean Excess Green (ExG)</p>
              <p className="font-grotesk text-base font-bold text-amber-300">
                {(
                  batchResults.reduce((acc, r) => acc + (r.excess_green_index ?? r.exg_index ?? 0), 0) /
                  (batchResults.length || 1)
                ).toFixed(4)}
              </p>
            </div>
            <div className="glass p-2.5 rounded-xl text-center">
              <p className="font-jakarta text-[8px] text-gray-500 uppercase tracking-wider">Target Zone</p>
              <p className="font-grotesk text-xs font-bold text-emerald-200 mt-1">
                {FOCAL_ZONES.find(z => z.id === zone)?.label.split('—')[0] || zone}
              </p>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Filter results by filename or species..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-[#0D1321] border border-gray-800 rounded-lg pl-7 pr-3 py-1.5 text-[9px] font-grotesk text-gray-200 placeholder-gray-600 outline-none focus:border-emerald-500/50"
              />
            </div>
            <div className="flex items-center gap-1">
              {['ALL', 'ZONE_A', 'ZONE_B', 'ZONE_C'].map(z => (
                <button
                  key={z}
                  onClick={() => setFilterZone(z)}
                  className={`px-2.5 py-1 rounded-lg text-[8px] font-jakarta font-semibold transition-all ${
                    filterZone === z
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'text-gray-600 hover:text-gray-400 bg-white/5'
                  }`}
                >
                  {z}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable Results Table */}
          <div className="overflow-x-auto rounded-xl border border-gray-800/80 max-h-[420px] scrollbar-thin scrollbar-thumb-emerald-900/40">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#0D1321] sticky top-0 z-10 text-[8px] font-jakarta uppercase tracking-wider text-gray-500 border-b border-gray-800">
                <tr>
                  <th className="py-2.5 px-3"># / Status</th>
                  <th className="py-2.5 px-3">Specimen Filename</th>
                  <th className="py-2.5 px-3">Predicted Taxa / Species</th>
                  <th className="py-2.5 px-3">Zone</th>
                  <th className="py-2.5 px-3">Softmax Conf.</th>
                  <th className="py-2.5 px-3">ExG Index</th>
                  <th className="py-2.5 px-3">Matched Microclimate Context</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60 font-grotesk text-[10px]">
                {filteredResults.map((r, idx) => {
                  const conf = r.confidence_score ?? r.confidence ?? 0;
                  const exg = r.excess_green_index ?? r.exg_index ?? null;
                  const taxa = r.species_prediction ?? r.predicted_class ?? 'Unclassified';
                  const pt = r.paired_telemetry || r.environmental_telemetry_snapshot || {};
                  const isOk = r.status !== 'error';

                  return (
                    <tr key={r.image_id || idx} className="hover:bg-white/[0.02] transition-colors">
                      {/* # / Status */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {isOk ? (
                            <CheckCircle2 size={12} className="text-emerald-400" />
                          ) : (
                            <XCircle size={12} className="text-red-400" />
                          )}
                          <span className="font-mono text-[9px] text-gray-500">{idx + 1}</span>
                        </div>
                      </td>

                      {/* Specimen Filename */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Camera size={11} className="text-gray-500 shrink-0" />
                          <span className="font-mono text-gray-200 font-semibold truncate max-w-[140px]">
                            {r.filename || r.original_filename || 'image.jpg'}
                          </span>
                        </div>
                      </td>

                      {/* Predicted Taxa */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div>
                          <p className="font-jakarta text-emerald-200 font-semibold truncate max-w-[180px]">
                            {taxa}
                          </p>
                          {r.taxonomy && (r.taxonomy.Family || r.taxonomy.family) && (
                            <p className="font-grotesk text-[8px] text-gray-500 italic">
                              {r.taxonomy.Family || r.taxonomy.family}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Zone */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <FocalZoneBadge zoneId={r.focal_zone || zone} />
                      </td>

                      {/* Softmax Confidence */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                            <div
                              className="h-full bg-sky-400"
                              style={{ width: `${Math.min(100, Math.round(conf * 100))}%` }}
                            />
                          </div>
                          <span className="font-mono text-[9px] text-sky-300 font-bold">
                            {(conf * 100).toFixed(1)}%
                          </span>
                        </div>
                      </td>

                      {/* ExG Index */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {exg != null ? (
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                              exg > 0
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/40'
                                : 'bg-red-950 text-red-300 border border-red-700/40'
                            }`}
                          >
                            {exg >= 0 ? `+${exg.toFixed(4)}` : exg.toFixed(4)}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>

                      {/* Matched Microclimate Context */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {(pt.temperature != null || pt.temperature_c != null) && (
                            <span className="bg-orange-950/50 border border-orange-700/30 text-orange-300 text-[8px] px-1.5 py-0.5 rounded font-mono">
                              🌡️ {Number(pt.temperature ?? pt.temperature_c).toFixed(1)}°C
                            </span>
                          )}
                          {(pt.humidity != null || pt.humidity_percent != null) && (
                            <span className="bg-sky-950/50 border border-sky-700/30 text-sky-300 text-[8px] px-1.5 py-0.5 rounded font-mono">
                              💧 {Number(pt.humidity ?? pt.humidity_percent).toFixed(1)}%
                            </span>
                          )}
                          {(pt.light != null || pt.light_lux != null) && (
                            <span className="bg-amber-950/50 border border-amber-700/30 text-amber-300 text-[8px] px-1.5 py-0.5 rounded font-mono">
                              ☀️ {Number(pt.light ?? pt.light_lux).toFixed(0)}lx
                            </span>
                          )}
                          {(pt.sound != null || pt.sound_db != null) && (
                            <span className="bg-emerald-950/50 border border-emerald-700/30 text-emerald-300 text-[8px] px-1.5 py-0.5 rounded font-mono">
                              🔊 {Number(pt.sound ?? pt.sound_db).toFixed(0)}dB
                            </span>
                          )}
                          {!Object.keys(pt).length && (
                            <span className="text-gray-600 text-[8px] italic">Baseline Interpolated</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Live micro-climate context banner when no batch results yet */}
      {batchResults.length === 0 && latestReading && (
        <motion.div variants={panelV} className="glass p-4 rounded-xl border border-emerald-900/20 space-y-2">
          <p className="font-jakarta text-[9px] text-gray-600 uppercase tracking-widest flex items-center gap-1.5">
            <Activity size={10} className="text-emerald-500" />Live Micro-Climate Baseline (latest ESP32 telemetry)
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
  const [fusedCount,  setFusedCount] = useState(0);
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

  const fetchFusedStats = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/ground-image/stats`);
      if (r.ok) {
        const d = await r.json();
        setFusedCount(d.total_records || 0);
      } else {
        const r2 = await fetch(`${API}/api/ground-image/records?limit=1000`);
        if (r2.ok) {
          const d2 = await r2.json();
          setFusedCount(d2.length || 0);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchHealth(); fetchHardware(); fetchReadings(); fetchFusedStats();
    const id   = setInterval(() => { fetchHealth(); fetchHardware(); fetchReadings(); fetchFusedStats(); }, POLL_MS);
    const hwId = setInterval(fetchHardware, 5000);
    return () => { clearInterval(id); clearInterval(hwId); };
  }, [fetchHealth, fetchHardware, fetchReadings, fetchFusedStats]);

  const refreshAll = useCallback(() => {
    fetchHealth(); fetchHardware(); fetchReadings(); fetchFusedStats();
  }, [fetchHealth, fetchHardware, fetchReadings, fetchFusedStats]);

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
              <Icon size={11} className="shrink-0" />
              <span className="flex-1 truncate">{label}</span>
              {id === 'fused' && (
                <span className="ml-auto bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-full">
                  {fusedCount}
                </span>
              )}
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
              <Icon size={10} />
              <span>{label}</span>
              {id === 'fused' && (
                <span className="bg-emerald-500/30 text-emerald-300 text-[8px] font-mono px-1 rounded-full">
                  {fusedCount}
                </span>
              )}
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
