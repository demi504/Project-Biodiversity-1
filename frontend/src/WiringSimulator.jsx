import React, { useState } from 'react';

// Simplified SVG Icon components to ensure 100% self-contained running
const PowerIcon = () => (
  <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

const ChipIcon = () => (
  <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 1v2M15 1v2M9 21v2M15 21v2M1 9h2M1 15h2M21 9h2M21 15h2" />
  </svg>
);

const InfoIcon = () => (
  <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const RestartIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H12" />
  </svg>
);

export default function App() {
  const [selectedWireGroup, setSelectedWireGroup] = useState('all'); // 'all', 'power', 'i2c', 'dht', 'sound'
  const [activeStep, setActiveStep] = useState(0);
  const [hoveredPin, setHoveredPin] = useState(null);
  const [isWizardMode, setIsWizardMode] = useState(true);

  // Connection data for interactive highlights
  const connections = [
    {
      id: 'gnd-rail',
      group: 'power',
      color: '#4B5563', // Grey for GND
      label: 'Ground Line (GND)',
      description: 'The return path for electrical current. Connects all sensor GND pins to the negative (blue) rail of the breadboard, which routes directly back to the ESP32 GND pin.',
      path: 'M 180,480 Q 200,520 320,520 T 450,520 T 580,520',
      thick: 4
    },
    {
      id: 'vcc-rail',
      group: 'power',
      color: '#EF4444', // Red for 3.3V
      label: '3.3V Power Line (VCC)',
      description: 'Provides 3.3 Volts of electric potential to power the microchips. Connects all sensor VCC pins to the positive (red) rail of the breadboard, routing straight from the ESP32 3V3 pin.',
      path: 'M 180,450 Q 200,500 320,500 T 450,500 T 580,500',
      thick: 4
    },
    {
      id: 'dht-data',
      group: 'dht',
      color: '#3B82F6', // Blue for DHT Data
      label: 'DHT22 Data Line (GPIO 4)',
      description: 'The digital communication pipe for the humidity sensor. Connects pin 2 of the DHT22 directly to GPIO 4 on the ESP32.',
      path: 'M 350,220 Q 300,300 220,150',
      thick: 3
    },
    {
      id: 'i2c-sda',
      group: 'i2c',
      color: '#10B981', // Green for SDA
      label: 'Shared I2C Data Highway (SDA / GPIO 21)',
      description: 'SDA (Serial Data) is a shared lane. Both the BMP280 pressure sensor and BH1750 light sensor connect their SDA pins to the exact same GPIO 21 pin on the ESP32.',
      path: 'M 440,220 Q 400,280 220,270 M 520,220 Q 450,300 220,270',
      thick: 3
    },
    {
      id: 'i2c-scl',
      group: 'i2c',
      color: '#F59E0B', // Yellow for SCL
      label: 'Shared I2C Clock Highway (SCL / GPIO 22)',
      description: 'SCL (Serial Clock) synchronizes data transfers. Both BMP280 and BH1750 connect their SCL pins directly to GPIO 22 on the ESP32.',
      path: 'M 450,220 Q 380,310 220,290 M 530,220 Q 430,320 220,290',
      thick: 3
    },
    {
      id: 'sound-analog',
      group: 'sound',
      color: '#8B5CF6', // Purple for Analog Sound
      label: 'Sound Sensor Analog Line (A0 / GPIO 34)',
      description: 'Carries the fluctuating analog voltage waveform from the microphone module directly into the ESP32 Analog-to-Digital Converter (ADC) at GPIO 34.',
      path: 'M 610,220 Q 500,350 220,380',
      thick: 3
    }
  ];

  const wizardSteps = [
    {
      title: "Step 1: Wire the Power Rails",
      group: 'power',
      text: "Before connecting sensors, set up the power grids on your breadboard. Run a red wire from the ESP32's 3.3V pin to the outer red (+) rail. Run a black/grey wire from the ESP32's GND pin to the blue (-) rail. Now the entire length of the breadboard is energized and ready to supply electricity!",
      action: "Identify the 3.3V and GND pins on the left side of your ESP32 module."
    },
    {
      title: "Step 2: Connect the Humidity Sensor (DHT22)",
      group: 'dht',
      text: "Mount the white DHT22 onto your breadboard. Connect its VCC pin to the positive (red) rail and GND to the negative (blue) rail. Next, connect its Data pin directly to GPIO 4 on the ESP32. (Add a 10k resistor between Data and VCC if you experience data dropouts).",
      action: "Hook up Pin 2 of the DHT22 to GPIO 4 of the ESP32."
    },
    {
      title: "Step 3: Establish the Shared I2C Highway",
      group: 'i2c',
      text: "Unlike the DHT22, I2C devices can share wires! Run a wire from BMP280 SDA and another from BH1750 SDA, and plug them both into the exact same line connecting to ESP32 GPIO 21. Do the same for SCL, running both to GPIO 22. The ESP32 uses unique binary addresses to talk to them individually over these shared lanes.",
      action: "Bridge both SDA pins to GPIO 21, and both SCL pins to GPIO 22."
    },
    {
      title: "Step 4: Connect the Analog Microphone Module",
      group: 'sound',
      text: "Wire the microphone's VCC and GND to the power rails. Then, run a jumper wire from the module's Analog Output pin (A0) to GPIO 34 on the ESP32. We use GPIO 34 because it connects to internal Analog-to-Digital Converter 1 (ADC1), which can read raw voltages extremely fast.",
      action: "Connect the sound module's AO (Analog Out) to GPIO 34."
    }
  ];

  const handleNextStep = () => {
    if (activeStep < wizardSteps.length - 1) {
      const nextStep = activeStep + 1;
      setActiveStep(nextStep);
      setSelectedWireGroup(wizardSteps[nextStep].group);
    } else {
      setIsWizardMode(false);
      setSelectedWireGroup('all');
    }
  };

  const handlePrevStep = () => {
    if (activeStep > 0) {
      const prevStep = activeStep - 1;
      setActiveStep(prevStep);
      setSelectedWireGroup(wizardSteps[prevStep].group);
    }
  };

  const startWizard = () => {
    setIsWizardMode(true);
    setActiveStep(0);
    setSelectedWireGroup(wizardSteps[0].group);
  };

  return (
    <div className="flex flex-col h-full min-h-screen bg-slate-900 text-slate-100 font-sans">
      {/* Upper header */}
      <header className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <span className="flex h-3 w-3 rounded-full bg-emerald-500 animate-pulse"></span>
            ESP32 Environmental Sensor Array: Newbie Wiring Guide
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Visual companion to hardware_blueprint.md • Interactive setup wizard
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setIsWizardMode(!isWizardMode); setSelectedWireGroup('all'); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 border ${
              isWizardMode 
                ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700' 
                : 'bg-indigo-600 text-white border-indigo-500 hover:bg-indigo-500 shadow-md shadow-indigo-900/30'
            }`}
          >
            {isWizardMode ? "Exit Wizard (Free Mode)" : "Launch Guided Wizard"}
          </button>
        </div>
      </header>

      {/* Main Sandbox Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* Left Interactive Control Panel */}
        <section className="lg:col-span-4 p-6 bg-slate-950 border-r border-slate-800 flex flex-col gap-6 overflow-y-auto">
          {/* Active Mode Banner */}
          {isWizardMode ? (
            <div className="bg-indigo-950/40 border border-indigo-800/60 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="flex items-center justify-center h-5 w-5 rounded-full bg-indigo-900 text-indigo-300 text-xs font-bold">
                  {activeStep + 1}
                </span>
                <h3 className="text-sm font-bold text-indigo-200 tracking-wide uppercase">
                  Guided Connections Walkthrough
                </h3>
              </div>
              <h2 className="text-lg font-extrabold text-white mb-3">
                {wizardSteps[activeStep].title}
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed mb-4">
                {wizardSteps[activeStep].text}
              </p>
              
              <div className="bg-slate-900/80 rounded-lg p-3 border border-indigo-950 flex items-start gap-2 mb-4">
                <InfoIcon />
                <div className="text-[11px] text-slate-400 leading-snug">
                  <span className="font-semibold text-slate-200">Newbie Action:</span> {wizardSteps[activeStep].action}
                </div>
              </div>

              <div className="flex items-center justify-between mt-2 pt-2 border-t border-indigo-900/40">
                <button
                  onClick={handlePrevStep}
                  disabled={activeStep === 0}
                  className={`px-3 py-1.5 rounded text-xs font-medium ${
                    activeStep === 0 
                      ? 'text-slate-600 cursor-not-allowed' 
                      : 'text-slate-300 hover:bg-indigo-900/40 hover:text-white'
                  }`}
                >
                  Back
                </button>
                <div className="text-xs text-indigo-400 font-mono">
                  {activeStep + 1} / {wizardSteps.length}
                </div>
                <button
                  onClick={handleNextStep}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded shadow-sm flex items-center gap-1"
                >
                  {activeStep === wizardSteps.length - 1 ? "Finish Guide" : "Next Step"}
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <ChipIcon />
                  Interactive Sandbox Mode
                </h3>
                <button 
                  onClick={startWizard} 
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-semibold"
                >
                  <RestartIcon /> Restart Wizard
                </button>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed mb-4">
                Click on the wire groups below or hover over the breadboard layout to isolate communication paths and view specific pinouts.
              </p>

              {/* Wire selectors */}
              <div className="space-y-2">
                <button
                  onClick={() => setSelectedWireGroup('all')}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-150 ${
                    selectedWireGroup === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`}
                >
                  <span>Show All Wiring Lanes</span>
                  <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                </button>
                <button
                  onClick={() => setSelectedWireGroup('power')}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-150 ${
                    selectedWireGroup === 'power' ? 'bg-red-950/40 text-red-300 border border-red-900/50' : 'text-slate-400 hover:bg-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500"></span> Power Grid (3.3V / GND)</span>
                  <span className="text-[10px] bg-red-900/20 text-red-400 px-1.5 py-0.5 rounded">2 wires</span>
                </button>
                <button
                  onClick={() => setSelectedWireGroup('dht')}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-150 ${
                    selectedWireGroup === 'dht' ? 'bg-blue-950/40 text-blue-300 border border-blue-900/50' : 'text-slate-400 hover:bg-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500"></span> DHT22 Humidity (GPIO 4)</span>
                  <span className="text-[10px] bg-blue-900/20 text-blue-400 px-1.5 py-0.5 rounded">1 wire</span>
                </button>
                <button
                  onClick={() => setSelectedWireGroup('i2c')}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-150 ${
                    selectedWireGroup === 'i2c' ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-900/50' : 'text-slate-400 hover:bg-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500"></span> Shared I2C Bus (SDA / SCL)</span>
                  <span className="text-[10px] bg-emerald-900/20 text-emerald-400 px-1.5 py-0.5 rounded">4 wires</span>
                </button>
                <button
                  onClick={() => setSelectedWireGroup('sound')}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-150 ${
                    selectedWireGroup === 'sound' ? 'bg-purple-950/40 text-purple-300 border border-purple-900/50' : 'text-slate-400 hover:bg-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-purple-500"></span> Sound Sensor Analog (GPIO 34)</span>
                  <span className="text-[10px] bg-purple-900/20 text-purple-400 px-1.5 py-0.5 rounded">1 wire</span>
                </button>
              </div>
            </div>
          )}

          {/* Newbie Educational Board Glossary */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex-1 flex flex-col min-h-[180px]">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <InfoIcon />
              Pin & Jumper Glossary
            </h4>
            <div className="flex-1 text-xs text-slate-300 overflow-y-auto space-y-3 pr-1">
              {hoveredPin ? (
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="font-bold text-white text-sm mb-1">{hoveredPin.name}</div>
                  <div className="text-[10px] text-indigo-400 font-mono mb-2">Connected via {hoveredPin.type}</div>
                  <p className="text-[11px] leading-relaxed text-slate-300">{hoveredPin.details}</p>
                </div>
              ) : (
                <div className="text-slate-400 italic text-[11px] leading-relaxed py-4 text-center">
                  Hover over or tap any pin or sensor on the virtual board to learn exactly what it does!
                </div>
              )}
              
              {/* Highlight explanations based on active group */}
              {selectedWireGroup !== 'all' && (
                <div className="border-t border-slate-800 pt-3">
                  <h5 className="font-bold text-white text-[11px] mb-2">Active Wire Lane Information</h5>
                  {connections
                    .filter(c => c.group === selectedWireGroup)
                    .map(c => (
                      <div key={c.id} className="mb-3 last:mb-0">
                        <div className="flex items-center gap-1.5 font-bold text-slate-200 text-[11px]">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }}></span>
                          {c.label}
                        </div>
                        <p className="text-[10px] text-slate-400 leading-normal mt-1">{c.description}</p>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Right Sandbox Vector Canvas */}
        <main className="lg:col-span-8 p-6 bg-slate-900 flex items-center justify-center overflow-auto relative">
          <div className="w-full max-w-4xl aspect-[4/3] bg-slate-950 rounded-2xl border border-slate-800 p-4 shadow-2xl relative flex flex-col justify-between">
            {/* Legend / Overlay indicator */}
            <div className="absolute top-4 left-4 z-10 flex flex-wrap gap-2">
              <span className="px-2 py-1 bg-slate-900/90 border border-slate-800 rounded text-[10px] font-mono text-slate-300">
                Active View: <span className="text-emerald-400 font-bold">{selectedWireGroup.toUpperCase()}</span>
              </span>
              <span className="px-2 py-1 bg-slate-900/90 border border-slate-800 rounded text-[10px] font-mono text-slate-300">
                ESP32: <span className="text-indigo-400 font-bold">NodeMCU-32S</span>
              </span>
            </div>

            {/* Simulated Vector Workspace */}
            <div className="flex-1 w-full relative min-h-[400px]">
              <svg className="w-full h-full" viewBox="0 0 800 600" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* 1. POWER RAILS AT THE BOTTOM (Breadboard Power rails) */}
                <g id="breadboard-power-rails">
                  {/* Outer Breadboard background */}
                  <rect x="50" y="440" width="700" height="110" rx="10" fill="#E2E8F0" stroke="#CBD5E1" strokeWidth="2" />
                  <rect x="60" y="450" width="680" height="15" rx="3" fill="#F1F5F9" />
                  <rect x="60" y="510" width="680" height="15" rx="3" fill="#F1F5F9" />
                  
                  {/* Power grid indicators */}
                  <line x1="70" y1="457" x2="730" y2="457" stroke="#EF4444" strokeWidth="2" strokeDasharray="4 6" /> {/* Red Plus */}
                  <line x1="70" y1="517" x2="730" y2="517" stroke="#3B82F6" strokeWidth="2" strokeDasharray="4 6" /> {/* Blue Minus */}
                  
                  {/* Rail Hole Labels */}
                  <text x="65" y="433" className="text-[11px] fill-red-500 font-bold font-mono">+</text>
                  <text x="65" y="538" className="text-[11px] fill-blue-500 font-bold font-mono">-</text>

                  {/* Hole vectors to make it look like a physical breadboard */}
                  {[...Array(30)].map((_, i) => (
                    <g key={i}>
                      <circle cx={90 + (i * 21.5)} cy="457" r="2.5" fill="#1E293B" stroke="#94A3B8" strokeWidth="1" />
                      <circle cx={90 + (i * 21.5)} cy="517" r="2.5" fill="#1E293B" stroke="#94A3B8" strokeWidth="1" />
                    </g>
                  ))}
                </g>

                {/* 2. THE MAIN ESP32 MICROCONTROLLER UNIT (Center Workspace) */}
                <g id="esp32-node" 
                   onMouseEnter={() => setHoveredPin({
                     name: "ESP32 DevKitC NodeMCU",
                     type: "Central Processor",
                     details: "The brain of your module. Powered by a Dual-core Xtensa 32-bit microprocessor. Equipped with integrated Wi-Fi and Bluetooth antennas. It reads values from your digital & analog pins and runs our offline LittleFS buffering logic."
                   })}
                   className="cursor-pointer group"
                >
                  {/* Black Silicon board body */}
                  <rect x="100" y="60" width="120" height="340" rx="6" fill="#0F172A" stroke="#334155" strokeWidth="2" />
                  
                  {/* Pins headers sides */}
                  <rect x="92" y="80" width="8" height="300" fill="#1E293B" />
                  <rect x="220" y="80" width="8" height="300" fill="#1E293B" />
                  
                  {/* Onboard metallic modules and USB plug */}
                  <rect x="125" y="50" width="70" height="15" rx="2" fill="#64748B" /> {/* USB connector */}
                  <rect x="130" y="90" width="60" height="70" rx="3" fill="#cbd5e1" stroke="#94a3b8" /> {/* Metal Wifi Shield */}
                  <rect x="140" y="100" width="40" height="30" rx="1" fill="#1e293b" />
                  <text x="145" y="118" fill="#F8FAFC" className="text-[9px] font-mono font-bold">ESP32</text>
                  
                  {/* RGB Led & Boot buttons */}
                  <rect x="120" y="360" width="15" height="15" rx="1" fill="#475569" />
                  <circle cx="127" cy="367" r="3" fill="#EF4444" />
                  <rect x="185" y="360" width="15" height="15" rx="1" fill="#475569" />
                  <circle cx="192" cy="367" r="3" fill="#3B82F6" />

                  {/* Left row Pins (Power, GPIOs) */}
                  <g className="text-[8px] fill-slate-400 font-mono">
                    <text x="115" y="155" textAnchor="end" onMouseEnter={() => setHoveredPin({ name: "3.3V (3V3) Pin", type: "Power Pin", details: "Provides steady 3.3V power directly from the onboard linear drop voltage regulator. Used as the main positive current feed for your environmental sensor circuits." })}>3V3</text>
                    <text x="115" y="180" textAnchor="end" onMouseEnter={() => setHoveredPin({ name: "GND (Ground) Pin", type: "Common Ground Reference", details: "The zero-voltage reference pin for your electrical system. Absolutely critical for establishing complete circuits so currents can flow." })}>GND</text>
                    <text x="115" y="275" textAnchor="end" onMouseEnter={() => setHoveredPin({ name: "GPIO 21 (I2C SDA)", type: "Digital Communication Line", details: "Dedicated Hardware I2C Serial Data (SDA) pin. This serves as the communication bus where both the BMP280 and BH1750 route their structured readings." })}>GPIO 21</text>
                    <text x="115" y="295" textAnchor="end" onMouseEnter={() => setHoveredPin({ name: "GPIO 22 (I2C SCL)", type: "Digital Communication Clock", details: "Dedicated Hardware I2C Serial Clock (SCL) pin. It sends rhythmic square pulses from the ESP32 CPU to synchronize communication with the BMP280 and BH1750." })}>GPIO 22</text>
                  </g>
                  
                  {/* Right row Pins */}
                  <g className="text-[8px] fill-slate-400 font-mono">
                    <text x="205" y="155" textAnchor="start" onMouseEnter={() => setHoveredPin({ name: "GPIO 4 (DHT Data)", type: "Digital IO Pin", details: "Used as our high-speed input pin for the DHT22 Single-Bus protocol. Reads raw temperature and humidity frames packed by the AM2302 microcontroller inside the DHT casing." })}>GPIO 4</text>
                    <text x="205" y="385" textAnchor="start" onMouseEnter={() => setHoveredPin({ name: "GPIO 34 (Analog Sound Out)", type: "Input-Only ADC Pin", details: "An input-only analog pin routed directly to Analog-to-Digital Converter 1 (ADC1). Reads fluctuating voltage levels coming from the microphone preamplifier circuit." })}>GPIO 34</text>
                  </g>

                  {/* Pin connection points */}
                  <circle cx="104" cy="152" r="3.5" fill="#EF4444" stroke="#FCA5A5" strokeWidth="1" /> {/* 3V3 */}
                  <circle cx="104" cy="177" r="3.5" fill="#475569" stroke="#94A3B8" strokeWidth="1" /> {/* GND */}
                  <circle cx="216" cy="152" r="3.5" fill="#3B82F6" stroke="#93C5FD" strokeWidth="1" /> {/* GPIO 4 */}
                  <circle cx="104" cy="272" r="3.5" fill="#10B981" stroke="#6EE7B7" strokeWidth="1" /> {/* GPIO 21 */}
                  <circle cx="104" cy="292" r="3.5" fill="#F59E0B" stroke="#FCD34D" strokeWidth="1" /> {/* GPIO 22 */}
                  <circle cx="216" cy="382" r="3.5" fill="#8B5CF6" stroke="#C084FC" strokeWidth="1" /> {/* GPIO 34 */}
                </g>

                {/* 3. SENSORS RENDERINGS (TOP ROW) */}
                
                {/* A. DHT22 SENSOR PANEL */}
                <g id="dht22-sensor" 
                   className="cursor-pointer group"
                   onMouseEnter={() => setHoveredPin({
                     name: "DHT22 Environmental Sensor",
                     type: "Humidity & Temp",
                     details: "A standard digital capacitive humidity and thermistor module. It reads humidity from 0-100% and temperature from -40 to 80°C with excellent decimal-place accuracy. Runs on a customized 1-wire serial protocol."
                   })}
                >
                  {/* Grid base white module body */}
                  <rect x="300" y="80" width="80" height="110" rx="5" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="2" />
                  
                  {/* Mesh holes representation */}
                  <rect x="310" y="90" width="60" height="50" rx="3" fill="#E2E8F0" />
                  <line x1="310" y1="105" x2="370" y2="105" stroke="#94A3B8" strokeWidth="1" />
                  <line x1="310" y1="120" x2="370" y2="120" stroke="#94A3B8" strokeWidth="1" />
                  <line x1="310" y1="130" x2="370" y2="130" stroke="#94A3B8" strokeWidth="1" />
                  <line x1="325" y1="90" x2="325" y2="140" stroke="#94A3B8" strokeWidth="1" />
                  <line x1="340" y1="90" x2="340" y2="140" stroke="#94A3B8" strokeWidth="1" />
                  <line x1="355" y1="90" x2="355" y2="140" stroke="#94A3B8" strokeWidth="1" />

                  {/* Connections label */}
                  <text x="340" y="175" textAnchor="middle" className="text-[9px] fill-slate-500 font-bold font-mono">DHT22</text>
                  
                  {/* Pins */}
                  <circle cx="315" cy="205" r="3" fill="#EF4444" onMouseEnter={() => setHoveredPin({ name: "DHT22 VCC Pin", type: "Power Input", details: "Power supply input. Needs 3.3V or 5V to energize the onboard AM2302 processing core." })} />
                  <circle cx="330" cy="205" r="3" fill="#3B82F6" onMouseEnter={() => setHoveredPin({ name: "DHT22 Data Pin", type: "Digital Communication Output", details: "The data pipeline pin. Plugs straight into GPIO 4 on your ESP32 to push serialized sensor packets." })} />
                  <circle cx="345" cy="205" r="3" fill="#64748B" onMouseEnter={() => setHoveredPin({ name: "DHT22 Pin 3 (Not Connected)", type: "NC (No Connection)", details: "This pin is completely unused and left disconnected on breakout boards. You do not need to wire it to anything!" })} />
                  <circle cx="360" cy="205" r="3" fill="#475569" onMouseEnter={() => setHoveredPin({ name: "DHT22 Ground Pin (GND)", type: "Electrical Return Path", details: "Connects back to the negative GND rail to close the electric loop." })} />
                </g>

                {/* B. BMP280 PRESSURE PANEL */}
                <g id="bmp280-sensor" 
                   className="cursor-pointer group"
                   onMouseEnter={() => setHoveredPin({
                     name: "BMP280 Barometric Pressure Sensor",
                     type: "Pressure & Temp (I2C)",
                     details: "An absolute barometric pressure sensor manufactured by Bosch. It calculates atmospheric pressure and ambient temperature. Essential for tracking microclimate changes, altitude shifts, and localized weather systems."
                   })}
                >
                  {/* Purple breakout board */}
                  <rect x="410" y="100" width="60" height="90" rx="4" fill="#581C87" stroke="#3B0764" strokeWidth="1.5" />
                  
                  {/* Metal Bosch sensor cap */}
                  <rect x="425" y="115" width="30" height="25" rx="2" fill="#E2E8F0" stroke="#94A3B8" />
                  <circle cx="433" cy="122" r="1.5" fill="#475569" /> {/* Sensor hole */}
                  <text x="440" y="132" fill="#475569" className="text-[7px] font-mono font-bold">BMP</text>

                  {/* Pins labeled */}
                  <text x="440" y="175" textAnchor="middle" className="text-[8px] fill-purple-200 font-bold font-mono">BMP280</text>
                  
                  {/* Pins */}
                  <circle cx="420" cy="205" r="3" fill="#EF4444" onMouseEnter={() => setHoveredPin({ name: "BMP280 VCC", type: "Power Pin (3.3V)", details: "Voltage input pin. Ensure this connects to the 3.3V rail. Driving it with 5V without an onboard regulator will permanently destroy the Bosch microchip." })} />
                  <circle cx="432" cy="205" r="3" fill="#475569" onMouseEnter={() => setHoveredPin({ name: "BMP280 GND", type: "Ground Pin", details: "Connects to the common ground rail." })} />
                  <circle cx="444" cy="205" r="3" fill="#F59E0B" onMouseEnter={() => setHoveredPin({ name: "BMP280 SCL (Serial Clock)", type: "I2C Clock input", details: "Clock sync line. Connects to the shared I2C Clock wire running back to ESP32 GPIO 22." })} />
                  <circle cx="456" cy="205" r="3" fill="#10B981" onMouseEnter={() => setHoveredPin({ name: "BMP280 SDA (Serial Data)", type: "I2C Data line", details: "High-speed communication path. Connects to the shared I2C Data wire running back to ESP32 GPIO 21." })} />
                </g>

                {/* C. BH1750 LIGHT LUX PANEL */}
                <g id="bh1750-sensor" 
                   className="cursor-pointer group"
                   onMouseEnter={() => setHoveredPin({
                     name: "BH1750 Ambient Light Sensor",
                     type: "Light Intensity (Lux)",
                     details: "A digital ambient light sensor with an integrated high-precision photo-diode and Analog-to-Digital converter. It directly outputs measurements formatted in Lux (0 - 65535 lx) over the shared I2C Bus, completely bypassing any analog noise drift."
                   })}
                >
                  {/* Blue breakout board */}
                  <rect x="500" y="100" width="60" height="90" rx="4" fill="#1E3A8A" stroke="#172554" strokeWidth="1.5" />
                  
                  {/* Circular photodiode lens */}
                  <circle cx="530" cy="125" r="12" fill="#0F172A" stroke="#475569" strokeWidth="2" />
                  <circle cx="530" cy="125" r="4" fill="#cbd5e1" />

                  {/* Sensor label */}
                  <text x="530" y="175" textAnchor="middle" className="text-[8px] fill-blue-200 font-bold font-mono">BH1750</text>
                  
                  {/* Pins */}
                  <circle cx="510" cy="205" r="3" fill="#EF4444" onMouseEnter={() => setHoveredPin({ name: "BH1750 VCC", type: "Power (3.3V)", details: "Supply voltage input. Powers both the high-res photodiode and the internal ADC converter." })} />
                  <circle cx="520" cy="205" r="3" fill="#475569" onMouseEnter={() => setHoveredPin({ name: "BH1750 GND", type: "Ground Pin", details: "Connects to common ground." })} />
                  <circle cx="530" cy="205" r="3" fill="#F59E0B" onMouseEnter={() => setHoveredPin({ name: "BH1750 SCL (I2C Clock)", type: "I2C Clock sync", details: "Connects to the shared SCL clock line running to ESP32 GPIO 22." })} />
                  <circle cx="540" cy="205" r="3" fill="#10B981" onMouseEnter={() => setHoveredPin({ name: "BH1750 SDA (I2C Data)", type: "I2C Data line", details: "Connects to the shared SDA data highway running to ESP32 GPIO 21." })} />
                  <circle cx="550" cy="205" r="3" fill="#64748B" onMouseEnter={() => setHoveredPin({ name: "BH1750 ADD (I2C Address Selection)", type: "Address select Pin (NC)", details: "Used to change the sensor's I2C binary address. If left disconnected, it defaults to address 0x23. Connecting to VCC changes it to 0x5C. Leave it empty!" })} />
                </g>

                {/* D. ANALOG SOUND SENSOR PANEL */}
                <g id="sound-sensor" 
                   className="cursor-pointer group"
                   onMouseEnter={() => setHoveredPin({
                     name: "MAX4466 / KY-037 Microphone Module",
                     type: "Analog Decibel Level",
                     details: "An analog microphone capsule connected to a high-speed operational amplifier. It captures structural sound vibrations. By sampling the output voltage fast over a 50ms window, we calculate relative sound level peaks."
                   })}
                >
                  {/* Blue module PCB */}
                  <rect x="590" y="90" width="70" height="100" rx="4" fill="#0284C7" stroke="#0369A1" strokeWidth="1.5" />
                  
                  {/* Condenser Mic Cylindrical canister */}
                  <circle cx="625" cy="112" r="14" fill="#475569" stroke="#94A3B8" strokeWidth="1" />
                  <circle cx="625" cy="112" r="11" fill="#94A3B8" />
                  <rect x="618" y="110" width="14" height="4" fill="#475569" />
                  
                  {/* Precision Potentiometer calibration box */}
                  <rect x="600" y="145" width="18" height="18" fill="#F59E0B" rx="1" />
                  <circle cx="609" cy="154" r="3.5" fill="#FCD34D" stroke="#D97706" />
                  <line x1="607" y1="154" x2="611" y2="154" stroke="#78350F" strokeWidth="1.5" />

                  {/* Labeled */}
                  <text x="625" y="178" textAnchor="middle" className="text-[8px] fill-sky-100 font-bold font-mono">SOUND MIC</text>
                  
                  {/* Pins */}
                  <circle cx="610" cy="205" r="3" fill="#EF4444" onMouseEnter={() => setHoveredPin({ name: "Sound Sensor VCC", type: "Power Input", details: "Power supply pin. Connects to the red positive rail to receive 3.3V." })} />
                  <circle cx="625" cy="205" r="3" fill="#475569" onMouseEnter={() => setHoveredPin({ name: "Sound Sensor GND", type: "Ground Pin", details: "Common ground reference pin." })} />
                  <circle cx="640" cy="205" r="3" fill="#8B5CF6" onMouseEnter={() => setHoveredPin({ name: "Sound Sensor A0 (Analog Output)", type: "Analog Signal Output", details: "Outputs fluctuating raw voltage spikes matching captured sound pressure waves. Plugs directly into ESP32 GPIO 34 for high-speed ADC sampling." })} />
                </g>

                {/* 4. THE JUMPER WIRE DRAWINGS (INTERACTIVE SVGs) */}
                <g id="jumper-wires">
                  {connections.map((wire) => {
                    const isGroupSelected = selectedWireGroup === 'all' || selectedWireGroup === wire.group;
                    const opacityValue = isGroupSelected ? 1.0 : 0.08;
                    const strokeWidthValue = isGroupSelected ? wire.thick + 2 : wire.thick;
                    const glowEffect = isGroupSelected && selectedWireGroup !== 'all';

                    return (
                      <g key={wire.id} className="transition-all duration-300">
                        {/* Outer glow effect when isolated */}
                        {glowEffect && (
                          <path
                            d={wire.path}
                            fill="none"
                            stroke={wire.color}
                            strokeWidth={strokeWidthValue + 8}
                            strokeLinecap="round"
                            opacity="0.3"
                            className="animate-pulse"
                          />
                        )}
                        {/* Primary physical jumper wire */}
                        <path
                          d={wire.path}
                          fill="none"
                          stroke={wire.color}
                          strokeWidth={strokeWidthValue}
                          strokeLinecap="round"
                          opacity={opacityValue}
                          className="transition-all duration-300"
                        />
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>

            {/* Bottom Color/Wiring legend */}
            <footer className="px-4 py-3 bg-slate-900 border-t border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="flex items-center gap-1.5 text-red-400 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500"></span> Red: VCC (3.3V)
                </span>
                <span className="flex items-center gap-1.5 text-slate-400 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-600"></span> Grey: GND (Ground)
                </span>
                <span className="flex items-center gap-1.5 text-blue-400 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full bg-blue-500"></span> Blue: DHT Data
                </span>
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span> Green: Shared SDA
                </span>
                <span className="flex items-center gap-1.5 text-amber-400 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span> Yellow: Shared SCL
                </span>
                <span className="flex items-center gap-1.5 text-purple-400 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full bg-purple-500"></span> Purple: Sound Analog Out
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono">
                Hover pins to learn more
              </div>
            </footer>
          </div>
        </main>
      </div>

      {/* Footer / Quick-check validation quiz tab */}
      <footer className="p-4 bg-slate-950 border-t border-slate-800 text-center text-xs text-slate-400 flex flex-wrap justify-between items-center gap-4">
        <div>
          UNIBEN Field Station Environmental Data Node v2.4 • Created for Engineering Department 
        </div>
        <div className="flex gap-4">
          <a href="#" className="text-indigo-400 hover:underline">Download Wiring Schematic</a>
          <span className="text-slate-700">|</span>
          <a href="#" className="text-indigo-400 hover:underline">Back to Main Dashboard</a>
        </div>
      </footer>
    </div>
  );
}