/**
 * UNIBEN Biodiversity Pipeline — Premium React Dashboard v2
 *
 * Five mandatory environmental parameters:
 *   Temperature (°C) · Humidity (%) · Pressure (hPa) · Light (Lux) · Sound (dB)
 *
 * Tab 3: split-screen drag-and-drop uploader + live taxonomy table
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Thermometer, Droplets, Gauge, Sun, Volume2,
  Activity, RefreshCw, CheckCircle2, XCircle,
  Wifi, WifiOff, Cpu, Database, UploadCloud, BarChart2,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, Tooltip,
} from 'recharts';

/* ─────────────────────────────────────────────────────────────────────────── */
const API     = 'http://127.0.0.1:8000';
const POLL_MS = 2000;

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
/*  Tooltip                                                                    */
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
/*  Metric Card — exactly 5 environmental parameters                          */
/* ─────────────────────────────────────────────────────────────────────────── */

function MetricCard({ icon: Icon, label, value, unit, history, color = '#34D399' }) {
  const data = (history ?? []).map((v, i) => ({ i, v }));

  return (
    <motion.div
      className="glass p-4 flex flex-col gap-2 relative overflow-hidden cursor-default"
      variants={panelV}
      whileHover={{
        scale: 1.015,
        boxShadow: `0 0 28px ${color}30`,
        transition: { type: 'spring', stiffness: 300, damping: 20 },
      }}
    >
      {/* Glow accent */}
      <div
        className="absolute inset-0 rounded-2xl opacity-[0.04] pointer-events-none"
        style={{ background: `radial-gradient(circle at 80% 20%, ${color}, transparent 65%)` }}
      />

      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg" style={{ background: `${color}18` }}>
          <Icon size={13} style={{ color }} />
        </div>
        <span className="text-[10px] font-jakarta text-gray-500 uppercase tracking-widest">
          {label}
        </span>
      </div>

      {/* Value */}
      <div className="flex items-end gap-1">
        <span className="font-grotesk text-[1.6rem] font-bold leading-none" style={{ color }}>
          {value ?? '—'}
        </span>
        <span className="text-[10px] text-gray-600 mb-0.5 font-grotesk">{unit}</span>
      </div>

      {/* Sparkline */}
      {data.length > 1 && (
        <div className="h-9 w-full mt-0.5">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
                dot={false} isAnimationActive={false} />
              <Tooltip content={<SparkTip />} />
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

function Pill({ ok, label }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px]
      font-jakarta font-semibold border
      ${ok ? 'bg-emerald-900/25 text-emerald-400 border-emerald-800/35'
           : 'bg-red-900/25 text-red-400 border-red-800/35'}`}>
      {ok ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
      {label}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Tab 1 — Live Telemetry (5 parameters only)                                */
/* ─────────────────────────────────────────────────────────────────────────── */

function TelemetryTab({ readings }) {
  const latest  = readings[0] ?? {};
  const hist    = (field) => readings.slice(0, 25).map((r) => r[field] ?? null).reverse();

  const METRICS = [
    { icon: Thermometer, label: 'Temperature',   field: 'temperature_c',    unit: '°C',  color: '#f97316' },
    { icon: Droplets,    label: 'Humidity',      field: 'humidity_percent', unit: '%',   color: '#38bdf8' },
    { icon: Gauge,       label: 'Pressure',      field: 'pressure_hPa',     unit: 'hPa', color: '#a78bfa' },
    { icon: Sun,         label: 'Light',         field: 'light_lux',        unit: 'Lux', color: '#facc15' },
    { icon: Volume2,     label: 'Sound Level',   field: 'sound_db',         unit: 'dB',  color: '#34D399' },
  ];

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-5">
      {/* Device badge */}
      {latest.device_id && (
        <motion.div variants={panelV} className="flex items-center gap-2">
          <Cpu size={13} className="text-emerald-400" />
          <span className="font-grotesk text-[10px] text-emerald-300 uppercase tracking-widest">
            {latest.device_id}
          </span>
          <span className="text-gray-700 text-xs">·</span>
          <span className="font-jakarta text-[10px] text-gray-500">
            {latest.observed_at ? new Date(latest.observed_at).toLocaleTimeString() : '—'}
          </span>
        </motion.div>
      )}

      {/* 5-column metric grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {METRICS.map((m) => (
          <MetricCard
            key={m.field}
            icon={m.icon}
            label={m.label}
            value={latest[m.field] != null ? Number(latest[m.field]).toFixed(2) : '—'}
            unit={m.unit}
            history={hist(m.field)}
            color={m.color}
          />
        ))}
      </div>

      {/* Recent readings table */}
      {readings.length > 0 ? (
        <motion.div variants={panelV} className="glass p-4">
          <p className="font-jakarta text-[10px] text-gray-600 uppercase tracking-widest mb-3">
            Recent Sensor Packets
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-grotesk">
              <thead>
                <tr className="text-gray-600 border-b border-emerald-900/20">
                  {['ID','Device','Temp °C','Humid %','Pres hPa','Light Lux','Sound dB','Observed'].map(h => (
                    <th key={h} className="text-left py-2 pr-4 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {readings.slice(0, 10).map((r) => (
                  <tr key={r.id} className="border-b border-emerald-950/20 hover:bg-emerald-900/10 transition-colors">
                    <td className="py-2 pr-4 text-emerald-400">#{r.id}</td>
                    <td className="py-2 pr-4 text-gray-300">{r.device_id}</td>
                    <td className="py-2 pr-4 text-orange-300">{r.temperature_c?.toFixed(1)}</td>
                    <td className="py-2 pr-4 text-sky-300">{r.humidity_percent?.toFixed(1)}</td>
                    <td className="py-2 pr-4 text-violet-300">{r.pressure_hPa?.toFixed(1)}</td>
                    <td className="py-2 pr-4 text-yellow-300">{r.light_lux?.toFixed(0)}</td>
                    <td className="py-2 pr-4 text-emerald-300">{r.sound_db?.toFixed(1)}</td>
                    <td className="py-2 pr-4 text-gray-500">
                      {r.observed_at ? new Date(r.observed_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      ) : (
        <motion.div variants={panelV} className="glass p-8 text-center">
          <Activity size={30} className="text-emerald-900 mx-auto mb-2" />
          <p className="text-gray-600 font-jakarta text-sm">
            No sensor readings yet. Start the backend and submit a payload.
          </p>
        </motion.div>
      )}

      {/* ── Data Insights & Automated Analytical Reports ── */}
      <div className="pt-2">
        <AnalyticsPanel />
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Analytics Panel — renders Matplotlib PNGs from /analytics/ static path    */
/* ─────────────────────────────────────────────────────────────────────────── */

const ANALYTICS_PLOTS = [
  {
    src:   '/analytics/sensor_correlations.png',
    title: '5-Parameter Sensor Correlation Matrix',
    desc:  'Pearson correlation coefficients · auto-refreshed every 5 min',
  },
  {
    src:   '/analytics/biodiversity_density.png',
    title: 'Biodiversity Encounter Density',
    desc:  'KDE histograms + observation frequency over time',
  },
];

// Cache-bust key so Vite re-fetches updated PNGs after each analytics cycle
function useCacheBust(intervalMs = 300_000) {
  const [bust, setBust] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setBust(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return bust;
}

const AnalyticsPlotCard = memo(function AnalyticsPlotCard({ src, title, desc, bust }) {
  const [loaded, setLoaded]   = useState(false);
  const [errored, setErrored] = useState(false);

  // Reset error/load state when src or bust changes
  useEffect(() => { setLoaded(false); setErrored(false); }, [src, bust]);

  return (
    <motion.div
      variants={panelV}
      className="glass p-4 flex flex-col gap-3"
      whileHover={{ scale: 1.008, boxShadow: '0 0 24px rgba(52,211,153,0.15)' }}
    >
      <div className="flex items-start gap-2">
        <BarChart2 size={13} className="text-emerald-400 mt-0.5 shrink-0" />
        <div>
          <p className="font-jakarta text-[11px] font-semibold text-emerald-300 leading-tight">
            {title}
          </p>
          <p className="font-grotesk text-[9px] text-gray-600 mt-0.5">{desc}</p>
        </div>
      </div>

      <div className="relative rounded-xl overflow-hidden bg-[#0B0F19] border border-emerald-900/20"
        style={{ minHeight: 180 }}>
        {!loaded && !errored && (
          <div className="absolute inset-0 flex items-center justify-center">
            <RefreshCw size={18} className="text-emerald-800 animate-spin" />
          </div>
        )}
        {errored ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <BarChart2 size={22} className="text-emerald-900" />
            <p className="font-jakarta text-[10px] text-gray-700 text-center px-4">
              Plot will appear after the first analytics cycle runs (≤5 min).
            </p>
          </div>
        ) : (
          <img
            src={`${src}?v=${bust}`}
            alt={title}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            className="w-full rounded-xl transition-opacity duration-500"
            style={{ opacity: loaded ? 1 : 0 }}
          />
        )}
      </div>
    </motion.div>
  );
});

function AnalyticsPanel() {
  const bust = useCacheBust(300_000);
  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-2">
      <motion.div variants={panelV} className="flex items-center gap-2 pt-1">
        <BarChart2 size={12} className="text-emerald-500" />
        <span className="font-jakarta text-[9px] text-gray-600 uppercase tracking-widest">
          Data Insights &amp; Automated Reports · Matplotlib/Seaborn · auto-refresh 5 min
        </span>
      </motion.div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {ANALYTICS_PLOTS.map((p) => (
          <AnalyticsPlotCard key={p.src} {...p} bust={bust} />
        ))}
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Tab 2 — Payload Ingestion (5 parameters)                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

const DEFAULT_FORM = {
  device_id:        'ESP32-UNIT-001',
  temperature_c:    '27.0',
  humidity_percent: '72.0',
  pressure_hPa:     '1013.25',
  light_lux:        '850.0',
  sound_db:         '42.0',
  latitude:         '6.335000',
  longitude:        '5.603700',
  notes:            '',
};

function Field({ label, name, value, onChange, type = 'text', step }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-jakarta text-gray-500 uppercase tracking-wider">{label}</label>
      <input type={type} name={name} value={value} onChange={onChange} step={step} autoComplete="off" />
    </div>
  );
}

function IngestionTab({ onSuccess }) {
  const [form,   setForm]   = useState(DEFAULT_FORM);
  const [st,     setSt]     = useState(null);
  const [result, setResult] = useState(null);

  const change = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSt('loading'); setResult(null);
    try {
      const r = await fetch(`${API}/sensor-readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id:        form.device_id.trim(),
          temperature_c:    parseFloat(form.temperature_c),
          humidity_percent: parseFloat(form.humidity_percent),
          pressure_hPa:     parseFloat(form.pressure_hPa),
          light_lux:        parseFloat(form.light_lux),
          sound_db:         parseFloat(form.sound_db),
          latitude:         parseFloat(form.latitude),
          longitude:        parseFloat(form.longitude),
          notes:            form.notes.trim() || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? r.statusText);
      setResult(data); setSt('success'); onSuccess?.();
    } catch (err) {
      setResult({ error: err.message }); setSt('error');
    }
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-5">
      <motion.form variants={panelV} className="glass p-6" onSubmit={submit}>
        <p className="font-jakarta text-[10px] text-gray-600 uppercase tracking-widest mb-4">
          5-Parameter ESP32 Sensor Payload
        </p>

        {/* Row 1 — core 5 params */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
          <Field label="Temperature (°C)"  name="temperature_c"    value={form.temperature_c}    onChange={change} type="number" step="0.1"    />
          <Field label="Humidity (%)"      name="humidity_percent" value={form.humidity_percent} onChange={change} type="number" step="0.1"    />
          <Field label="Pressure (hPa)"   name="pressure_hPa"     value={form.pressure_hPa}     onChange={change} type="number" step="0.01"   />
          <Field label="Light (Lux)"       name="light_lux"        value={form.light_lux}        onChange={change} type="number" step="1"      />
          <Field label="Sound (dB)"        name="sound_db"         value={form.sound_db}         onChange={change} type="number" step="0.1"    />
        </div>

        {/* Row 2 — metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <Field label="Device ID"  name="device_id"  value={form.device_id}  onChange={change} />
          <Field label="Latitude"   name="latitude"   value={form.latitude}   onChange={change} type="number" step="0.000001" />
          <Field label="Longitude"  name="longitude"  value={form.longitude}  onChange={change} type="number" step="0.000001" />
        </div>

        <div className="mb-5">
          <label className="text-[10px] font-jakarta text-gray-500 uppercase tracking-wider block mb-1">Notes</label>
          <textarea name="notes" value={form.notes} onChange={change} rows={2}
            style={{ resize: 'vertical' }} placeholder="Optional field observations…" />
        </div>

        <motion.button
          type="submit" disabled={st === 'loading'}
          whileHover={{ scale: 1.02, boxShadow: '0 0 20px rgba(52,211,153,0.25)' }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-jakarta font-semibold
            text-sm text-emerald-950"
          style={{ background: 'linear-gradient(135deg,#064E3B,#34D399)' }}
        >
          {st === 'loading'
            ? <><RefreshCw size={13} className="animate-spin" /> Submitting…</>
            : <>Submit 5-Parameter Payload</>}
        </motion.button>
      </motion.form>

      <AnimatePresence>
        {st === 'success' && result && (
          <motion.div variants={panelV} initial="hidden" animate="visible" exit={{ opacity: 0 }}
            className="glass p-4 border border-emerald-800/25">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={13} className="text-emerald-400" />
              <span className="font-jakarta text-sm text-emerald-400 font-semibold">
                Accepted · Record #{result.id}
              </span>
            </div>
            <pre className="text-[10px] font-grotesk text-gray-500 overflow-x-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          </motion.div>
        )}
        {st === 'error' && result && (
          <motion.div variants={panelV} initial="hidden" animate="visible" exit={{ opacity: 0 }}
            className="glass p-4 border border-red-800/25">
            <div className="flex items-center gap-2">
              <XCircle size={13} className="text-red-400" />
              <span className="font-jakarta text-sm text-red-400 font-semibold">{result.error}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Tab 3 — Drone Imagery  (split-screen: uploader | taxonomy table)          */
/* ─────────────────────────────────────────────────────────────────────────── */

const TAXONOMY_KEYS = ['Kingdom','Phylum','Class','Order','Family','Genus','Species'];

const RANK_COLORS = {
  Kingdom: '#f97316',
  Phylum:  '#facc15',
  Class:   '#a78bfa',
  Order:   '#38bdf8',
  Family:  '#34D399',
  Genus:   '#86efac',
  Species: '#A7F3D0',
};

function DroneTab() {
  const dropRef    = useRef(null);
  const inputRef   = useRef(null);
  const [dragging, setDragging]  = useState(false);
  const [file,     setFile]      = useState(null);
  const [preview,  setPreview]   = useState(null);
  const [status,   setStatus]    = useState(null); // null | 'uploading' | 'success' | 'error'
  const [taxonomy, setTaxonomy]  = useState(null); // CVInferenceResponse | null
  const [errMsg,   setErrMsg]    = useState('');

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setTaxonomy(null);
    setStatus(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(f);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const upload = async () => {
    if (!file) return;
    setStatus('uploading');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`${API}/api/v1/upload-image`, { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? r.statusText);
      setTaxonomy(data);
      setStatus('success');
    } catch (err) {
      setErrMsg(err.message);
      setStatus('error');
    }
  };

  const reset = () => {
    setFile(null); setPreview(null);
    setTaxonomy(null); setStatus(null); setErrMsg('');
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ── LEFT: Drag-and-Drop Uploader ── */}
        <motion.div variants={panelV} className="glass p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-jakarta text-[10px] font-semibold text-emerald-300 uppercase tracking-widest">
              Image Upload · CV Pipeline
            </span>
          </div>

          {/* Drop zone */}
          <div
            ref={dropRef}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center rounded-xl border-2
              border-dashed cursor-pointer transition-all duration-200 min-h-[180px]
              ${dragging
                ? 'border-emerald-400 bg-emerald-900/20'
                : 'border-emerald-900/40 hover:border-emerald-700/60 hover:bg-emerald-900/10'}`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/tiff,image/webp"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />

            {preview ? (
              <img src={preview} alt="preview" className="max-h-40 rounded-lg object-contain" />
            ) : (
              <>
                <UploadCloud size={32} className="text-emerald-800 mb-2" />
                <p className="font-jakarta text-xs text-gray-500 text-center px-4">
                  Drag &amp; drop a field image here, or click to browse
                </p>
                <p className="font-grotesk text-[10px] text-gray-700 mt-1">
                  JPG · PNG · TIFF · WEBP
                </p>
              </>
            )}
          </div>

          {file && (
            <div className="flex items-center justify-between">
              <span className="font-grotesk text-[10px] text-gray-500 truncate max-w-[60%]">
                {file.name}
              </span>
              <div className="flex gap-2">
                <motion.button
                  onClick={reset}
                  whileHover={{ scale: 1.04 }}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-jakarta font-semibold
                    text-gray-400 border border-gray-800/50 hover:border-gray-600/50"
                >
                  Clear
                </motion.button>
                <motion.button
                  onClick={upload}
                  disabled={status === 'uploading'}
                  whileHover={{ scale: 1.04, boxShadow: '0 0 16px rgba(52,211,153,0.3)' }}
                  whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-jakarta
                    font-semibold text-[11px] text-emerald-950"
                  style={{ background: 'linear-gradient(135deg,#064E3B,#34D399)' }}
                >
                  {status === 'uploading'
                    ? <><RefreshCw size={11} className="animate-spin" /> Classifying…</>
                    : <>Run CV Inference</>}
                </motion.button>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="flex items-center gap-2 text-red-400">
              <XCircle size={13} />
              <span className="font-jakarta text-xs">{errMsg}</span>
            </div>
          )}
        </motion.div>

        {/* ── RIGHT: Taxonomy Results Table ── */}
        <motion.div variants={panelV} className="glass p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="font-jakarta text-[10px] font-semibold text-emerald-300 uppercase tracking-widest">
              Taxonomic Classification
            </span>
            {taxonomy && (
              <span className="font-grotesk text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(52,211,153,0.12)', color: '#34D399' }}>
                {(taxonomy.confidence * 100).toFixed(1)}% confidence
              </span>
            )}
          </div>

          {taxonomy ? (
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-1"
              >
                {/* Predicted label */}
                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-emerald-900/20">
                  <CheckCircle2 size={13} className="text-emerald-400" />
                  <span className="font-jakarta text-xs text-emerald-300 font-semibold">
                    {taxonomy.predicted_label}
                  </span>
                  <span className="font-grotesk text-[10px] text-gray-600 ml-auto">
                    {taxonomy.status}
                  </span>
                </div>

                {/* Taxonomy rows — Kingdom → Species */}
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-gray-700 border-b border-emerald-900/15">
                      <th className="text-left py-1.5 font-jakarta font-medium pr-4">Rank</th>
                      <th className="text-left py-1.5 font-jakarta font-medium">Taxon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TAXONOMY_KEYS.map((rank, i) => (
                      <motion.tr
                        key={rank}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="border-b border-emerald-950/20 hover:bg-emerald-900/10 transition-colors"
                      >
                        <td className="py-2 pr-4">
                          <span
                            className="font-jakarta text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            style={{
                              color: RANK_COLORS[rank],
                              background: `${RANK_COLORS[rank]}18`,
                            }}
                          >
                            {rank}
                          </span>
                        </td>
                        <td className="py-2 font-grotesk" style={{ color: RANK_COLORS[rank] }}>
                          {taxonomy.taxonomy?.[rank] ?? '—'}
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>

                {/* Confidence bar */}
                <div className="mt-3">
                  <div className="flex justify-between text-[10px] font-jakarta text-gray-600 mb-1">
                    <span>ML Confidence</span>
                    <span className="text-emerald-400 font-grotesk">
                      {(taxonomy.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-emerald-950/50 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: 'linear-gradient(90deg,#064E3B,#34D399)' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${taxonomy.confidence * 100}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center py-10">
              <Database size={28} className="text-emerald-900 mb-2" />
              <p className="font-jakarta text-xs text-gray-600 text-center px-4">
                Upload a field image on the left to populate the taxonomic classification hierarchy.
              </p>
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Sidebar                                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

function Sidebar({ health, lastPoll }) {
  return (
    <motion.aside
      initial={{ x: -28, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 180, damping: 22, delay: 0.1 }}
      className="glass flex flex-col gap-4 p-5 h-full"
    >
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#064E3B,#34D399)' }}>
          <span className="text-sm">🌿</span>
        </div>
        <div>
          <p className="font-grotesk text-[11px] font-bold text-emerald-300 leading-tight">UNIBEN</p>
          <p className="font-jakarta text-[9px] text-gray-700 leading-tight">Biodiversity Engine</p>
        </div>
      </div>

      <div>
        <p className="font-jakarta text-[9px] text-gray-700 uppercase tracking-widest mb-2">System Health</p>
        <div className="flex flex-col gap-1.5">
          <Pill ok={!!health}                      label={health ? 'API Active' : 'API Offline'} />
          <Pill ok={health?.database_available}    label={health?.database_available ? 'DB Synced' : 'DB Error'} />
          <Pill ok={health?.upload_dir_available}  label="Upload Dir" />
          <Pill ok={health?.model_file_loaded}     label={health?.model_file_loaded ? 'Model Active' : 'No Checkpoint'} />
        </div>
      </div>

      {health?.database_path && (
        <div>
          <p className="font-jakarta text-[9px] text-gray-700 uppercase tracking-widest mb-1">
            <Database size={8} className="inline mr-1" />DB Path
          </p>
          <p className="font-grotesk text-[9px] text-gray-600 break-all leading-relaxed">
            {health.database_path.split(/[\\/]/).slice(-3).join('/')}
          </p>
        </div>
      )}

      <div className="mt-auto flex items-center gap-1.5">
        <RefreshCw size={8} className="text-emerald-600" style={{ animationDuration: '3s' }} />
        <span className="font-grotesk text-[9px] text-gray-700">
          {lastPoll ? new Date(lastPoll).toLocaleTimeString() : 'Connecting…'}
        </span>
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
  const [tab,      setTab]      = useState('telemetry');
  const [readings, setReadings] = useState([]);
  const [health,   setHealth]   = useState(null);
  const [lastPoll, setLastPoll] = useState(null);

  const poll = useCallback(async () => {
    try {
      const [hR, rR] = await Promise.all([
        fetch(`${API}/health`),
        fetch(`${API}/sensor-readings?limit=50`),
      ]);
      if (hR.ok) setHealth(await hR.json());
      if (rR.ok) setReadings(await rR.json());
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
      {/* Header */}
      <motion.header
        initial={{ y: -18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35 }}
        className="glass mx-4 mt-4 px-5 py-3 flex items-center justify-between"
        style={{ borderRadius: 14 }}
      >
        <div>
          <h1 className="font-grotesk text-sm font-bold text-emerald-300 tracking-wide">
            UNIBEN Biodiversity Pipeline
          </h1>
          <p className="font-jakarta text-[10px] text-gray-600">
            5-Parameter Environmental Telemetry · CV Classification · Timestamp Sync
          </p>
        </div>
        <div className="flex items-center gap-2">
          {health
            ? <><Wifi size={12} className="text-emerald-400" /><span className="font-grotesk text-[11px] text-emerald-400">LIVE</span></>
            : <><WifiOff size={12} className="text-red-400" /><span className="font-grotesk text-[11px] text-red-400">OFFLINE</span></>}
        </div>
      </motion.header>

      {/* Layout */}
      <div className="flex flex-1 gap-4 p-4 overflow-hidden">
        {/* Sidebar (lg+) */}
        <div className="w-44 shrink-0 hidden lg:block">
          <Sidebar health={health} lastPoll={lastPoll} />
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          {/* Tab bar */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="flex gap-1 glass p-1"
            style={{ borderRadius: 12 }}
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-2 px-3 rounded-lg font-jakarta text-[11px] font-semibold
                  transition-all duration-200
                  ${tab === t.id
                    ? 'bg-emerald-900/40 text-emerald-300'
                    : 'text-gray-600 hover:text-gray-400 hover:bg-white/5'}`}
              >
                {t.label}
              </button>
            ))}
          </motion.div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto pb-4">
            <AnimatePresence mode="wait">
              {tab === 'telemetry' && (
                <motion.div key="tel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <TelemetryTab readings={readings} />
                </motion.div>
              )}
              {tab === 'ingestion' && (
                <motion.div key="ing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <IngestionTab onSuccess={poll} />
                </motion.div>
              )}
              {tab === 'drone' && (
                <motion.div key="drn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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
