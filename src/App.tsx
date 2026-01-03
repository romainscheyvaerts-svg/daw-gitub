
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Track, TrackType, DAWState, ProjectPhase, MobileTab, TrackSend, Clip, AIAction, AutomationLane, AIChatMessage, ViewMode, User, Theme, DrumPad } from './types';
import { audioEngine } from './engine/AudioEngine';
import TransportBar from './components/TransportBar';
import SideBrowser from './components/SideBrowser';
import ArrangementView from './components/ArrangementView';
import MixerView from './components/MixerView';
import ChatAssistant from './components/ChatAssistant';
import ViewModeSwitcher from './components/ViewModeSwitcher';
import ContextMenu from './components/ContextMenu';
import TouchInteractionManager from './components/TouchInteractionManager';
import GlobalClipMenu from './components/GlobalClipMenu'; 
import TrackCreationBar from './components/TrackCreationBar';
import AuthScreen from './components/AuthScreen';
import AutomationEditorView from './components/AutomationEditorView';
import ShareModal from './components/ShareModal';
import SaveProjectModal from './components/SaveProjectModal';
import LoadProjectModal from './components/LoadProjectModal';
import ExportModal from './components/ExportModal'; 
import AudioSettingsPanel from './components/AudioSettingsPanel'; 
import { supabaseManager } from './services/SupabaseManager';
import { SessionSerializer } from './services/SessionSerializer';
import { getAIProductionAssistance } from './services/AIService';
import { SilenceDetector } from './engine/SilenceDetector';
import { novaBridge } from './services/NovaBridge';
import { ProjectIO } from './services/ProjectIO';
import { audioBufferToWav } from './services/AudioUtils';
import PianoRoll from './components/PianoRoll';
import { midiManager } from './services/MidiManager';
import { AUDIO_CONFIG, UI_CONFIG, NOTES, SCALES } from './utils/constants';
import { useDAW } from './context/DAWContext';

const createDefaultAutomation = (param: string, color: string): AutomationLane => ({
  id: `auto-${Date.now()}-${Math.random()}`,
  parameterName: param, points: [], color: color, isExpanded: false, min: 0, max: 1.5
});

const createInitialSends = (bpm: number): Track[] => [
    { id: 'send-delay', name: 'SEND 1', type: TrackType.SEND, color: '#00f2ff', isMuted: false, isSolo: false, isTrackArmed: false, isFrozen: false, volume: 0.8, pan: 0, outputTrackId: 'master', sends: [], clips: [], plugins: [], automationLanes: [createDefaultAutomation('volume', '#00f2ff')], totalLatency: 0 },
    { id: 'send-verb-short', name: 'SEND 2', type: TrackType.SEND, color: '#6366f1', isMuted: false, isSolo: false, isTrackArmed: false, isFrozen: false, volume: 0.8, pan: 0, outputTrackId: 'master', sends: [], clips: [], plugins: [], automationLanes: [createDefaultAutomation('volume', '#6366f1')], totalLatency: 0 },
    { id: 'send-verb-long', name: 'SEND 3', type: TrackType.SEND, color: '#a855f7', isMuted: false, isSolo: false, isTrackArmed: false, isFrozen: false, volume: 0.8, pan: 0, outputTrackId: 'master', sends: [], clips: [], plugins: [], automationLanes: [createDefaultAutomation('volume', '#a855f7')], totalLatency: 0 }
];

const createBusVox = (defaultSends: TrackSend[], bpm: number): Track => ({
  id: 'bus-vox', name: 'BUS VOX', type: TrackType.BUS, color: '#fbbf24', isMuted: false, isSolo: false, isTrackArmed: false, isFrozen: false, volume: 1.0, pan: 0, outputTrackId: 'master', sends: [...defaultSends], clips: [], plugins: [], automationLanes: [createDefaultAutomation('volume', '#fbbf24')], totalLatency: 0
});

const SaveOverlay: React.FC<{ progress: number; message: string }> = ({ progress, message }) => (
  <div className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 animate-in fade-in duration-300">
    <div className="w-64 space-y-4 text-center">
      <div className="w-16 h-16 mx-auto rounded-full border-4 border-cyan-500/30 border-t-cyan-500 animate-spin"></div>
      <h3 className="text-xl font-black text-white uppercase tracking-widest">{message}</h3>
      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full bg-cyan-500 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>
      <span className="text-xs font-mono text-cyan-400">{progress}%</span>
    </div>
  </div>
);

