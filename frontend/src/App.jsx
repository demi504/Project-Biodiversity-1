/**
 * UNIBEN Biodiversity Pipeline — Premium React Dashboard
 * Architecture: React 18 + Vite + Tailwind CSS + Framer Motion + Recharts
 * API: FastAPI backend on http://127.0.0.1:8000
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Thermometer, Droplets, Gauge, Zap, MapPin,
  Activity, Send, RefreshCw, CheckCircle2,
  XCircle, Wifi, WifiOff, Cpu, Database,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line,
  Tooltip, ReferenceLine,
} from 'recharts';

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Constants                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

const API = 'http://127.0.0.1:8000';
const POLL_MS = 2000;
const DRONE_SRC =
  'https://assets.mixkit.co/videos/preview/mixkit-forest-stream-in-the-sunlight-529-large.mp4';

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Framer-motion variants                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

const panelVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring', stiffness: 200, damping: 22 },
  },
};

const hoverVariants = {
  rest:  { scale: 1, boxShadow: '0 0 0px rgba(52,211,153,0)' },
  hover: {
    scale: 1.015,
    boxShadow: '0 0 24px rgba(52,211,153,0.18)',
    transition: { type: 'spring', stiffness: 300, damping: 20 },
  },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.07 } },
};

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Custom Recharts tooltip                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

function SparkTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass px-2 py-1 text-xs font-grotesk text-emerald-300">
      {Number(payload[0].value).toFixed(2)}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Metric Card                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */

