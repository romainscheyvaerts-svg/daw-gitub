
import React, { useState, useRef, useEffect } from 'react';
import { AutoTuneNode } from './AutoTuneNode';
import { NOTES } from '../../utils/constants';

// --- CONSTANTS ---
export const SCALES = ['CHROMATIC', 'MAJOR', 'MINOR', 'MINOR_HARMONIC', 'PENTATONIC', 'TRAP_DARK'];

export interface AutoTuneParams {
  speed: number;      
  humanize: number;   
  mix: number;        
  rootKey: number;    
  scale: string;      
  isEnabled: boolean;
}

interface AutoTuneUIProps {
  node: AutoTuneNode;
  initialParams: AutoTuneParams;
  onParamsChange?: (p: AutoTuneParams) => void;
  trackId?: string;
  pluginId?: string;
}

export const AutoTuneUI: React.FC<AutoTuneUIProps> = ({ node, initialParams, onParamsChange }) => {
  const [params, setParams] = useState(initialParams);
  const [viz, setViz] = useState({ pitch: 0, target: 0, cents: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Ref pour éviter les stale closures dans les event listeners
  const paramsRef = useRef(initialParams);
  useEffect(() => { paramsRef.current = params; }, [params]);

  // Sync DSP -> UI (via Callback Node)
  useEffect(() => {
      node.setStatusCallback((data) => {
          setViz(data);
      });
      return () => node.setStatusCallback(() => {});
  }, [node]);

  // --- VISUALIZER ---
  useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      let frame: number;

      const draw = () => {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          // Center Line
          ctx.strokeStyle = 'rgba(255,255,255,0.1)';
          ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.stroke();

          // Tolerance Zone
          ctx.fillStyle = 'rgba(0, 242, 255, 0.03)';
          ctx.fillRect(w/2 - 30, 0, 60, h);

          // Pitch Indicator
          if (viz.pitch > 50) {
              const offset = Math.max(-100, Math.min(100, viz.cents));
              const x = (w / 2) + (offset / 100) * (w / 2 * 0.8);
              
              // Glow Line
              ctx.shadowBlur = 15;
              ctx.shadowColor = '#00f2ff';
              ctx.strokeStyle = '#00f2ff';
              ctx.lineWidth = 3;
              
              ctx.beginPath();
              ctx.moveTo(x, 20);
              ctx.lineTo(x, h - 20);
              ctx.stroke();
              
              ctx.shadowBlur = 0;
              
              // Target Ball
              ctx.beginPath();
              ctx.arc(w/2, h/2, 4, 0, Math.PI * 2);
              ctx.fillStyle = '#fff';
              ctx.fill();
          }

          frame = requestAnimationFrame(draw);
      };
      
      draw();
      return () => cancelAnimationFrame(frame);
  }, [viz]);

  // --- CONTROLS ---
  const updateParam = (key: keyof AutoTuneParams, val: any) => {
      const newParams = { ...params, [key]: val };
      setParams(newParams);
      node.updateParams(newParams);
      if (onParamsChange) onParamsChange(newParams);
  };

  const getNoteName = (freq: number) => {
      if (freq <= 0) return '--';
      const midi = Math.round(69 + 12 * Math.log2(freq / 440));
      return NOTES[midi % 12] || '--';
  };

  return (
    <div className="w-[500px] bg-[#0c0d10] border border-white/10 rounded-[40px] p-8 shadow-2xl flex flex-col space-y-6 animate-in fade-in zoom-in duration-300 select-none">
      
      {/* HEADER */}
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
           <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.2)]">
               <i className="fas fa-microphone-alt text-xl"></i>
           </div>
           <div>
               <h2 className="text-xl font-black italic text-white uppercase tracking-tighter leading-none">Auto-Tune <span className="text-cyan-400">Pro</span></h2>
               <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mt-1">Real-Time Pitch Correction</p>
           </div>
        </div>
        <button 
           onClick={() => updateParam('isEnabled', !params.isEnabled)}
           className={`w-10 h-10 rounded-full flex items-center justify-center transition-all border ${params.isEnabled ? 'bg-cyan-500 border-cyan-400 text-black shadow-lg' : 'bg-white/5 border-white/10 text-slate-600'}`}
        >
           <i className="fas fa-power-off"></i>
        </button>
      </div>

      {/* VISUALIZER */}
      <div className="h-40 bg-black/60 rounded-[32px] border border-white/5 relative overflow-hidden group shadow-inner">
          <canvas ref={canvasRef} width={436} height={160} className="w-full h-full opacity-80" />
          
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[10px] font-black text-cyan-500/60 uppercase tracking-[0.4em] mb-2">Correction</span>
              <div className="flex items-baseline space-x-1">
                  <span className="text-6xl font-black text-white font-mono tracking-tighter text-shadow-glow">
                      {viz.target > 0 ? getNoteName(viz.target) : '--'}
                  </span>
                  {viz.target > 0 && <span className="text-lg font-mono text-cyan-400">{Math.floor(viz.target)}Hz</span>}
              </div>
              <div className="mt-2 px-3 py-1 bg-white/5 rounded-full border border-white/5">
                  <span className="text-[9px] font-mono text-slate-400">Input: {getNoteName(viz.pitch)}</span>
              </div>
          </div>
      </div>

      {/* KEY & SCALE */}
      <div className="grid grid-cols-2 gap-4 bg-white/[0.02] p-4 rounded-[24px] border border-white/5">
         <div className="space-y-2">
            <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Root Key</label>
            <div className="relative">
                <select 
                    value={params.rootKey}
                    onChange={(e) => updateParam('rootKey', parseInt(e.target.value))}
                    className="w-full bg-[#14161a] border border-white/10 rounded-xl h-10 px-3 text-[11px] font-bold text-white outline-none appearance-none cursor-pointer hover:border-cyan-500/50 transition-colors"
                >
                    {NOTES.map((n, i) => <option key={n} value={i}>{n}</option>)}
                </select>
                <i className="fas fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 pointer-events-none"></i>
            </div>
         </div>
         <div className="space-y-2">
            <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Scale Type</label>
            <div className="relative">
                <select 
                    value={params.scale}
                    onChange={(e) => updateParam('scale', e.target.value)}
                    className="w-full bg-[#14161a] border border-white/10 rounded-xl h-10 px-3 text-[11px] font-bold text-white outline-none appearance-none cursor-pointer hover:border-cyan-500/50 transition-colors"
                >
                    {SCALES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <i className="fas fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 pointer-events-none"></i>
            </div>
         </div>
      </div>

      {/* KNOBS */}
      <div className="grid grid-cols-3 gap-6 pt-2">
          <Knob 
            label="Retune" 
            value={params.speed} 
            onChange={(v) => updateParam('speed', v)} 
            color="#00f2ff" 
            display={(v) => v < 0.1 ? 'ROBOT' : (v > 0.9 ? 'SLOW' : `${Math.round(v*100)}`)}
          />
          <Knob 
            label="Humanize" 
            value={params.humanize} 
            onChange={(v) => updateParam('humanize', v)} 
            color="#fff"
            display={(v) => `${Math.round(v*100)}%`}
          />
          <Knob 
            label="Mix" 
            value={params.mix} 
            onChange={(v) => updateParam('mix', v)} 
            color="#fff"
            display={(v) => `${Math.round(v*100)}%`}
          />
      </div>
    </div>
  );
};

