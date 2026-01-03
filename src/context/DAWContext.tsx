import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { DAWState, Track, TrackType, ProjectPhase, PluginInstance, AutomationLane, User, PluginType, ViewType } from '../types';
import { audioEngine } from '../engine/AudioEngine';
import { AUDIO_CONFIG, UI_CONFIG } from '../utils/constants';
import { generateId } from '../utils/helpers';

// --- FACTORIES ---
const createDefaultAutomation = (param: string, color: string): AutomationLane => ({
  id: generateId('auto'),
  parameterName: param,
  points: [],
  color: color,
  isExpanded: false,
  min: 0,
  max: 1.5
});

const createDefaultPlugin = (type: PluginType): PluginInstance => {
   return {
       id: generateId('pl'),
       name: type,
       type: type,
       isEnabled: true,
       params: {},
       latency: 0
   };
};

const createInitialState = (): DAWState => ({
  id: 'proj-1',
  name: 'New Project',
  bpm: 120,
  isPlaying: false,
  isRecording: false,
  currentTime: 0,
  isLoopActive: false,
  loopStart: 0,
  loopEnd: 8,
  tracks: [],
  selectedTrackId: null,
  currentView: 'ARRANGEMENT',
  projectPhase: ProjectPhase.SETUP,
  isLowLatencyMode: false,
  isRecModeActive: false,
  systemMaxLatency: 0,
  recStartTime: null,
  isDelayCompEnabled: false
});