function MetricCard({ icon: Icon, label, value, unit, history, color = '#34D399' }) {
  const sparkData = history.map((v, i) => ({ i, v }));

  return (
    <motion.div
      className="glass p-4 flex flex-col gap-2 relative overflow-hidden"
      variants={{ ...panelVariants, ...hoverVariants }}
      initial="hidden"
      animate="visible"
      whileHover="hover"
    >
      {/* Subtle gradient accent */}
      <div
        className="absolute inset-0 rounded-2xl opacity-5 pointer-events-none"
        style={{ background: `radial-gradient(circle at 80% 20%, ${color}, transparent 60%)` }}
      />

      {/* Header */}
      <div className="flex items-center gap-2">
        <div
          className="p-1.5 rounded-lg"
          style={{ background: `${color}18` }}
        >
          <Icon size={14} style={{ color }} />
        </div>
        <span className="text-xs font-jakarta text-gray-400 uppercase tracking-wider">{label}</span>
      </div>

      {/* Value */}
      <div className="flex items-end gap-1">
        <span
          className="font-grotesk text-2xl font-bold leading-none"
          style={{ color }}
        >
          {value ?? '—'}
        </span>
        <span className="text-xs text-gray-500 mb-0.5">{unit}</span>
      </div>

      {/* Sparkline */}
      {sparkData.length > 1 && (
        <div className="h-10 w-full mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData}>
              <Line
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Tooltip content={<SparkTooltip />} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Status Pill                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */

function StatusPill({ ok, label }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-jakarta font-medium
      ${ok ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/40'
           : 'bg-red-900/30 text-red-400 border border-red-800/40'}`}
    >
      {ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
      {label}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Tab 1 — Live Telemetry                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

function TelemetryTab({ readings }) {
  const latest = readings[0] ?? {};
  const history = (field) => readings.slice(0, 20).map((r) => r[field] ?? null).reverse();

  const metrics = [
    { icon: Thermometer, label: 'Temperature', field: 'temperature_c',    unit: '°C',  color: '#f97316' },
    { icon: Droplets,    label: 'Humidity',    field: 'humidity_percent', unit: '%',   color: '#38bdf8' },
    { icon: Gauge,       label: 'Altitude',    field: 'altitude_m',       unit: 'm',   color: '#a78bfa' },
    { icon: MapPin,      label: 'Latitude',    field: 'latitude',         unit: '°',   color: '#34D399' },
    { icon: Zap,         label: 'Longitude',   field: 'longitude',        unit: '°',   color: '#facc15' },
  ];

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-5">
      {/* Device badge */}
      {latest.device_id && (
        <motion.div variants={panelVariants} className="flex items-center gap-2">
          <Cpu size={14} className="text-emerald-400" />
          <span className="font-grotesk text-xs text-emerald-300 tracking-widest uppercase">
            {latest.device_id}
          </span>
          <span className="text-xs text-gray-600">·</span>
          <span className="text-xs text-gray-500 font-jakarta">
            {latest.observed_at ? new Date(latest.observed_at).toLocaleTimeString() : '—'}
          </span>
        </motion.div>
      )}

      {/* Metric cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {metrics.map((m) => (
          <MetricCard
            key={m.field}
            icon={m.icon}
            label={m.label}
            value={latest[m.field] != null ? Number(latest[m.field]).toFixed(2) : '—'}
            unit={m.unit}
            history={history(m.field)}
            color={m.color}
          />
        ))}
      </div>

      {/* Recent payloads table */}
      {readings.length > 0 && (
        <motion.div variants={panelVariants} className="glass p-4">
          <p className="font-jakarta text-xs text-gray-500 uppercase tracking-widest mb-3">
            Recent Payloads
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-grotesk">
              <thead>
                <tr className="text-gray-600 border-b border-emerald-900/20">
                  {['ID', 'Device', 'Temp (°C)', 'Humidity (%)', 'Lat', 'Lon', 'Observed At'].map((h) => (
                    <th key={h} className="text-left py-2 pr-4 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {readings.slice(0, 8).map((r) => (
                  <tr key={r.id} className="border-b border-emerald-950/30 hover:bg-emerald-900/10 transition-colors">
                    <td className="py-2 pr-4 text-emerald-400">#{r.id}</td>
                    <td className="py-2 pr-4 text-gray-300">{r.device_id}</td>
                    <td className="py-2 pr-4 text-orange-300">{r.temperature_c?.toFixed(1)}</td>
                    <td className="py-2 pr-4 text-sky-300">{r.humidity_percent?.toFixed(1)}</td>
                    <td className="py-2 pr-4 text-gray-400">{r.latitude?.toFixed(4)}</td>
                    <td className="py-2 pr-4 text-gray-400">{r.longitude?.toFixed(4)}</td>
                    <td className="py-2 pr-4 text-gray-500">
                      {r.observed_at ? new Date(r.observed_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {readings.length === 0 && (
        <motion.div variants={panelVariants} className="glass p-8 text-center">
          <Activity size={32} className="text-emerald-800 mx-auto mb-2" />
          <p className="text-gray-500 font-jakarta text-sm">
            No sensor readings yet. Start the backend and submit a payload.
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Tab 2 — Payload Ingestion Form                                             */
/* ─────────────────────────────────────────────────────────────────────────── */

const DEFAULT_FORM = {
  device_id: 'ESP32-UNIT-001',
  temperature_c: '27.0',
  humidity_percent: '72.0',
  latitude: '6.335000',
  longitude: '5.603700',
  altitude_m: '0.0',
  notes: '',
};

function FormField({ label, name, value, onChange, type = 'text', step }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-jakarta text-gray-400 uppercase tracking-wider">{label}</label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        step={step}
        autoComplete="off"
      />
    </div>
  );
}

function IngestionTab({ onSubmitSuccess }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [status, setStatus] = useState(null); // 'loading' | 'success' | 'error'
  const [result, setResult] = useState(null);

  const handleChange = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('loading');
    setResult(null);
    try {
      const resp = await fetch(`${API}/sensor-readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id:        form.device_id.trim(),
          temperature_c:    parseFloat(form.temperature_c),
          humidity_percent: parseFloat(form.humidity_percent),
          latitude:         parseFloat(form.latitude),
          longitude:        parseFloat(form.longitude),
          altitude_m:       parseFloat(form.altitude_m),
          notes:            form.notes.trim() || null,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail ?? resp.statusText);
      setResult(data);
      setStatus('success');
      onSubmitSuccess?.();
    } catch (err) {
      setResult({ error: err.message });
      setStatus('error');
    }
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-5">
      <motion.form
        variants={panelVariants}
        className="glass p-6"
        onSubmit={handleSubmit}
      >
        <p className="font-jakarta text-xs text-gray-500 uppercase tracking-widest mb-4">
          ESP32 Sensor Payload Ingestion
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
          <FormField label="Device ID"       name="device_id"        value={form.device_id}        onChange={handleChange} />
          <FormField label="Temperature (°C)" name="temperature_c"    value={form.temperature_c}    onChange={handleChange} type="number" step="0.1" />
          <FormField label="Humidity (%)"    name="humidity_percent" value={form.humidity_percent} onChange={handleChange} type="number" step="0.1" />
          <FormField label="Latitude"        name="latitude"         value={form.latitude}         onChange={handleChange} type="number" step="0.000001" />
          <FormField label="Longitude"       name="longitude"        value={form.longitude}        onChange={handleChange} type="number" step="0.000001" />
          <FormField label="Altitude (m)"    name="altitude_m"       value={form.altitude_m}       onChange={handleChange} type="number" step="0.1" />
        </div>

        <div className="mb-5">
          <label className="text-xs font-jakarta text-gray-400 uppercase tracking-wider block mb-1">Notes</label>
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows={3}
            style={{ resize: 'vertical' }}
            placeholder="Optional field observations…"
          />
        </div>

        <motion.button
          type="submit"
          disabled={status === 'loading'}
          whileHover={{ scale: 1.02, boxShadow: '0 0 20px rgba(52,211,153,0.3)' }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-jakarta font-semibold text-sm
            text-emerald-950 transition-opacity"
          style={{ background: 'linear-gradient(135deg, #064E3B, #34D399)' }}
        >
          {status === 'loading'
            ? <><RefreshCw size={14} className="animate-spin" /> Submitting…</>
            : <><Send size={14} /> Submit Payload</>}
        </motion.button>
      </motion.form>

      <AnimatePresence>
        {status === 'success' && result && (
          <motion.div
            variants={panelVariants} initial="hidden" animate="visible" exit={{ opacity: 0 }}
            className="glass p-4 border border-emerald-800/30"
          >
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={14} className="text-emerald-400" />
              <span className="font-jakarta text-sm text-emerald-400 font-semibold">
                Payload accepted · Record ID #{result.id}
              </span>
            </div>
            <pre className="text-xs font-grotesk text-gray-400 overflow-x-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          </motion.div>
        )}
        {status === 'error' && result && (
          <motion.div
            variants={panelVariants} initial="hidden" animate="visible" exit={{ opacity: 0 }}
            className="glass p-4 border border-red-800/30"
          >
            <div className="flex items-center gap-2">
              <XCircle size={14} className="text-red-400" />
              <span className="font-jakarta text-sm text-red-400 font-semibold">
                {result.error}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Tab 3 — Drone Imagery                                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

function DroneTab() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-4">
      <motion.div
        variants={{ ...panelVariants, ...hoverVariants }}
        initial="hidden"
        animate="visible"
        whileHover="hover"
        className="glass overflow-hidden"
      >
        {/* Header bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-emerald-900/20">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-jakarta text-xs font-semibold text-emerald-300 uppercase tracking-widest">
              Live Drone Feed
            </span>
          </div>
          <span className="font-grotesk text-xs text-gray-600">
            Photogrammetric Sync · Active
          </span>
        </div>

        {/* Video with CV crosshair overlay */}
        <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
          <video
            autoPlay
            muted
            loop
            playsInline
            src={DRONE_SRC}
            className="w-full h-full object-cover"
          />

          {/* Crosshair overlay */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Horizontal line */}
            <div className="crosshair-h opacity-60" />
            {/* Vertical line */}
            <div className="crosshair-v opacity-60" />
            {/* Center dot */}
            <div className="crosshair-dot" />

            {/* Corner brackets */}
            {[
              'top-4 left-4 border-t border-l',
              'top-4 right-4 border-t border-r',
              'bottom-4 left-4 border-b border-l',
              'bottom-4 right-4 border-b border-r',
            ].map((cls, i) => (
              <div
                key={i}
                className={`absolute w-6 h-6 ${cls} border-emerald-400 opacity-70`}
              />
            ))}

            {/* HUD data overlays */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2">
              <span className="font-grotesk text-xs text-emerald-300 bg-black/50 px-2 py-0.5 rounded">
                ALT: 42.3m · SPD: 8.2m/s · HDG: 314°
              </span>
            </div>
            <div className="absolute bottom-3 right-4">
              <span className="font-grotesk text-xs text-emerald-300 bg-black/50 px-2 py-0.5 rounded">
                GPS: 6.3350°N · 5.6037°E
              </span>
            </div>
          </div>
        </div>

        {/* Footer metrics */}
        <div className="grid grid-cols-3 gap-px bg-emerald-900/10">
          {[
            { label: 'Frame Rate', value: '60 fps' },
            { label: 'Resolution', value: '4K UHD' },
            { label: 'Coverage', value: '2.4 km²' },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col items-center py-3 bg-black/20">
              <span className="font-grotesk text-sm text-emerald-300 font-semibold">{value}</span>
              <span className="font-jakarta text-xs text-gray-600 mt-0.5">{label}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Pipeline status row */}
      <motion.div variants={panelVariants} className="glass p-4">
        <p className="font-jakarta text-xs text-gray-500 uppercase tracking-widest mb-3">
          Processing Pipeline
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { step: 'Frame Capture',      status: 'live',    pct: 100 },
            { step: 'Geo-referencing',    status: 'live',    pct: 98  },
            { step: 'Orthomosaic Stitch', status: 'queued',  pct: 64  },
            { step: 'Species Detection',  status: 'pending', pct: 0   },
          ].map(({ step, status: st, pct }) => (
            <div key={step} className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <span className="font-jakarta text-gray-400">{step}</span>
                <span className={`font-grotesk font-semibold
                  ${st === 'live' ? 'text-emerald-400' : st === 'queued' ? 'text-yellow-400' : 'text-gray-600'}`}>
                  {pct}%
                </span>
              </div>
              <div className="h-1 bg-emerald-950/50 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: st === 'live' ? '#34D399' : st === 'queued' ? '#facc15' : '#374151' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 1, delay: 0.3 }}
                />
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Sidebar Health Panel                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

function Sidebar({ health, lastPoll }) {
  const ok = health?.status === 'ok';
  return (
    <motion.aside
      initial={{ x: -30, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 180, damping: 22, delay: 0.1 }}
      className="glass flex flex-col gap-4 p-5 h-full"
    >
      {/* Logo */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#064E3B,#34D399)' }}>
          <span className="text-sm">🌿</span>
        </div>
        <div>
          <p className="font-grotesk text-xs font-bold text-emerald-300 leading-tight">UNIBEN</p>
          <p className="font-jakarta text-[10px] text-gray-600 leading-tight">Biodiversity Engine</p>
        </div>
      </div>

      {/* System health */}
      <div>
        <p className="font-jakarta text-[10px] text-gray-600 uppercase tracking-widest mb-2">
          System Health
        </p>
        <div className="flex flex-col gap-2">
          <StatusPill ok={!!health} label={health ? 'API Online' : 'API Offline'} />
          <StatusPill ok={health?.database_available} label={health?.database_available ? 'SQLite Ready' : 'DB Unavailable'} />
          <StatusPill ok={health?.upload_dir_available} label="Upload Dir" />
          <StatusPill ok={health?.models_loaded} label={health?.models_loaded ? 'Models Loaded' : 'No Models'} />
        </div>
      </div>

      {/* DB path */}
      {health?.database_path && (
        <div>
          <p className="font-jakarta text-[10px] text-gray-600 uppercase tracking-widest mb-1">
            <Database size={9} className="inline mr-1" />DB Path
          </p>
          <p className="font-grotesk text-[10px] text-gray-500 break-all leading-relaxed">
            {health.database_path.split(/[\\/]/).slice(-3).join('/')}
          </p>
        </div>
      )}

      {/* Last poll */}
      <div className="mt-auto">
        <div className="flex items-center gap-1.5">
          <RefreshCw size={9} className={`text-emerald-500 ${health ? 'animate-spin' : ''}`}
            style={{ animationDuration: '3s' }} />
          <span className="font-grotesk text-[10px] text-gray-600">
            {lastPoll ? `Polled ${new Date(lastPoll).toLocaleTimeString()}` : 'Connecting…'}
          </span>
        </div>
      </div>
    </motion.aside>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Root App                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'telemetry', label: '📡 Sensor Telemetry' },
  { id: 'ingestion', label: '📝 Payload Ingestion' },
  { id: 'drone',     label: '🛸 Drone Imagery' },
];

export default function App() {
  const [activeTab, setActiveTab]  = useState('telemetry');
  const [readings,  setReadings]   = useState([]);
  const [health,    setHealth]     = useState(null);
  const [lastPoll,  setLastPoll]   = useState(null);

  /* Live polling */
  const poll = useCallback(async () => {
    try {
      const [hRes, rRes] = await Promise.all([
        fetch(`${API}/health`),
        fetch(`${API}/sensor-readings?limit=50`),
      ]);
      if (hRes.ok) setHealth(await hRes.json());
      if (rRes.ok) setReadings(await rRes.json());
      setLastPoll(Date.now());
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  return (
    <div className="relative z-10 min-h-screen flex flex-col">
      {/* Top nav bar */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="glass mx-4 mt-4 px-5 py-3 flex items-center justify-between"
        style={{ borderRadius: 14 }}
      >
        <div>
          <h1 className="font-grotesk text-sm font-bold text-emerald-300 tracking-wide">
            UNIBEN Biodiversity Pipeline
          </h1>
          <p className="font-jakarta text-[11px] text-gray-500">
            Campus-scale multimodal telemetry & imagery workspace
          </p>
        </div>
        <div className="flex items-center gap-2">
          {health
            ? <><Wifi size={13} className="text-emerald-400" /><span className="font-grotesk text-xs text-emerald-400">LIVE</span></>
            : <><WifiOff size={13} className="text-red-400" /><span className="font-grotesk text-xs text-red-400">OFFLINE</span></>}
        </div>
      </motion.header>

      {/* Main layout */}
      <div className="flex flex-1 gap-4 p-4 overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 shrink-0 hidden lg:block">
          <Sidebar health={health} lastPoll={lastPoll} />
        </div>

        {/* Content area */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          {/* Tab bar */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="flex gap-1 glass p-1"
            style={{ borderRadius: 12 }}
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-2 px-3 rounded-lg font-jakarta text-xs font-semibold transition-all duration-200
                  ${activeTab === tab.id
                    ? 'bg-emerald-900/40 text-emerald-300 shadow-inner'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
              >
                {tab.label}
              </button>
            ))}
          </motion.div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">
              {activeTab === 'telemetry' && (
                <motion.div key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <TelemetryTab readings={readings} />
                </motion.div>
              )}
              {activeTab === 'ingestion' && (
                <motion.div key="i" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <IngestionTab onSubmitSuccess={poll} />
                </motion.div>
              )}
              {activeTab === 'drone' && (
                <motion.div key="d" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <DroneTab />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
