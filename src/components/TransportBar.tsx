
import React, { useState, useRef, useEffect } from 'react';
import { useDAW } from '../context/DAWContext';
import { MasterMeter } from './MeterWidgets';
import MasterVisualizer from './MasterVisualizer';
import { midiManager } from '../services/MidiManager';

// On garde quelques props UI qui ne sont pas dans le State global (comme l'ouverture des modales)
interface TransportBarProps {
  currentView: string;
  onChangeView: (view: any) => void;
  onOpenSaveMenu: () => void;
  onOpenLoadMenu: () => void;
  onExportMix: () => void;
  onShareProject: () => void;
  onOpenAudioEngine: () => void;
  onToggleDelayComp: () => void;
  showBrowserToggle?: boolean;
  isBrowserOpen?: boolean;
  onToggleBrowser?: () => void;
  children?: React.ReactNode;
}

const TransportBar: React.FC<TransportBarProps> = ({ 
  currentView, onChangeView, 
  onOpenSaveMenu, onOpenLoadMenu, onExportMix, onShareProject, onOpenAudioEngine, onToggleDelayComp,
  showBrowserToggle, isBrowserOpen, onToggleBrowser, children
}) => {
  // CONNEXION DIRECTE AU CERVEAU
  const { state, user, play, stop, setBpm, toggleLoop, undo, redo, canUndo, canRedo } = useDAW();
  
  const [isEditingBpm, setIsEditingBpm] = useState(false);
  const [tempBpm, setTempBpm] = useState(state.bpm.toString());
  const [midiActive, setMidiActive] = useState(false);
  const [midiDeviceName, setMidiDeviceName] = useState<string | null>(null);
  const bpmInputRef = useRef<HTMLInputElement>(null);

  // Sync local BPM state when global state changes (unless editing)
  useEffect(() => {
     if (!isEditingBpm) setTempBpm(state.bpm.toString());
  }, [state.bpm, isEditingBpm]);

  // MIDI Listener
  useEffect(() => {
     const name = midiManager.getActiveDeviceName();
     if (name) setMidiDeviceName(name);

     const unsubscribe = midiManager.addNoteListener((cmd, note, vel) => {
         setMidiActive(true);
         setMidiDeviceName(midiManager.getActiveDeviceName());
         setTimeout(() => setMidiActive(false), 200);
     });
     return unsubscribe;
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const cents = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${cents.toString().padStart(2, '0')}`;
  };

  const handleBpmMouseDown = (e: React.MouseEvent) => {
    if (e.detail === 2) { 
      setIsEditingBpm(true);
      return;
    }
    const startY = e.clientY;
    const startBpm = state.bpm;
    const onMouseMove = (m: MouseEvent) => {
      const delta = Math.floor((startY - m.clientY) / 5);
      if (delta !== 0) {
        setBpm(Math.max(20, Math.min(999, startBpm + delta)));
      }
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  useEffect(() => {
    if (isEditingBpm) bpmInputRef.current?.focus();
  }, [isEditingBpm]);

  return (
    <div className="h-16 border-b flex items-center px-4 justify-between z-50 shadow-sm relative shrink-0 bg-[#14161a] border-[#222]">
      
      {/* LEFT: ACTIONS FICHIER & HISTORIQUE */}
      <div className="flex items-center space-x-3">
          {showBrowserToggle && (
              <button 
                onClick={onToggleBrowser} 
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all border border-white/10 ${isBrowserOpen ? 'bg-cyan-500 text-black' : 'bg-white/5 text-slate-400 hover:text-white'}`}
              >
                  <i className="fas fa-folder text-sm"></i>
              </button>
          )}

          <div className="hidden md:flex items-center space-x-2">
             <div className="flex items-center space-x-1 pr-2 border-r border-white/5">
                <button onClick={undo} disabled={!canUndo} className={`w-8 h-8 rounded-lg flex items-center justify-center border border-white/10 ${canUndo ? 'bg-white/5 hover:text-cyan-400' : 'opacity-30'}`}><i className="fas fa-undo text-[10px]"></i></button>
                <button onClick={redo} disabled={!canRedo} className={`w-8 h-8 rounded-lg flex items-center justify-center border border-white/10 ${canRedo ? 'bg-white/5 hover:text-cyan-400' : 'opacity-30'}`}><i className="fas fa-redo text-[10px]"></i></button>
             </div>
             
             <div className="flex items-center space-x-1 pr-2 border-r border-white/5">
                <button onClick={onOpenLoadMenu} className="h-8 px-3 rounded-lg flex items-center space-x-2 border border-white/10 bg-white/5 hover:bg-amber-500 hover:text-black text-amber-400 transition-all">
                    <i className="fas fa-folder-open text-[10px]"></i>
                    <span className="hidden xl:inline text-[9px] font-black uppercase">Ouvrir</span>
                </button>

                <button onClick={onOpenSaveMenu} className="h-8 px-3 rounded-lg flex items-center space-x-2 border border-white/10 bg-white/5 hover:bg-green-500 hover:text-black text-green-400 transition-all">
                    <i className="fas fa-save text-[10px]"></i>
                    <span className="hidden xl:inline text-[9px] font-black uppercase">Sauver</span>
                </button>
             </div>
             
             <button onClick={onExportMix} className="h-8 px-3 rounded-lg flex items-center space-x-2 border border-white/10 bg-purple-500/10 text-purple-400 hover:bg-purple-500 hover:text-black transition-all">
                 <i className="fas fa-compact-disc text-[10px]"></i>
                 <span className="hidden xl:inline text-[9px] font-black uppercase">Export</span>
             </button>
             
             <button onClick={onToggleDelayComp} className={`h-8 px-2 rounded-lg flex items-center space-x-1 border ${state.isDelayCompEnabled ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400' : 'bg-white/5 border-white/10 text-slate-600 hover:text-white'}`} title="Delay Compensation (PDC)">
                <div className={`w-1.5 h-1.5 rounded-full ${state.isDelayCompEnabled ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'}`}></div>
                <span className="text-[9px] font-black uppercase">PDC</span>
             </button>
          </div>
      </div>

      {/* CENTER: TRANSPORT CONTROLS */}
      <div className="flex flex-1 md:flex-none justify-center items-center space-x-4">
        <div className="hidden xl:block"><MasterMeter /></div>
        
        <div className="flex items-center space-x-3 bg-black/40 px-4 py-1.5 rounded-xl border border-white/5">
          <button onClick={stop} className="w-8 h-8 text-slate-500 hover:text-white transition-colors"><i className="fas fa-stop text-xs"></i></button>
          
          <button onClick={play} className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${state.isPlaying ? 'bg-[#00f2ff] text-black shadow-[0_0_15px_rgba(0,242,255,0.4)]' : 'bg-white text-black hover:scale-105'}`}>
             <i className={`fas ${state.isPlaying ? 'fa-pause' : 'fa-play'} text-sm`}></i>
          </button>
          
          <button onClick={toggleLoop} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${state.isLoopActive ? 'text-cyan-400 bg-cyan-500/10' : 'text-slate-500 hover:text-white'}`}>
             <i className="fas fa-sync-alt text-xs"></i>
          </button>
          
          <button className={`h-8 px-4 rounded-lg flex items-center space-x-2 border transition-all ${state.isRecording ? 'bg-red-600 border-red-500 text-white animate-pulse' : 'bg-white/5 border-white/10 text-slate-500 hover:text-white'}`}>
             <div className={`w-2 h-2 rounded-full ${state.isRecording ? 'bg-white' : 'bg-red-500'}`}></div>
             <span className="text-[9px] font-black uppercase tracking-widest hidden md:inline">Rec</span>
          </button>
        </div>
        
        <div className="flex flex-col items-center min-w-[80px]">
             <span className="hidden md:block text-[7px] text-slate-600 font-black uppercase tracking-[0.3em]">Time</span>
             <span className="font-mono text-[14px] font-bold text-cyan-400">{formatTime(state.currentTime)}</span>
        </div>
      </div>

      {/* RIGHT: VIEW & SETTINGS */}
      <div className="flex items-center space-x-4">
        
        <div className="hidden 2xl:block opacity-80 hover:opacity-100 transition-opacity">
           <MasterVisualizer />
        </div>

        <div className="hidden lg:flex items-center space-x-1 bg-black/40 rounded-xl p-1 border border-white/5">
            <button onClick={() => onChangeView('ARRANGEMENT')} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${currentView === 'ARRANGEMENT' ? 'bg-[#00f2ff] text-black' : 'text-slate-500 hover:text-white'}`}>Arrangement</button>
            <button onClick={() => onChangeView('MIXER')} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${currentView === 'MIXER' ? 'bg-[#00f2ff] text-black' : 'text-slate-500 hover:text-white'}`}>Mixer</button>
        </div>

        {/* BPM CONTROL */}
        <div className="hidden sm:flex flex-col items-end cursor-ns-resize group" onMouseDown={handleBpmMouseDown}>
           <div className="flex items-center space-x-2">
              {isEditingBpm ? (
                <input ref={bpmInputRef} type="text" value={tempBpm} onChange={(e) => setTempBpm(e.target.value)} onBlur={() => { setIsEditingBpm(false); setBpm(parseFloat(tempBpm) || 120); }} onKeyDown={(e) => e.key === 'Enter' && bpmInputRef.current?.blur()} className="w-10 bg-white/10 border border-cyan-500/50 rounded text-center text-[10px] font-black text-white outline-none" />
              ) : (
                <span className="text-[11px] font-black text-white">{state.bpm}</span>
              )}
              <span className="text-[7px] text-slate-500 font-bold uppercase tracking-widest">BPM</span>
           </div>
           <div className="w-14 h-1 bg-white/5 rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-cyan-500" style={{ width: `${Math.min(100, (state.bpm / 200) * 100)}%` }}></div>
           </div>
        </div>

        {/* USER */}
        {user && (
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-[10px] font-black text-white shadow-lg shadow-cyan-500/20">
                {user.username.charAt(0).toUpperCase()}
            </div>
        )}

        {children}
      </div>
    </div>
  );
};

export default TransportBar;