const Knob: React.FC<{ label: string, value: number, onChange: (v: number) => void, color: string, display: (v: number) => string }> = ({ label, value, onChange, color, display }) => {
    const handleMouseDown = (e: React.MouseEvent) => {
        const startY = e.clientY;
        const startVal = value;
        const onMove = (m: MouseEvent) => {
            const delta = (startY - m.clientY) / 150;
            onChange(Math.max(0, Math.min(1, startVal + delta)));
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const rotation = (value * 270) - 135;

    return (
        <div className="flex flex-col items-center space-y-2 group cursor-ns-resize" onMouseDown={handleMouseDown}>
            <div className="relative w-14 h-14 rounded-full bg-[#14161a] border-2 border-white/10 flex items-center justify-center shadow-lg group-hover:border-cyan-500/50 transition-colors">
                <div className="absolute inset-1 rounded-full border border-white/5 bg-black/40 shadow-inner" />
                <div 
                   className="absolute w-1.5 h-5 bg-current rounded-full origin-bottom bottom-1/2 transition-transform duration-75"
                   style={{ transform: `rotate(${rotation}deg)`, color: color, boxShadow: `0 0 10px ${color}` }}
                />
            </div>
            <div className="text-center">
                <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">{label}</span>
                <div className="bg-black/60 px-2 py-0.5 rounded border border-white/5 min-w-[50px]">
                    <span className="text-[9px] font-mono font-bold text-white">{display(value)}</span>
                </div>
            </div>
        </div>
    );
};
