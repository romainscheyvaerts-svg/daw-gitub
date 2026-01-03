
import React, { useState, useRef, useEffect } from 'react';
import { Track, PluginType, PluginInstance } from '../types';
import TrackHeader from './TrackHeader';

interface ArrangementViewProps {
  tracks: Track[];
  selectedTrackId: string | null;
  onSelectTrack: (id: string) => void;
  onUpdateTrack: (track: Track) => void;
  currentTime: number;
  bpm: number;
  onSeek: (time: number) => void;
  isLoopActive: boolean;
  loopStart: number;
  loopEnd: number;
  onSetLoop: (start: number, end: number) => void;
  onReorderTracks: (src: string, dst: string) => void;
  onDropPluginOnTrack: (id: string, type: PluginType) => void;
  recStartTime: number | null;
  onSelectPlugin?: (trackId: string, plugin: PluginInstance) => void;
  onRemovePlugin?: (trackId: string, pluginId: string) => void;
  onRequestAddPlugin?: (trackId: string, x: number, y: number) => void;
  onAddTrack?: (type: any, name?: string) => void;
  onDuplicateTrack?: (trackId: string) => void;
  onDeleteTrack?: (trackId: string) => void;
  onFreezeTrack?: (trackId: string) => void;
  onImportFile?: (file: File) => void;
  onEditClip?: (trackId: string, clipId: string, action: string, payload?: any) => void;
  isRecording?: boolean;
  onMoveClip?: (sourceTrackId: string, destTrackId: string, clipId: string) => void;
  onEditMidi?: (trackId: string, clipId: string) => void;
  onCreatePattern?: (trackId: string, time: number) => void;
  onSwapInstrument?: (trackId: string) => void;
}

const ArrangementView: React.FC<ArrangementViewProps> = ({ 
  tracks, selectedTrackId, onSelectTrack, onUpdateTrack, currentTime, bpm, onSeek, onSelectPlugin,
  onRemovePlugin, onRequestAddPlugin, onDropPluginOnTrack, onDeleteTrack, onDuplicateTrack, onEditClip,
  onMoveClip, onEditMidi, onCreatePattern, onSwapInstrument
}) => {
  const [zoomH, setZoomH] = useState(40);
  const [zoomV, setZoomV] = useState(120);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Canvas Drawing Loop (Timeline & Grid)
  useEffect(() => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx || !containerRef.current) return;
      
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      
      // Update canvas size
      if (canvasRef.current.width !== width) canvasRef.current.width = width;
      if (canvasRef.current.height !== height) canvasRef.current.height = height;

      // Draw Background
      ctx.fillStyle = '#0c0d10';
      ctx.fillRect(0, 0, width, height);

      // Draw Grid
      ctx.strokeStyle = '#222';
      ctx.beginPath();
      for(let x=0; x<width; x+=zoomH) { 
          ctx.moveTo(x, 0); 
          ctx.lineTo(x, height); 
      }
      ctx.stroke();

      // Draw Playhead
      const px = currentTime * zoomH;
      ctx.strokeStyle = '#00f2ff';
      ctx.lineWidth = 1;
      ctx.beginPath(); 
      ctx.moveTo(px, 0); 
      ctx.lineTo(px, height); 
      ctx.stroke();

  }, [currentTime, zoomH]);

  const handleTrackContextMenu = (e: React.MouseEvent, trackId: string) => {
      e.preventDefault();
      // Basic implementation or placeholder if ContextMenu component is managed outside
      if (onDeleteTrack) onDeleteTrack(trackId);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0c0d10]">
      {/* Timeline Header (Zoom Control) */}
      <div className="h-10 bg-[#14161a] border-b border-white/5 flex items-center px-4 justify-between">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Arrangement</span>
          <div className="flex items-center space-x-2">
             <i className="fas fa-search-plus text-slate-500 text-xs"></i>
             <input type="range" min="10" max="200" value={zoomH} onChange={e => setZoomH(Number(e.target.value))} className="w-24 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500" />
          </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
         {/* Track Headers (Left Pane) */}
         <div className="w-72 bg-[#14161a] border-r border-white/5 overflow-y-auto custom-scroll">
             {tracks.map(t => (
                 <div key={t.id} style={{ height: zoomV }} className="border-b border-white/5 relative">
                     <TrackHeader 
                        track={t} 
                        isSelected={selectedTrackId === t.id}
                        onSelect={() => onSelectTrack(t.id)}
                        onUpdate={onUpdateTrack}
                        onSelectPlugin={onSelectPlugin}
                        onRemovePlugin={onRemovePlugin}
                        onRequestAddPlugin={onRequestAddPlugin}
                        onDropPlugin={onDropPluginOnTrack}
                        onContextMenu={handleTrackContextMenu}
                        onDragStartTrack={() => {}}
                        onDragOverTrack={() => {}}
                        onDropTrack={() => {}}
                        onSwapInstrument={onSwapInstrument}
                     />
                 </div>
             ))}
             <div className="h-48"></div> {/* Spacer */}
         </div>
         
         {/* Timeline Canvas (Right Pane) */}
         <div ref={containerRef} className="flex-1 relative overflow-auto custom-scroll" onClick={(e) => {
             const rect = e.currentTarget.getBoundingClientRect();
             const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
             onSeek(x / zoomH);
         }}>
             <canvas ref={canvasRef} className="absolute top-0 left-0 pointer-events-none" style={{ width: '100%', height: '100%' }} />
             {/* Note: Clip rendering logic would go here, overlaying the canvas */}
         </div>
      </div>
    </div>
  );
};

export default ArrangementView;
