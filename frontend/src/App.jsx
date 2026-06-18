/**
 * UNIBEN Biodiversity Pipeline — Premium React Dashboard v4
 *
 * Tab 1 — Live Telemetry   : 6-param metric cards + sparklines + provenance toggle
 * Tab 2 — Field Sync Hub   : ENGAGE PIPELINE ENGINE + Excel download
 * Tab 3 — Field Media      : Aerial Context Frame + Batch Ground + SD Card Contingency
 *
 * Six parameters streamed from ESP32 + browser geolocation:
 *   Temperature (°C) · Humidity (%) · Pressure (hPa) · Light (Lux) · Sound (dB) · Altitude (m)
 *
 * Domain 2: Manual Override tab completely removed.
 * Domain 3: navigator.geolocation auto-captured; WebSocket /ws/telemetry client integrated.
 * Domain 4: SD Card Contingency drop zone added to Field Media tab.
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Thermometer, Droplets, Gauge, Sun, Volume2, Mountain,
  Activity, RefreshCw, CheckCircle2, XCircle,
  Wifi, WifiOff, Cpu, Database, UploadCloud,
  BarChart2, Zap, Filter, ChevronRight, Download,
  Camera, ImagePlus, FlaskConical, Layers,
  HardDrive, MapPin, AlertTriangle,
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, Tooltip } from 'recharts';

/* ─────────────────────────────────────────────────────────────────────────── */
const API     = 'http://127.0.0.1:8000';
const WS_URL  = 'ws://127.0.0.1:8000/ws/telemetry';
const POLL_MS = 2500;

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Framer-motion variants                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

const panelV = {
  hidden:  { opacity: 0, y: 18, scale: 0.97 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring', stiffness: 200, damping: 22 },
  },
};
const stagger = { visible: { transition: { staggerChildren: 0.06 } } };

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Recharts custom tooltip                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

function SparkTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass px-2 py-1 text-[10px] font-grotesk text-emerald-300">
      {Number(payload[0].value).toFixed(2)}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Metric definitions — 6 parameters                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

const METRICS = [
  { key: 'temperature_c',    label: 'Temperature', unit: '°C',  Icon: Thermometer, color: '#f97316' },
  { key: 'humidity_percent', label: 'Humidity',    unit: '%',   Icon: Droplets,    color: '#38bdf8' },
  { key: 'pressure_hPa',     label: 'Pressure',    unit: ' hPa',Icon: Gauge,       color: '#a78bfa' },
  { key: 'light_lux',        label: 'Light',       unit: ' Lux',Icon: Sun,         color: '#fbbf24' },
  { key: 'sound_db',         label: 'Sound',       unit: ' dB', Icon: Volume2,     color: '#34d399' },
  { key: 'altitude_m',       label: 'Altitude',    unit: ' m',  Icon: Mountain,    color: '#2dd4bf' },
];

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Metric card + sparkline                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

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
            <Line
              type="monotone"
              dataKey="value"
              dot={false}
              strokeWidth={1.5}
              stroke={color}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Provenance Filter Toggle — Tab 1                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

const PROVENANCE_MODES = [
  { id: 'ALL',           label: 'All Sources',     icon: Layers },
  { id: 'LIVE_ESP32',    label: 'Live ESP32',       icon: Wifi },
  { id: 'ESP32_SD_CARD', label: 'SD Card Import',   icon: HardDrive },
];