// --- HOOK: UNDO / REDO ---
const useUndoRedo = (initialState: DAWState) => {
  const [history, setHistory] = useState<{ past: DAWState[]; present: DAWState; future: DAWState[]; }>({ 
    past: [], 
    present: initialState, 
    future: [] 
  });
  
  const MAX_HISTORY = 50;

  const setState = useCallback((updater: DAWState | ((prev: DAWState) => DAWState)) => {
    setHistory(curr => {
      const newState = typeof updater === 'function' ? updater(curr.present) : updater;
      if (newState === curr.present) return curr;
      
      // Optimization: Don't push to history if only playback-related properties changed
      const isPlaybackUpdate = 
          newState.currentTime !== curr.present.currentTime && 
          newState.isPlaying === curr.present.isPlaying &&
          newState.tracks === curr.present.tracks; // Shallow check for track array ref

      if (isPlaybackUpdate) {
          return { ...curr, present: newState };
      }

      return { 
          past: [...curr.past, curr.present].slice(-MAX_HISTORY), 
          present: newState, 
          future: [] 
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory(curr => {
      if (curr.past.length === 0) return curr;
      const previous = curr.past[curr.past.length - 1];
      const newPast = curr.past.slice(0, -1);
      return { past: newPast, present: previous, future: [curr.present, ...curr.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory(curr => {
      if (curr.future.length === 0) return curr;
      const next = curr.future[0];
      const newFuture = curr.future.slice(1);
      return { past: [...curr.past, curr.present], present: next, future: newFuture };
    });
  }, []);

  return { state: history.present, setState, undo, redo, canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
};

// --- TYPE DU CONTEXTE ---
interface DAWContextType {
  state: DAWState;
  user: User | null;
  setUser: (user: User | null) => void;
  
  // Transport Actions
  play: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setBpm: (bpm: number) => void;
  toggleLoop: () => void;
  toggleDelayComp: () => void;
  setView: (view: ViewType) => void;
  
  // Track Actions
  addTrack: (type: TrackType, name?: string) => void;
  deleteTrack: (id: string) => void;
  updateTrack: (track: Track) => void;
  selectTrack: (id: string) => void;
  
  // Plugin Actions
  addPlugin: (trackId: string, type: PluginType, metadata?: any) => void;
  removePlugin: (trackId: string, pluginId: string) => void;
  updatePluginParams: (trackId: string, pluginId: string, params: any) => void;
  
  // Project Actions
  saveProject: () => Promise<void>;
  loadProject: (data: DAWState) => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const DAWContext = createContext<DAWContextType | null>(null);

// --- PROVIDER ---
export const DAWProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Use custom hook instead of simple useState
  const { state, setState, undo, redo, canUndo, canRedo } = useUndoRedo(createInitialState());
  const [user, setUser] = useState<User | null>(null);
  
  // Ref pour accès immédiat dans les callbacks asynchrones
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // --- AUDIO ENGINE SYNC ---
  useEffect(() => {
    if (audioEngine.ctx) {
        state.tracks.forEach(t => audioEngine.updateTrack(t, state.tracks));
        // Also update delay compensation mode if changed
        audioEngine.setDelayCompensation(state.isDelayCompEnabled);
    }
  }, [state.tracks, state.isDelayCompEnabled]);

  // Boucle d'animation
  useEffect(() => {
    let animId: number;
    const loop = () => {
      if (stateRef.current.isPlaying) {
        const time = audioEngine.getCurrentTime();
        setState(prev => ({ ...prev, currentTime: time }));
        animId = requestAnimationFrame(loop);
      }
    };
    if (state.isPlaying) animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [state.isPlaying, setState]);

  // --- ACTIONS ---

  const play = useCallback(async () => {
    await audioEngine.init();
    if (audioEngine.ctx?.state === 'suspended') await audioEngine.ctx.resume();

    if (state.isPlaying) {
      audioEngine.stopAll();
      setState(s => ({ ...s, isPlaying: false }));
    } else {
      audioEngine.startPlayback(state.currentTime, state.tracks);
      setState(s => ({ ...s, isPlaying: true }));
    }
  }, [state.isPlaying, state.currentTime, state.tracks, setState]);

  const stop = useCallback(() => {
    audioEngine.stopAll();
    audioEngine.seekTo(0, state.tracks, false);
    setState(s => ({ ...s, isPlaying: false, currentTime: 0, isRecording: false }));
  }, [state.tracks, setState]);

  const seek = useCallback((time: number) => {
    audioEngine.seekTo(time, state.tracks, state.isPlaying);
    setState(s => ({ ...s, currentTime: time }));
  }, [state.tracks, state.isPlaying, setState]);

  const toggleLoop = useCallback(() => {
      setState(prev => ({ ...prev, isLoopActive: !prev.isLoopActive }));
  }, [setState]);

  const toggleDelayComp = useCallback(() => {
      setState(prev => ({ ...prev, isDelayCompEnabled: !prev.isDelayCompEnabled }));
  }, [setState]);

  const setView = useCallback((view: ViewType) => {
      setState(prev => ({ ...prev, currentView: view }));
  }, [setState]);

  const addTrack = useCallback((type: TrackType, name?: string) => {
    const newTrack: Track = {
        id: generateId('track'),
        name: name || `${type} Track`,
        type,
        color: UI_CONFIG.TRACK_COLORS[state.tracks.length % UI_CONFIG.TRACK_COLORS.length],
        isMuted: false, isSolo: false, isTrackArmed: false, isFrozen: false,
        volume: 1.0, pan: 0, outputTrackId: 'master',
        sends: [], clips: [], plugins: [], automationLanes: [], totalLatency: 0
    };
    setState(prev => ({ ...prev, tracks: [...prev.tracks, newTrack] }));
  }, [state.tracks, setState]);

  const deleteTrack = useCallback((id: string) => {
    setState(prev => ({
        ...prev,
        tracks: prev.tracks.filter(t => t.id !== id),
        selectedTrackId: prev.selectedTrackId === id ? null : prev.selectedTrackId
    }));
  }, [setState]);

  const updateTrack = useCallback((track: Track) => {
    setState(prev => ({
        ...prev,
        tracks: prev.tracks.map(t => t.id === track.id ? track : t)
    }));
  }, [setState]);

  // Gestion des Plugins
  const addPlugin = useCallback((trackId: string, type: PluginType, metadata?: any) => {
      setState(prev => {
          const track = prev.tracks.find(t => t.id === trackId);
          if (!track) return prev;

          let newPlugin = createDefaultPlugin(type);
          
          if (type === 'VST3' && metadata) {
              newPlugin.name = metadata.name;
              newPlugin.params = { ...newPlugin.params, localPath: metadata.localPath };
          }

          const updatedTrack = { ...track, plugins: [...track.plugins, newPlugin] };
          
          return {
              ...prev,
              tracks: prev.tracks.map(t => t.id === trackId ? updatedTrack : t)
          };
      });
  }, [setState]);

  const removePlugin = useCallback((trackId: string, pluginId: string) => {
      setState(prev => {
          const track = prev.tracks.find(t => t.id === trackId);
          if (!track) return prev;

          const updatedTrack = { 
              ...track, 
              plugins: track.plugins.filter(p => p.id !== pluginId) 
          };
          
          return {
              ...prev,
              tracks: prev.tracks.map(t => t.id === trackId ? updatedTrack : t)
          };
      });
  }, [setState]);

  const updatePluginParams = useCallback((trackId: string, pluginId: string, params: any) => {
      setState(prev => ({
          ...prev,
          tracks: prev.tracks.map(t => t.id === trackId ? {
              ...t,
              plugins: t.plugins.map(p => p.id === pluginId ? { ...p, params: { ...p.params, ...params } } : p)
          } : t)
      }));
      
      const node = audioEngine.getPluginNodeInstance(trackId, pluginId);
      if (node && node.updateParams) node.updateParams(params);
  }, [setState]);

  const value = {
    state, user, setUser,
    play, stop, seek, 
    setBpm: (bpm: number) => setState(s => ({ ...s, bpm })),
    toggleLoop, toggleDelayComp, setView,
    addTrack, deleteTrack, updateTrack, selectTrack: (id: string) => setState(s => ({ ...s, selectedTrackId: id })),
    addPlugin, removePlugin, updatePluginParams,
    saveProject: async () => {},
    loadProject: (data: DAWState) => setState(data),
    undo, redo, canUndo, canRedo
  };

  return <DAWContext.Provider value={value}>{children}</DAWContext.Provider>;
};

export const useDAW = () => {
  const context = useContext(DAWContext);
  if (!context) throw new Error("useDAW must be used within a DAWProvider");
  return context;
};