// Composant de Navigation Mobile
const MobileBottomNav: React.FC<{ activeTab: MobileTab, onTabChange: (tab: MobileTab) => void }> = ({ activeTab, onTabChange }) => (
    <div className="h-16 bg-[#0c0d10] border-t border-white/10 flex items-center justify-around z-50">
        <button onClick={() => onTabChange('PROJECT')} className={`flex flex-col items-center space-y-1 ${activeTab === 'PROJECT' ? 'text-cyan-400' : 'text-slate-500'}`}>
            <i className="fas fa-project-diagram text-lg"></i>
            <span className="text-[9px] font-black uppercase">Arrangement</span>
        </button>
        <button onClick={() => onTabChange('MIXER')} className={`flex flex-col items-center space-y-1 ${activeTab === 'MIXER' ? 'text-cyan-400' : 'text-slate-500'}`}>
            <i className="fas fa-sliders-h text-lg"></i>
            <span className="text-[9px] font-black uppercase">Mixer</span>
        </button>
        <button onClick={() => onTabChange('NOVA')} className={`flex flex-col items-center space-y-1 ${activeTab === 'NOVA' ? 'text-cyan-400' : 'text-slate-500'}`}>
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30 -mt-6 border-4 border-[#0c0d10]">
                <i className="fas fa-robot text-white text-lg"></i>
            </div>
            <span className="text-[9px] font-black uppercase">AI Nova</span>
        </button>
        <button onClick={() => onTabChange('BROWSER')} className={`flex flex-col items-center space-y-1 ${activeTab === 'BROWSER' ? 'text-cyan-400' : 'text-slate-500'}`}>
            <i className="fas fa-folder text-lg"></i>
            <span className="text-[9px] font-black uppercase">Browser</span>
        </button>
        <button onClick={() => onTabChange('AUTOMATION')} className={`flex flex-col items-center space-y-1 ${activeTab === 'AUTOMATION' ? 'text-cyan-400' : 'text-slate-500'}`}>
            <i className="fas fa-wave-square text-lg"></i>
            <span className="text-[9px] font-black uppercase">Auto</span>
        </button>
    </div>
);

export default function App() {
  const { state, user, setUser, play, stop, seek, setBpm, toggleLoop, toggleDelayComp, setView, addTrack, deleteTrack, updateTrack, selectTrack, loadProject, undo, redo, canUndo, canRedo } = useDAW();
  
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [saveState, setSaveState] = useState<{ isSaving: boolean; progress: number; message: string }>({ isSaving: false, progress: 0, message: '' });
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [exportModal, setExportModal] = useState<{ type: 'FRAUD' | 'RECORDING', link: string, message: string } | null>(null);
  const [browserWidth, setBrowserWidth] = useState(320); 
  const [isResizingBrowser, setIsResizingBrowser] = useState(false);
  const [isAudioSettingsOpen, setIsAudioSettingsOpen] = useState(false);
  const [isSaveMenuOpen, setIsSaveMenuOpen] = useState(false); 
  const [isLoadMenuOpen, setIsLoadMenuOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [midiEditorOpen, setMidiEditorOpen] = useState<{trackId: string, clipId: string} | null>(null);
  
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
      const u = supabaseManager.getUser();
      if(u) setUser(u);
  }, [setUser]);
  
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  const toggleTheme = () => { setTheme(prev => prev === 'dark' ? 'light' : 'dark'); };

  useEffect(() => { novaBridge.connect(); }, []);
  
  const [sideTab, setSideTab] = useState<'local' | 'fx' | 'nova' | 'store'>('store');
  const [shouldFocusSearch, setShouldFocusSearch] = useState(false);
  const [externalImportNotice, setExternalImportNotice] = useState<string | null>(null);
  const [aiNotification, setAiNotification] = useState<string | null>(null);
  
  const [automationMenu, setAutomationMenu] = useState<{ x: number, y: number, trackId: string, paramId: string, paramName: string, min: number, max: number } | null>(null);
  const [noArmedTrackError, setNoArmedTrackError] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('nova_view_mode');
    if (saved) return saved as ViewMode;
    return window.innerWidth < 768 ? 'MOBILE' : (window.innerWidth < 1024 ? 'TABLET' : 'DESKTOP');
  });
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTab>('PROJECT');
  const handleViewModeChange = (mode: ViewMode) => { setViewMode(mode); localStorage.setItem('nova_view_mode', mode); };
  useEffect(() => { document.body.setAttribute('data-view-mode', viewMode); }, [viewMode]);
  const isMobile = viewMode === 'MOBILE';
  const ensureAudioEngine = async () => { if (!audioEngine.ctx) await audioEngine.init(); if (audioEngine.ctx?.state === 'suspended') await audioEngine.ctx.resume(); };

  const handleLogout = async () => { await supabaseManager.signOut(); setUser(null); };
  const handleBuyLicense = (instrumentId: number) => { if (!user) return; const updatedUser = { ...user, owned_instruments: [...(user.owned_instruments || []), instrumentId] }; setUser(updatedUser); setAiNotification(`✅ Licence achetée avec succès ! Export débloqué.`); };
  
  const handleSaveCloud = async (projectName: string) => {
    if (!user) { setIsAuthOpen(true); return; }
    try {
        setSaveState({ isSaving: true, progress: 20, message: "Synchronisation..." });
        const stateToSave = { ...stateRef.current, name: projectName };
        const savedProject = await supabaseManager.saveUserSession(stateToSave);
        if (savedProject && savedProject.id) {
            // Update state with ID/Name
        }
        setSaveState({ isSaving: true, progress: 100, message: "Sauvegarde réussie !" });
        setTimeout(() => setSaveState({ isSaving: false, progress: 0, message: '' }), 1500);
        setAiNotification("✅ Sauvegarde Cloud terminée.");
    } catch (e: any) {
        setSaveState({ isSaving: false, progress: 0, message: '' });
        setAiNotification(`❌ Erreur Cloud: ${e.message}`);
    }
  };

  const handleSaveAsCopy = async (n: string) => { 
      try {
          await supabaseManager.saveProjectAsCopy(stateRef.current, n);
          setAiNotification("✅ Copie sauvegardée !");
      } catch(e: any) {
          setAiNotification(`❌ Erreur Copie: ${e.message}`);
      }
  };
  
  const handleSaveLocal = async (n: string) => { SessionSerializer.downloadLocalJSON(stateRef.current, n); };
  
  const handleLoadCloud = async (id: string) => { 
      try {
          const loaded = await supabaseManager.loadUserSession(id);
          if (loaded) loadProject(loaded);
      } catch(e) {
          console.error(e);
      }
  };
  
  const handleLoadLocalFile = async (f: File) => {
      try {
          if (f.name.endsWith('.zip')) {
              const loaded = await ProjectIO.loadProject(f);
              loadProject(loaded);
          } else {
              const text = await f.text();
              const loaded = JSON.parse(text);
              loadProject(loaded);
          }
      } catch(e) {
          console.error(e);
      }
  };
  
  const handleShareProject = async (e: string) => { setIsShareModalOpen(false); };
  const handleExportMix = async () => { setIsExportMenuOpen(true); };

  const handleEditClip = (trackId: string, clipId: string, action: string, payload?: any) => {
      const track = state.tracks.find(t => t.id === trackId);
      if (!track) return;
      let newClips = [...track.clips];
      const idx = newClips.findIndex(c => c.id === clipId);
      if (idx === -1 && action !== 'PASTE') return;
      
      switch(action) {
        case 'MOVE': if(idx > -1) newClips[idx] = { ...newClips[idx], start: payload.start }; break;
        case 'UPDATE_PROPS': if(idx > -1) newClips[idx] = { ...newClips[idx], ...payload }; break;
        case 'DELETE': if(idx > -1) newClips.splice(idx, 1); break;
        case 'MUTE': if(idx > -1) newClips[idx] = { ...newClips[idx], isMuted: !newClips[idx].isMuted }; break;
        case 'DUPLICATE': if(idx > -1) newClips.push({ ...newClips[idx], id: `clip-dup-${Date.now()}`, start: newClips[idx].start + newClips[idx].duration + 0.1 }); break;
        case 'RENAME': if(idx > -1) newClips[idx] = { ...newClips[idx], name: payload.name }; break;
        case 'SPLIT': 
            if(idx > -1) {
              const clip = newClips[idx];
              const splitTime = payload.time;
              if (splitTime > clip.start && splitTime < clip.start + clip.duration) {
                  const firstDuration = splitTime - clip.start;
                  const secondDuration = clip.duration - firstDuration;
                  newClips[idx] = { ...clip, duration: firstDuration };
                  newClips.push({ ...clip, id: `clip-split-${Date.now()}`, start: splitTime, duration: secondDuration, offset: clip.offset + firstDuration });
              }
            }
            break;
      }
      updateTrack({ ...track, clips: newClips });
  };

  const handleDuplicateTrack = useCallback((trackId: string) => {
      const track = state.tracks.find(t => t.id === trackId);
      if (!track) return;
      addTrack(track.type, `${track.name} (Copy)`);
  }, [state.tracks, addTrack]);
  
  const handleUniversalAudioImport = async (source: string | File, name: string) => {
    try {
      setExternalImportNotice(`Analyse du flux binaire : ${name}...`);
      await audioEngine.init();
      let targetUrl: string; let isObjectUrl = false;
      if (source instanceof File) { targetUrl = URL.createObjectURL(source); isObjectUrl = true; } else { targetUrl = source; }
      
      const response = await fetch(targetUrl);
      if (!response.ok) {
          throw new Error(`Fichier audio inaccessible (HTTP ${response.status})`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      if (isObjectUrl) URL.revokeObjectURL(targetUrl);
      const audioBuffer = await audioEngine.ctx!.decodeAudioData(arrayBuffer);
      const newClip: Clip = { id: `c-universal-${Date.now()}`, name: name.replace(/_/g, ' ').toUpperCase(), start: 0, duration: audioBuffer.duration, offset: 0, fadeIn: 0.05, fadeOut: 0.05, type: TrackType.AUDIO, color: '#eab308', buffer: audioBuffer };
      
      setExternalImportNotice(null); setAiNotification(`Import terminé : [${name}]`);
    } catch (err: any) { 
        console.error("[IMPORT] Error:", err); 
        setExternalImportNotice(`Erreur Import: ${err.message}`); 
        setTimeout(() => setExternalImportNotice(null), 3000); 
    }
  };

  useEffect(() => { (window as any).DAW_CORE = { handleAudioImport: (url: string, name: string) => handleUniversalAudioImport(url, name) }; }, []);

  const handleBrowserResizeStart = (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = browserWidth;
      setIsResizingBrowser(true);
      
      const onMove = (m: MouseEvent) => {
          const delta = m.clientX - startX;
          setBrowserWidth(Math.max(200, Math.min(600, startWidth + delta)));
      };
      
      const onUp = () => {
          setIsResizingBrowser(false);
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
      };
      
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
  };

  const handleMoveClip = useCallback((sourceTrackId: string, destTrackId: string, clipId: string) => {
      const sourceTrack = state.tracks.find(t => t.id === sourceTrackId);
      const destTrack = state.tracks.find(t => t.id === destTrackId);
      if (!sourceTrack || !destTrack) return;
      
      const clip = sourceTrack.clips.find(c => c.id === clipId);
      if (!clip) return;
      
      const newSourceClips = sourceTrack.clips.filter(c => c.id !== clipId);
      const newDestClips = [...destTrack.clips, { ...clip }]; 
      
      updateTrack({ ...sourceTrack, clips: newSourceClips });
      updateTrack({ ...destTrack, clips: newDestClips });
  }, [state.tracks, updateTrack]);

  const handleCreatePatternAndOpen = useCallback((trackId: string, time: number) => {
      const track = state.tracks.find(t => t.id === trackId);
      if (!track) return;

      const newClipId = `clip-midi-${Date.now()}`;
      const newClip: Clip = {
          id: newClipId,
          name: 'Pattern MIDI',
          start: time,
          duration: 4, 
          offset: 0,
          fadeIn: 0,
          fadeOut: 0,
          type: TrackType.MIDI,
          color: '#22c55e',
          notes: []
      };
      updateTrack({ ...track, clips: [...track.clips, newClip] });
      setMidiEditorOpen({ trackId, clipId: newClipId });
  }, [state.tracks, updateTrack]);

  const handleSwapInstrument = useCallback((trackId: string) => {
      setSideTab('fx'); 
      setShouldFocusSearch(true);
  }, []);

  const handleAddBus = useCallback(() => {
      addTrack(TrackType.BUS, "Group Bus");
  }, [addTrack]);

  const handleCreateAutomationLane = useCallback(() => {
      if (!automationMenu) return;
      const { trackId, paramId, min, max } = automationMenu;
      const track = state.tracks.find(t => t.id === trackId);
      if (!track) return;
      
      if (track.automationLanes.some(l => l.parameterName === paramId)) return;

      let val = 0;
      if (paramId === 'volume') val = track.volume;
      else if (paramId === 'pan') val = track.pan;

      const newLane: AutomationLane = {
          id: `auto-${Date.now()}`,
          parameterName: paramId,
          points: [{ id: 'init', time: 0, value: val }],
          color: track.color,
          isExpanded: true,
          min, max
      };
      updateTrack({ ...track, automationLanes: [...track.automationLanes, newLane] });
      setAutomationMenu(null);
  }, [automationMenu, state.tracks, updateTrack]);

  const handleLoadDrumSample = useCallback(async (trackId: string, padId: number, file: File) => {
      try {
          const arrayBuffer = await file.arrayBuffer();
          await ensureAudioEngine();
          const audioBuffer = await audioEngine.ctx!.decodeAudioData(arrayBuffer);
          
          audioEngine.loadDrumRackSample(trackId, padId, audioBuffer);
          
          const track = state.tracks.find(t => t.id === trackId);
          if (!track || !track.drumPads) return;
          
          const newPads = track.drumPads.map(p => 
              p.id === padId ? { ...p, sampleName: file.name, buffer: audioBuffer } : p
          );
          
          updateTrack({ ...track, drumPads: newPads });
      } catch (e) {
          console.error("Error loading drum sample:", e);
      }
  }, [state.tracks, updateTrack]);

  useEffect(() => {
    (window as any).DAW_CONTROL = {
      play: play,
      stop: stop,
      record: () => {}, 
      seek: seek,
      setBpm: setBpm,
      setLoop: (start: number, end: number, active?: boolean) => { /* Loop logic */ },
      scrub: (time: number, velocity: number) => audioEngine.scrub(stateRef.current.tracks, time, velocity),
      stopScrubbing: () => audioEngine.stopScrubbing(),
      setVolume: (tid: string, vol: number) => { const t = stateRef.current.tracks.find(tr => tr.id === tid); if (t) updateTrack({ ...t, volume: vol }); },
      setPan: (tid: string, pan: number) => { const t = stateRef.current.tracks.find(tr => tr.id === tid); if (t) updateTrack({ ...t, pan }); },
      muteTrack: (tid: string, mute: boolean) => { const t = stateRef.current.tracks.find(tr => tr.id === tid); if (t) updateTrack({ ...t, isMuted: mute }); },
      soloTrack: (tid: string, solo: boolean) => { const t = stateRef.current.tracks.find(tr => tr.id === tid); if (t) updateTrack({ ...t, isSolo: solo }); },
      renameTrack: (tid: string, name: string) => { const t = stateRef.current.tracks.find(tr => tr.id === tid); if (t) updateTrack({ ...t, name }); },
      duplicateTrack: handleDuplicateTrack, 
      addTrack: addTrack,
      deleteTrack: deleteTrack, 
      setSendLevel: (tid: string, sid: string, lvl: number) => { /* ... */ },
      runMasterSync: () => {}, 
      normalizeClip: (tid: string, cid: string) => handleEditClip(tid, cid, 'NORMALIZE'),
      splitClip: (tid: string, cid: string, time: number) => handleEditClip(tid, cid, 'SPLIT', { time }),
      removeSilence: (tid: string) => {}, 
      syncAutoTuneScale: (rootKey: number, scale: string) => { /* ... */ },
      getInstrumentalBuffer: () => null, 
      getState: () => stateRef.current,
      previewMidiNote: (trackId: string, pitch: number, duration?: number) => audioEngine.previewMidiNote(trackId, pitch, duration),
      editClip: handleEditClip,
      loadDrumSample: handleLoadDrumSample
    };
  }, [play, stop, seek, setBpm, updateTrack, handleDuplicateTrack, addTrack, deleteTrack, handleEditClip, handleLoadDrumSample]);

  const executeAIAction = (a: AIAction) => { 
      console.log('AI Action executed:', a.action);
  };

  if (!user) { return <AuthScreen onAuthenticated={(u) => { setUser(u); setIsAuthOpen(false); }} />; }

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden relative transition-colors duration-300" style={{ backgroundColor: 'var(--bg-main)', color: 'var(--text-primary)', cursor: isResizingBrowser ? 'col-resize' : 'default' }}>
      {saveState && saveState.isSaving && <SaveOverlay progress={saveState.progress} message={saveState.message} />}

      <div className="relative z-50">
        <TransportBar 
          currentView={state.currentView} onChangeView={setView} 
          
          onOpenSaveMenu={() => setIsSaveMenuOpen(true)}
          onOpenLoadMenu={() => setIsLoadMenuOpen(true)}
          
          onExportMix={handleExportMix} onShareProject={() => setIsShareModalOpen(true)}
          onOpenAudioEngine={() => setIsAudioSettingsOpen(true)}
          
          onToggleDelayComp={toggleDelayComp}

          showBrowserToggle={!isMobile} isBrowserOpen={browserWidth > 0} onToggleBrowser={() => setBrowserWidth(prev => prev > 0 ? 0 : 320)}
        >
          <div className="ml-4 border-l border-white/5 pl-4"><ViewModeSwitcher currentMode={viewMode} onChange={handleViewModeChange} /></div>
        </TransportBar>
      </div>
      
      <TrackCreationBar onCreateTrack={addTrack} />
      <TouchInteractionManager />
      <GlobalClipMenu />

      <div className="flex-1 flex overflow-hidden relative">
        {(!isMobile || activeMobileTab === 'BROWSER') && browserWidth > 0 && (
          <aside className={`${isMobile ? 'w-full absolute inset-0 z-40' : ''} transition-none z-20 flex bg-[#08090b]`} style={{ width: isMobile ? '100%' : `${browserWidth}px` }}>
            <div className="flex-1 overflow-hidden relative border-r border-white/5 h-full">
                <SideBrowser 
                    activeTabOverride={sideTab} 
                    onTabChange={setSideTab} 
                    shouldFocusSearch={shouldFocusSearch} 
                    onSearchFocused={() => setShouldFocusSearch(false)} 
                    onLocalImport={(f) => handleUniversalAudioImport(f, f.name.split('.')[0])} 
                    user={user} 
                    onBuyLicense={handleBuyLicense} 
                />
            </div>
            {!isMobile && (<div className="w-1 cursor-col-resize hover:bg-cyan-500/50 active:bg-cyan-500 transition-colors z-50 flex items-center justify-center group h-full" onMouseDown={handleBrowserResizeStart}><div className="w-0.5 h-8 bg-white/20 rounded-full group-hover:bg-white/50" /></div>)}
          </aside>
        )}

        <main className="flex-1 flex flex-col overflow-hidden relative min-w-0">
          {((!isMobile && state.currentView === 'ARRANGEMENT') || (isMobile && activeMobileTab === 'PROJECT')) && (
            <ArrangementView 
               tracks={state.tracks} currentTime={state.currentTime} 
               isLoopActive={state.isLoopActive} loopStart={state.loopStart} loopEnd={state.loopEnd}
               onSetLoop={(start, end) => { /* Requires context update to set loop */ }}
               onSeek={seek} bpm={state.bpm} 
               selectedTrackId={state.selectedTrackId} onSelectTrack={selectTrack} 
               onUpdateTrack={updateTrack} onReorderTracks={() => {}} 
               onDropPluginOnTrack={(trackId, type) => {}}
               onAddTrack={addTrack} onDuplicateTrack={handleDuplicateTrack} onDeleteTrack={deleteTrack} 
               onFreezeTrack={(tid) => {}} onImportFile={(f) => {}}
               onEditClip={handleEditClip} isRecording={state.isRecording} recStartTime={state.recStartTime}
               onMoveClip={handleMoveClip}
               onEditMidi={(trackId, clipId) => setMidiEditorOpen({ trackId, clipId })}
               onCreatePattern={handleCreatePatternAndOpen}
               onSwapInstrument={handleSwapInstrument}
            /> 
          )}
          
          {((!isMobile && state.currentView === 'MIXER') || (isMobile && activeMobileTab === 'MIXER')) && (
             <MixerView 
                tracks={state.tracks} 
                onUpdateTrack={updateTrack} 
                onAddBus={handleAddBus}
             />
          )}

          {((!isMobile && state.currentView === 'AUTOMATION') || (isMobile && activeMobileTab === 'AUTOMATION')) && (
             <AutomationEditorView 
               tracks={state.tracks} currentTime={state.currentTime} bpm={state.bpm} zoomH={40} 
               onUpdateTrack={updateTrack} onSeek={seek}
             />
          )}
        </main>
      </div>
      
      {isMobile && <MobileBottomNav activeTab={activeMobileTab} onTabChange={setActiveMobileTab} />}

      {isSaveMenuOpen && (
          <SaveProjectModal 
              isOpen={isSaveMenuOpen} 
              onClose={() => setIsSaveMenuOpen(false)} 
              currentName={state.name} 
              user={user} 
              onSaveCloud={handleSaveCloud}
              onSaveLocal={handleSaveLocal}
              onSaveAsCopy={handleSaveAsCopy}
              onOpenAuth={() => setIsAuthOpen(true)}
          />
      )}

      {isLoadMenuOpen && (
          <LoadProjectModal 
              isOpen={isLoadMenuOpen}
              onClose={() => setIsLoadMenuOpen(false)}
              user={user}
              onLoadCloud={handleLoadCloud}
              onLoadLocal={handleLoadLocalFile}
              onOpenAuth={() => setIsAuthOpen(true)}
          />
      )}

      {isExportMenuOpen && <ExportModal isOpen={isExportMenuOpen} onClose={() => setIsExportMenuOpen(false)} projectState={state} />}
      {isAuthOpen && <AuthScreen onAuthenticated={(u) => { setUser(u); setIsAuthOpen(false); }} />}
      
      {automationMenu && <ContextMenu x={automationMenu.x} y={automationMenu.y} onClose={() => setAutomationMenu(null)} items={[{ label: `Automate: ${automationMenu.paramName}`, icon: 'fa-wave-square', onClick: handleCreateAutomationLane }]} />}
      
      {midiEditorOpen && state.tracks.find(t => t.id === midiEditorOpen.trackId) && (
          <div className="fixed inset-0 z-[250] bg-[#0c0d10] flex flex-col animate-in slide-in-from-bottom-10 duration-200">
             <PianoRoll 
                 track={state.tracks.find(t => t.id === midiEditorOpen.trackId)!} 
                 clipId={midiEditorOpen.clipId} 
                 bpm={state.bpm} 
                 currentTime={state.currentTime}
                 onUpdateTrack={updateTrack}
                 onClose={() => setMidiEditorOpen(null)}
             />
          </div>
      )}

      {isAudioSettingsOpen && <AudioSettingsPanel onClose={() => setIsAudioSettingsOpen(false)} />}
      
      <div className={isMobile && activeMobileTab !== 'NOVA' ? 'hidden' : ''}>
        <ChatAssistant onSendMessage={(msg) => getAIProductionAssistance(stateRef.current, msg)} onExecuteAction={executeAIAction} externalNotification={aiNotification} isMobile={isMobile} forceOpen={isMobile && activeMobileTab === 'NOVA'} onClose={() => setActiveMobileTab('PROJECT')} />
      </div>
      
      {isShareModalOpen && user && <ShareModal isOpen={isShareModalOpen} onClose={() => setIsShareModalOpen(false)} onShare={handleShareProject} projectName={state.name} />}
    </div>
  );
}