function ProvenanceToggle({ mode, onChange }) {
  return (
    <motion.div
      variants={panelV}
      className="glass flex items-center gap-1 p-1 rounded-xl w-full"
    >
      <Filter size={11} className="text-emerald-600 ml-2 shrink-0" />
      <span className="font-jakarta text-[9px] uppercase tracking-widest text-gray-600 mr-2">
        Data Source
      </span>
      {PROVENANCE_MODES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-jakarta
            transition-all duration-200 flex-1 justify-center
            ${mode === id
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : 'text-gray-600 hover:text-gray-400 hover:bg-white/5'
            }`}
        >
          <Icon size={10} />
          {label}
        </button>
      ))}
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Source badge helper                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

function SourceBadge({ source }) {
  const s = source || 'LIVE_ESP32';
  const cfg = {
    LIVE_ESP32:    { cls: 'bg-emerald-900/30 text-emerald-400',  label: 'ESP32' },
    ESP32_SD_CARD: { cls: 'bg-sky-900/30 text-sky-400',          label: 'SD CARD' },
    MANUAL_OVERRIDE: { cls: 'bg-orange-900/30 text-orange-400',  label: 'MANUAL' },
  }[s] ?? { cls: 'bg-gray-800 text-gray-400', label: s };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Tab 1 — Live Telemetry Dashboard                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

function TelemetryTab({ readings, histories, geoCoords, wsState }) {
  const [provenance, setProvenance] = useState('ALL');

  const filtered = provenance === 'ALL'
    ? readings
    : readings.filter(r => (r.data_source || 'LIVE_ESP32') === provenance);

  const latest = filtered[0] ?? readings[0] ?? null;

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-3">
      {/* Geolocation + WebSocket status bar */}
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
            {wsState === 'open' ? 'WS Live' : 'WS Offline'}
          </span>
        </span>
      </motion.div>

      {/* Provenance toggle */}
      <ProvenanceToggle mode={provenance} onChange={setProvenance} />

      {/* 6-Param Metric tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {METRICS.map(m => (
          <MetricCard
            key={m.key}
            metric={m}
            value={latest ? latest[m.key] : null}
            history={(histories[m.key] || []).map(v => ({ value: v }))}
          />
        ))}
      </div>

      {/* Readings table */}
      {filtered.length > 0 ? (
        <motion.div variants={panelV} className="glass p-4 overflow-x-auto">
          <p className="font-jakarta text-[9px] text-gray-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <Activity size={10} className="text-emerald-500" />
            Recent Sensor Packets
            <span className="ml-auto text-gray-700">
              {filtered.length} record{filtered.length !== 1 ? 's' : ''}
              {provenance !== 'ALL' && ` · ${provenance}`}
            </span>
          </p>
          <table className="w-full text-[10px] font-grotesk border-collapse">
            <thead>
              <tr className="text-gray-600 border-b border-emerald-900/20">
                {['Timestamp','Source','Temp','Humidity','Pressure','Light','Sound','Altitude','Device'].map(h => (
                  <th key={h} className="text-left py-1.5 pr-4 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 40).map(r => (
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
          <Activity size={30} className="text-emerald-900 mx-auto mb-2" />
          <p className="text-gray-600 font-jakarta text-sm">
            No sensor readings match the selected filter.
          </p>
        </motion.div>
      )}

      {/* Analytics panel */}
      <div className="pt-1">
        <AnalyticsPanel />
      </div>
    </motion.div>
  );
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
  { src: '/analytics/sensor_correlations.png',  title: '6-Parameter Sensor Correlation Matrix',
    desc: 'Pearson coefficients · auto-refresh 5 min' },
  { src: '/analytics/biodiversity_density.png', title: 'Biodiversity Encounter Density',
    desc: 'KDE distribution + observation frequency' },
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
      <div className="relative rounded-xl overflow-hidden bg-[#0B0F19] border border-emerald-900/20"
        style={{ minHeight: 160 }}>
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
          <img src={`${src}?v=${bust}`} alt={title}
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
        {ANALYTICS_PLOTS.map(p => (
          <AnalyticsPlotCard key={p.src} {...p} bust={bust} />
        ))}
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Tab 2 — Field Telemetry Sync Hub (replaces Manual Override)               */
/* ─────────────────────────────────────────────────────────────────────────── */

function SDSyncTab({ onPipelineComplete }) {
  const [running,   setRunning]   = useState(false);
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState('');

  const engage = useCallback(async () => {
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const res  = await fetch(`${API}/api/v1/analytics/run-pipeline`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
      const data = await res.json();
      setResult(data);
      onPipelineComplete?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }, [onPipelineComplete]);

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-4">

      {/* Header banner */}
      <motion.div variants={panelV} className="glass p-4 flex items-center gap-3">
        <Database size={16} className="text-emerald-400 shrink-0" />
        <div>
          <p className="font-jakarta text-[11px] font-semibold text-emerald-300">
            Field Telemetry Sync Hub
          </p>
          <p className="font-grotesk text-[9px] text-gray-600 mt-0.5">
            Trigger the data science analytics engine · generate 4-sheet styled Excel · export dataset
          </p>
        </div>
      </motion.div>

      {/* ENGAGE ENGINE button */}
      <motion.div variants={panelV}>
        <motion.button
          id="engage-pipeline-btn"
          onClick={engage}
          disabled={running}
          whileHover={{ scale: running ? 1 : 1.015, boxShadow: '0 0 40px rgba(52,211,153,0.35)' }}
          whileTap={{ scale: 0.98 }}
          className="w-full py-4 rounded-2xl font-jakarta font-bold text-sm tracking-wide
            flex items-center justify-center gap-3 transition-all duration-300
            disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: running
              ? 'linear-gradient(135deg, #064E3B, #065F46)'
              : 'linear-gradient(135deg, #10B981, #059669, #047857)',
            boxShadow: running ? 'none' : '0 0 30px rgba(16,185,129,0.25)',
          }}
        >
          {running ? (
            <><RefreshCw size={16} className="animate-spin" />Running Pipeline Engine…</>
          ) : (
            <><Zap size={16} />🔥 ENGAGE DATA SCIENTIST PIPELINE ENGINE</>
          )}
        </motion.button>
      </motion.div>

      {/* Error state */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="glass border border-red-700/40 p-3 rounded-xl flex items-start gap-2"
          >
            <XCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
            <p className="font-grotesk text-[10px] text-red-300">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pipeline execution result */}
      <AnimatePresence>
        {result && (
          <motion.div
            variants={stagger} initial="hidden" animate="visible" exit={{ opacity: 0 }}
            className="space-y-3"
          >
            {/* Status bar */}
            <motion.div variants={panelV}
              className="glass border border-emerald-600/30 p-3 rounded-xl flex items-center gap-2"
            >
              <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
              <p className="font-jakarta text-[10px] text-emerald-300 font-semibold">
                Pipeline complete · session <code className="text-gray-400">{result.session_id?.slice(0, 16)}…</code>
              </p>
              {result.anomaly_count > 0 && (
                <span className="flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-amber-900/30 border border-amber-600/30 text-amber-300 text-[9px] font-jakarta">
                  <AlertTriangle size={9} />
                  {result.anomaly_count} anomaly{result.anomaly_count !== 1 ? 's' : ''}
                </span>
              )}
              {result.excel_download_url && (
                <a
                  href={`${API}${result.excel_download_url}`}
                  target="_blank" rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 font-jakarta text-[9px] text-emerald-400
                    border border-emerald-600/30 px-2 py-1 rounded-lg hover:bg-emerald-900/20 transition-colors"
                >
                  <Download size={10} /> Download 4-Sheet Excel
                </a>
              )}
            </motion.div>

            {/* Messages log */}
            <motion.div variants={panelV} className="glass p-3 rounded-xl space-y-1">
              <p className="font-jakarta text-[9px] text-gray-600 uppercase tracking-widest mb-2">
                Execution Log
              </p>
              {(result.messages || []).map((msg, i) => (
                <div key={i} className="flex items-start gap-2">
                  <ChevronRight size={10} className="text-emerald-700 mt-0.5 shrink-0" />
                  <p className="font-grotesk text-[10px] text-gray-400">{msg}</p>
                </div>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Excel Download Gateway */}
      <motion.div variants={panelV} className="glass p-4 rounded-xl border border-emerald-900/30">
        <p className="font-jakarta text-[9px] text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
          <Download size={10} className="text-emerald-500" />
          .XLSX DB Snapshot Gateway
        </p>
        <a
          href={`${API}/api/v1/reports/export-excel?session_id=all`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-jakarta text-[10px] font-bold
            border border-emerald-700/40 text-emerald-300 hover:bg-emerald-900/20 transition-colors"
        >
          <Download size={12} />
          Download Full 4-Sheet Excel Workbook
        </a>
      </motion.div>

    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Tab 3 — Field Media & Mapping Workspace                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

function useDragDrop(onFile) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef(null);

  const onDragOver  = e => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop      = useCallback(e => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  }, [onFile]);
  const onInput = useCallback(e => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  }, [onFile]);

  return { ref, dragging, onDragOver, onDragLeave, onDrop, onInput };
}

function ImageDropZone({ label, subtitle, icon: Icon, file, preview, onFile, accentColor }) {
  const dd = useDragDrop(onFile);

  return (
    <motion.div variants={panelV} className="glass p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon size={13} style={{ color: accentColor }} />
        <div>
          <p className="font-jakarta text-[11px] font-semibold" style={{ color: accentColor }}>
            {label}
          </p>
          <p className="font-grotesk text-[9px] text-gray-600">{subtitle}</p>
        </div>
      </div>
      <div
        ref={dd.ref}
        onDragOver={dd.onDragOver}
        onDragLeave={dd.onDragLeave}
        onDrop={dd.onDrop}
        onClick={() => dd.ref.current?.querySelector('input')?.click()}
        className="relative rounded-xl border-2 border-dashed cursor-pointer
          flex flex-col items-center justify-center gap-2 p-6
          transition-all duration-300"
        style={{
          borderColor: dd.dragging ? accentColor : `${accentColor}44`,
          background:  dd.dragging ? `${accentColor}11` : 'transparent',
          minHeight:   preview ? 'auto' : 140,
        }}
      >
        <input type="file" accept="image/*" className="hidden" onChange={dd.onInput} />
        {preview ? (
          <div className="w-full">
            <img src={preview} alt={label} className="w-full rounded-lg object-contain max-h-52" />
            <p className="font-grotesk text-[9px] text-gray-600 text-center mt-2 truncate">{file?.name}</p>
          </div>
        ) : (
          <>
            <UploadCloud size={26} style={{ color: accentColor, opacity: 0.5 }} />
            <p className="font-jakarta text-[10px] text-gray-600 text-center">Drag &amp; drop or click to select</p>
            <p className="font-grotesk text-[9px] text-gray-700 text-center">JPG · PNG · TIFF · WebP</p>
          </>
        )}
      </div>
    </motion.div>
  );
}

/* ── SD Card Contingency Upload Zone ─────────────────────────────────────── */

function SDCardDropZone() {
  const [sdFile,    setSDFile]    = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState('');
  const [dragging,  setDragging]  = useState(false);
  const inputRef = useRef(null);

  const handleFile = useCallback(file => {
    setSDFile(file);
    setResult(null);
    setError('');
  }, []);

  const onDragOver  = e => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop      = useCallback(e => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const upload = useCallback(async () => {
    if (!sdFile) return;
    setUploading(true);
    setError('');
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', sdFile);
      const res = await fetch(`${API}/api/telemetry/upload-contingency`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
      setResult(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }, [sdFile]);

  return (
    <motion.div variants={panelV} className="glass p-4 flex flex-col gap-3"
      style={{ border: '1px solid rgba(245,158,11,0.25)' }}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <HardDrive size={13} className="text-amber-400" />
        <div>
          <p className="font-jakarta text-[11px] font-semibold text-amber-400">
            🗃️ SD Card Contingency Upload
          </p>
          <p className="font-grotesk text-[9px] text-gray-600">
            Ingest raw ESP32 SD card CSV/TXT log · idempotent — duplicates silently skipped
          </p>
        </div>
        <span className="ml-auto font-grotesk text-[9px] text-amber-400 bg-amber-900/20
          border border-amber-700/30 px-2 py-0.5 rounded-full">
          ESP32_SD_CARD
        </span>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className="rounded-xl border-2 border-dashed cursor-pointer
          flex flex-col items-center justify-center gap-2 p-6 transition-all duration-300"
        style={{
          borderColor: dragging ? '#f59e0b' : 'rgba(245,158,11,0.3)',
          background:  dragging ? 'rgba(245,158,11,0.08)' : 'transparent',
          minHeight:   120,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {sdFile ? (
          <div className="text-center">
            <HardDrive size={22} className="text-amber-400 mx-auto mb-1" />
            <p className="font-grotesk text-[10px] text-amber-300 font-semibold">{sdFile.name}</p>
            <p className="font-grotesk text-[9px] text-gray-600 mt-0.5">
              {(sdFile.size / 1024).toFixed(1)} KB
            </p>
          </div>
        ) : (
          <>
            <HardDrive size={26} className="text-amber-500 opacity-50" />
            <p className="font-jakarta text-[10px] text-gray-600 text-center">Drop ESP32 log file here</p>
            <p className="font-grotesk text-[9px] text-gray-700 text-center">.CSV · .TXT</p>
          </>
        )}
      </div>

      {/* Upload button */}
      {sdFile && (
        <motion.button
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          onClick={upload}
          disabled={uploading}
          className="w-full py-2.5 rounded-xl font-jakarta font-bold text-[11px] tracking-wide
            flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
          style={{
            background: uploading
              ? 'linear-gradient(135deg, #78350f, #92400e)'
              : 'linear-gradient(135deg, #d97706, #b45309, #92400e)',
            boxShadow: uploading ? 'none' : '0 0 20px rgba(217,119,6,0.25)',
          }}
        >
          {uploading
            ? <><RefreshCw size={13} className="animate-spin" />Parsing SD Log…</>
            : <><UploadCloud size={13} />Ingest SD Card Log</>
          }
        </motion.button>
      )}

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="glass border border-red-700/40 p-2 rounded-xl flex items-center gap-2">
            <XCircle size={11} className="text-red-400 shrink-0" />
            <p className="font-grotesk text-[10px] text-red-300">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result card */}
      <AnimatePresence>
        {result && (
          <motion.div
            variants={panelV} initial="hidden" animate="visible" exit={{ opacity: 0 }}
            className="glass border border-amber-700/30 p-3 rounded-xl space-y-2"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 size={12} className="text-amber-400" />
              <p className="font-jakarta text-[10px] font-semibold text-amber-300">SD Card Import Complete</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Parsed',   value: result.rows_parsed,   color: 'text-gray-300' },
                { label: 'Inserted', value: result.rows_inserted, color: 'text-emerald-300' },
                { label: 'Skipped',  value: result.rows_skipped,  color: 'text-amber-300' },
              ].map(({ label, value, color }) => (
                <div key={label} className="glass p-2 rounded-lg text-center">
                  <p className={`font-grotesk text-base font-bold ${color}`}>{value}</p>
                  <p className="font-jakarta text-[8px] text-gray-600 uppercase tracking-widest">{label}</p>
                </div>
              ))}
            </div>
            {result.errors?.length > 0 && (
              <details className="mt-1">
                <summary className="font-jakarta text-[9px] text-amber-600 cursor-pointer">
                  {result.errors.length} row warning{result.errors.length !== 1 ? 's' : ''}
                </summary>
                <div className="mt-1 space-y-0.5 max-h-28 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <p key={i} className="font-grotesk text-[8px] text-gray-600">{e}</p>
                  ))}
                </div>
              </details>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Field Media Tab ─────────────────────────────────────────────────────── */

function FieldMediaTab({ onSessionCreated }) {
  const [droneFile,    setDroneFile]    = useState(null);
  const [dronePreview, setDronePreview] = useState(null);
  const [campusZone,   setCampusZone]   = useState('Zone 1');
  const [groundFiles,  setGroundFiles]  = useState([]);
  const [uploading,    setUploading]    = useState(false);
  const [result,       setResult]       = useState(null);
  const [error,        setError]        = useState('');

  const handleDroneDrop = useCallback(file => {
    setDroneFile(file);
    setDronePreview(URL.createObjectURL(file));
  }, []);

  const handleGroundDrop = useCallback(e => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || e.target.files || []);
    setGroundFiles(prev => [...prev, ...files]);
  }, []);

  const removeGroundFile = useCallback(idx => {
    setGroundFiles(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const submit = useCallback(async () => {
    if (!droneFile && groundFiles.length === 0) {
      setError('Drop at least one aerial frame or ground images before submitting.');
      return;
    }
    setUploading(true);
    setError('');
    setResult(null);
    try {
      let droneId = null;
      if (droneFile) {
        const droneFd = new FormData();
        droneFd.append('drone_file', droneFile);
        droneFd.append('campus_zone', campusZone);
        const droneRes = await fetch(`${API}/api/v1/upload-drone-patch`, { method: 'POST', body: droneFd });
        if (!droneRes.ok) throw new Error(`Drone upload HTTP ${droneRes.status}`);
        const droneData = await droneRes.json();
        droneId = droneData.drone_id;
      }

      let groundData = null;
      if (groundFiles.length > 0) {
        const groundFd = new FormData();
        if (droneId) groundFd.append('drone_id', droneId);
        groundFd.append('observer_id', 'System');
        groundFiles.forEach(f => groundFd.append('ground_files', f));
        const groundRes = await fetch(`${API}/api/v1/upload-ground-batch`, { method: 'POST', body: groundFd });
        if (!groundRes.ok) throw new Error(`Ground upload HTTP ${groundRes.status}`);
        groundData = await groundRes.json();
      }

      setResult({ droneId, groundResults: groundData?.results });
      onSessionCreated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }, [droneFile, groundFiles, campusZone, onSessionCreated]);

  const reset = useCallback(() => {
    setDroneFile(null); setDronePreview(null);
    setGroundFiles([]); setResult(null); setError('');
  }, []);

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-4">
      <motion.div variants={panelV} className="flex items-center gap-2">
        <ImagePlus size={12} className="text-emerald-500" />
        <span className="font-jakarta text-[9px] text-gray-600 uppercase tracking-widest">
          Field Media &amp; Spatial Mapping Workspace
        </span>
      </motion.div>

      {/* ── Aerial Frame + Ground Batch (UNTOUCHED) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Drone Image & Zone */}
        <div className="lg:col-span-1 space-y-4">
          <ImageDropZone
            label="Aerial Context Frame"
            subtitle="Drop a single drone map"
            icon={Camera}
            file={droneFile}
            preview={dronePreview}
            onFile={handleDroneDrop}
            accentColor="#34d399"
          />
          <motion.div variants={panelV} className="glass p-4 space-y-2">
            <label className="font-jakarta text-[9px] text-gray-500 uppercase tracking-wider">Campus Zone</label>
            <select
              value={campusZone} onChange={e => setCampusZone(e.target.value)}
              className="w-full bg-white/5 border border-emerald-900/30 rounded-lg px-3 py-2 text-[11px] font-grotesk focus:outline-none"
            >
              {[...Array(10)].map((_, i) => (
                <option key={i} value={`Zone ${i + 1}`} className="bg-[#0B0F19]">Zone {i + 1}</option>
              ))}
            </select>
          </motion.div>
        </div>

        {/* Right: Ground Batch */}
        <div className="lg:col-span-2">
          <motion.div variants={panelV} className="glass p-4 h-full flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <FlaskConical size={13} className="text-orange-400" />
              <div>
                <p className="font-jakarta text-[11px] font-semibold text-orange-400">Batch Ground Taxon Capture</p>
                <p className="font-grotesk text-[9px] text-gray-600">Upload multiple ground images · PlantNet taxonomy runs in background</p>
              </div>
            </div>

            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleGroundDrop}
              className="flex-1 rounded-xl border-2 border-dashed border-orange-500/40 bg-orange-500/5
                flex flex-col items-center justify-center gap-2 p-6 cursor-pointer hover:bg-orange-500/10 transition-colors"
              onClick={() => document.getElementById('batch-upload').click()}
            >
              <input id="batch-upload" type="file" multiple accept="image/*" className="hidden" onChange={handleGroundDrop} />
              <UploadCloud size={26} className="text-orange-400 opacity-50" />
              <p className="font-jakarta text-[10px] text-gray-600">Drop multiple images here</p>
            </div>

            {groundFiles.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mt-2">
                {groundFiles.map((f, i) => (
                  <div key={i} className="relative aspect-square rounded-lg border border-emerald-900/30 overflow-hidden group">
                    <img src={URL.createObjectURL(f)} className="w-full h-full object-cover" />
                    <button onClick={() => removeGroundFile(i)}
                      className="absolute top-1 right-1 bg-red-500/80 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100">
                      <XCircle size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </div>

      {/* Submit / Clear buttons */}
      <motion.div variants={panelV} className="flex gap-3">
        <motion.button
          onClick={submit} disabled={uploading || (!droneFile && groundFiles.length === 0)}
          className="flex-1 py-3 rounded-xl font-jakarta font-bold text-sm tracking-wide flex items-center justify-center gap-2 disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #10B981, #047857)', boxShadow: '0 0 20px rgba(16,185,129,0.2)' }}
        >
          {uploading ? <><RefreshCw size={14} className="animate-spin" />Processing Batch…</> : <><UploadCloud size={14} />Submit Dual-View Data</>}
        </motion.button>
        {(droneFile || groundFiles.length > 0 || result) && (
          <button onClick={reset} className="px-4 py-3 rounded-xl glass border border-emerald-900/30 font-jakarta text-[10px] text-gray-500 hover:text-gray-300">Clear</button>
        )}
      </motion.div>

      {/* Image upload result */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="glass border border-red-700/40 p-3 rounded-xl flex items-start gap-2">
            <XCircle size={12} className="text-red-400 mt-0.5" />
            <p className="font-grotesk text-[10px] text-red-300">{error}</p>
          </motion.div>
        )}
        {result && (
          <motion.div variants={panelV} className="glass border border-emerald-600/30 p-4 rounded-xl space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={13} className="text-emerald-400" />
              <p className="font-jakarta text-[10px] font-semibold text-emerald-300">Upload Complete</p>
              <code className="ml-auto font-grotesk text-[9px] text-gray-600">Drone ID: {result.droneId || 'N/A'}</code>
            </div>
            {result.groundResults && (
              <div className="grid grid-cols-1 gap-2 pt-1">
                {result.groundResults.map((r, i) => (
                  <div key={i} className="glass p-2 rounded-lg flex items-center justify-between">
                    <p className="font-grotesk text-[10px] text-gray-400">{r.file}</p>
                    {r.status === 'success' ? (
                      <p className="font-jakarta text-[10px] text-emerald-400">
                        {r.inference?.predicted_label || 'Unclassified'} ({((r.inference?.confidence || 0) * 100).toFixed(1)}%)
                      </p>
                    ) : (
                      <p className="font-jakarta text-[10px] text-red-400">Error</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── SD Card Contingency Upload (visually distinct) ── */}
      <div className="pt-2">
        <SDCardDropZone />
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Report Footer — email dispatch                                             */
/* ─────────────────────────────────────────────────────────────────────────── */

function ReportFooter() {
  const [email,   setEmail]   = useState('');
  const [sending, setSending] = useState(false);
  const [msgStatus, setMsgStatus] = useState('');

  const sendEmail = async () => {
    if (!email) return;
    setSending(true);
    setMsgStatus('');
    try {
      const res = await fetch(`${API}/api/v1/reports/share-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, attach_excel: true, attach_pdf: false }),
      });
      setMsgStatus(res.ok ? 'Email queued for delivery.' : 'Failed to send.');
    } catch {
      setMsgStatus('Network error.');
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div variants={panelV} className="mt-6 p-4 rounded-2xl glass border border-emerald-900/40">
      <div className="flex flex-col md:flex-row items-center gap-4 justify-between">
        <div>
          <h3 className="font-jakarta text-xs font-bold text-emerald-400 flex items-center gap-2">
            <Download size={14} /> Academic Research Reporting &amp; Data Export Gateway
          </h3>
          <p className="text-[10px] text-gray-500 mt-1">Export linked spatial, taxonomical, and telemetry data.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex border border-emerald-800/40 rounded-lg overflow-hidden h-8">
            <input
              type="email" placeholder="Researcher Email" value={email} onChange={e => setEmail(e.target.value)}
              className="bg-black/20 text-[10px] px-3 w-48 focus:outline-none text-emerald-100 placeholder-gray-600"
            />
            <button
              onClick={sendEmail} disabled={sending || !email}
              className="bg-emerald-800/40 hover:bg-emerald-700/60 px-4 text-[10px] font-bold text-emerald-200 transition-colors disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send Mail'}
            </button>
          </div>
        </div>
      </div>
      {msgStatus && <p className="text-[10px] text-emerald-500 mt-2 text-right">{msgStatus}</p>}
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Sidebar status pill                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

function Pill({ ok, label }) {
  return (
    <div className="flex items-center gap-1.5">
      {ok ? <CheckCircle2 size={10} className="text-emerald-400" /> : <XCircle size={10} className="text-red-500" />}
      <span className={`font-jakarta text-[10px] ${ok ? 'text-emerald-400' : 'text-red-500'}`}>{label}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Tab bar — 3 tabs (Manual Override removed)                                */
/* ─────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'telemetry', label: 'Live Telemetry',         icon: Activity },
  { id: 'sync',      label: 'Field Sync Hub',          icon: Database },
  { id: 'media',     label: 'Field Media & Mapping',   icon: Camera },
];

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Root App                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

export default function App() {
  const [activeTab,  setActiveTab]  = useState('telemetry');
  const [health,     setHealth]     = useState(null);
  const [hardware,   setHardware]   = useState(null);
  const [readings,   setReadings]   = useState([]);
  const [histories,  setHistories]  = useState({});
  const [geoCoords,  setGeoCoords]  = useState(null);
  const [wsState,    setWsState]    = useState('closed');
  const wsRef = useRef(null);

  /* ── Browser geolocation — auto-acquired on mount ─────────────────────── */
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      pos => {
        setGeoCoords({
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
          altitude:  pos.coords.altitude,
          accuracy:  pos.coords.accuracy,
        });
      },
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
        ws.onclose = () => {
          setWsState('closed');
          reconnectTimer = setTimeout(connect, 5000);
        };
        ws.onerror = () => ws.close();
        ws.onmessage = () => {
          // ACK received — triggers a poll to refresh readings table
          fetchReadings();
        };
      } catch {
        reconnectTimer = setTimeout(connect, 5000);
      }
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Polling ──────────────────────────────────────────────────────────── */
  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch(`${API}/health`);
      if (r.ok) setHealth(await r.json());
      else      setHealth(null);
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
          const vals = data.slice(0, 20).map(row => row[key]).filter(v => v != null).reverse();
          next[key] = vals;
        });
        return next;
      });
    } catch {}
  }, []);

  const fetchHardware = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/hardware/status`);
      if (r.ok) setHardware(await r.json());
      else      setHardware(null);
    } catch { setHardware(null); }
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchHardware();
    fetchReadings();
    const id   = setInterval(() => { fetchHealth(); fetchHardware(); fetchReadings(); }, POLL_MS);
    const hwId = setInterval(fetchHardware, 5000);
    return () => { clearInterval(id); clearInterval(hwId); };
  }, [fetchHealth, fetchHardware, fetchReadings]);

  const refreshAll = useCallback(() => {
    fetchHealth(); fetchHardware(); fetchReadings();
  }, [fetchHealth, fetchHardware, fetchReadings]);

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-[#0B0F19] text-gray-100 font-grotesk flex">

      {/* ── Sidebar ── */}
      <aside className="hidden lg:flex flex-col w-52 shrink-0 border-r border-emerald-900/20
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
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-jakarta
                text-left transition-all duration-200
                ${activeTab === id
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                  : 'text-gray-600 hover:text-gray-400 hover:bg-white/5'
                }`}
            >
              <Icon size={11} />
              {label}
            </button>
          ))}
        </nav>

        {/* Hardware Status Badge */}
        <div className="mt-auto">
          {hardware?.status === 'connected' ? (
            <div className="glass flex items-center gap-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-900/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
              <div className="relative flex items-center justify-center w-3 h-3">
                <span className="absolute inline-flex w-full h-full rounded-full opacity-75 bg-emerald-400 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
              </div>
              <span className="font-jakarta text-[10px] text-emerald-300 font-bold uppercase tracking-wider">
                📡 ESP32 Live Connected
              </span>
            </div>
          ) : (
            <div className="glass flex items-center gap-3 p-3 rounded-xl border border-red-500/30 bg-red-900/20 animate-pulse" style={{ animationDuration: '3s' }}>
              <XCircle size={12} className="text-red-500" />
              <span className="font-jakarta text-[10px] text-red-400 font-bold uppercase tracking-wider">
                ❌ Hardware Disconnected
              </span>
            </div>
          )}
        </div>

        {/* System health pills */}
        <div className="mt-4">
          <p className="font-jakarta text-[9px] text-gray-700 uppercase tracking-widest mb-2">System Health</p>
          <div className="flex flex-col gap-1.5">
            <Pill ok={!!health}                     label={health ? 'API Active'     : 'API Offline'} />
            <Pill ok={health?.database_available}   label={health?.database_available ? 'DB Synced' : 'DB Error'} />
            <Pill ok={health?.upload_dir_available} label="Upload Dir" />
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
              UNIBEN Field Station · 6-Parameter Telemetry · Dual-View CV Pipeline · SD Card Contingency
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
                text-[10px] font-jakarta transition-all duration-200
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
              <TelemetryTab readings={readings} histories={histories} geoCoords={geoCoords} wsState={wsState} />
            </motion.div>
          )}
          {activeTab === 'sync' && (
            <motion.div key="sync"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <SDSyncTab onPipelineComplete={refreshAll} />
            </motion.div>
          )}
          {activeTab === 'media' && (
            <motion.div key="media"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <FieldMediaTab onSessionCreated={refreshAll} />
            </motion.div>
          )}
        </AnimatePresence>

        <ReportFooter />

      </main>
    </div>
  );
}
