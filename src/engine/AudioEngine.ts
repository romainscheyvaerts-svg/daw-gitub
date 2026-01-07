
import { Track, Clip, PluginInstance, TrackType, TrackSend, AutomationLane } from '../types';
import { ReverbNode } from '../plugins/ReverbPlugin';
import { SyncDelayNode } from '../plugins/DelayPlugin';
import { ChorusNode } from '../plugins/ChorusPlugin';
import { FlangerNode } from '../plugins/FlangerPlugin';
import { VocalDoublerNode } from '../plugins/DoublerPlugin';
import { StereoSpreaderNode } from '../plugins/StereoSpreaderPlugin';
import { AutoTuneNode } from '../plugins/AutoTunePlugin'; // Corrected Import
import { CompressorNode } from '../plugins/CompressorPlugin';
import { DeEsserNode } from '../plugins/DeEsserPlugin';
import { DenoiserNode } from '../plugins/DenoiserPlugin';
import { ProEQ12Node } from '../plugins/ProEQ12Plugin';
import { VocalSaturatorNode } from '../plugins/VocalSaturatorPlugin';
import { MasterSyncNode } from '../plugins/MasterSyncPlugin';
import { Synthesizer } from './Synthesizer';
import { DrumRackNode } from './DrumRackNode';
import { DrumSamplerNode } from './DrumSamplerNode';
import { MelodicSamplerNode } from './MelodicSamplerNode';
import { AudioSampler } from './AudioSampler';
import { novaBridge } from '../services/NovaBridge';
import { PLUGIN_REGISTRY } from '../plugins/registry'; // Needed to access factories in updateTrack

interface TrackDSP {
  input: GainNode;          
  output: GainNode;         
  panner: StereoPannerNode; 
  gain: GainNode;           
  analyzer: AnalyserNode;   
  inputAnalyzer?: AnalyserNode;
  pluginChain: Map<string, { input: AudioNode; output: AudioNode; instance: any }>; 
  sends: Map<string, GainNode>;
  
  // Instruments
  synth?: Synthesizer;
  drumRack?: DrumRackNode;
  drumSampler?: DrumSamplerNode;
  melodicSampler?: MelodicSamplerNode;
  sampler?: AudioSampler;
}

interface ScheduledSource {
  source: AudioBufferSourceNode;
  gain: GainNode;
  clipId: string;
}

export class AudioEngine {
  public ctx: AudioContext | null = null;
  private masterOutput: GainNode | null = null;
  private masterAnalyzer: AnalyserNode | null = null;
  public masterAnalyzerL: AnalyserNode | null = null;
  public masterAnalyzerR: AnalyserNode | null = null;
  private masterSplitter: ChannelSplitterNode | null = null;
  
  // Preview
  public previewAnalyzer: AnalyserNode | null = null;
  private previewGain: GainNode | null = null;
  private previewSource: AudioBufferSourceNode | null = null;
  
  // Graph Audio
  private tracksDSP: Map<string, TrackDSP> = new Map();
  private activeSources: Map<string, ScheduledSource> = new Map();

  // Scheduling State
  private isPlaying: boolean = false;
  private schedulerTimer: number | null = null;
  private nextScheduleTime: number = 0;
  private playbackStartTime: number = 0; 
  private pausedAt: number = 0; 
  public sampleRate: number = 44100;

  // Latency & Rec
  private isRecMode: boolean = false;
  private isDelayCompEnabled: boolean = false;

  // Constants
  private readonly LOOKAHEAD_MS = 25.0; 
  private readonly SCHEDULE_AHEAD_SEC = 0.1; 

  // Recording
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recStream: MediaStream | null = null;
  private recStartTime: number = 0;

  constructor() {}

  public async init() {
    if (this.ctx) return;
    
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AudioContextClass({ 
      latencyHint: 'interactive', 
      sampleRate: 44100 
    });
    this.sampleRate = this.ctx.sampleRate;

    this.masterOutput = this.ctx.createGain();
    
    // Master Analyzer (Stereo)
    this.masterAnalyzer = this.ctx.createAnalyser();
    this.masterAnalyzer.fftSize = 2048;
    this.masterAnalyzer.smoothingTimeConstant = 0.8;
    
    this.masterSplitter = this.ctx.createChannelSplitter(2);
    this.masterAnalyzerL = this.ctx.createAnalyser();
    this.masterAnalyzerR = this.ctx.createAnalyser();
    this.masterAnalyzerL.fftSize = 2048;
    this.masterAnalyzerR.fftSize = 2048;

    this.masterOutput.connect(this.masterAnalyzer);
    this.masterAnalyzer.connect(this.masterSplitter);
    this.masterSplitter.connect(this.masterAnalyzerL, 0);
    this.masterSplitter.connect(this.masterAnalyzerR, 1);
    
    this.masterAnalyzer.connect(this.ctx.destination);

    // Preview Channel
    this.previewGain = this.ctx.createGain();
    this.previewAnalyzer = this.ctx.createAnalyser();
    this.previewAnalyzer.fftSize = 256;
    this.previewGain.connect(this.previewAnalyzer);
    this.previewAnalyzer.connect(this.ctx.destination);
  }

  public async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  // --- PREVIEW METHODS ---
  public async playHighResPreview(url: string, onEnd?: () => void) {
      await this.init();
      this.stopPreview();
      try {
          const response = await fetch(url);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
          
          this.previewSource = this.ctx!.createBufferSource();
          this.previewSource.buffer = audioBuffer;
          this.previewSource.connect(this.previewGain!);
          
          this.previewSource.onended = () => {
              this.previewSource = null;
              if (onEnd) onEnd();
          };
          
          this.previewSource.start(0);
      } catch (e) {
          console.error("Preview Playback Error", e);
          if (onEnd) onEnd();
      }
  }

  public stopPreview() {
      if (this.previewSource) {
          try { this.previewSource.stop(); } catch(e){}
          this.previewSource.disconnect();
          this.previewSource = null;
      }
  }

  // --- MIDI & INSTRUMENT TRIGGERS ---
  
  public triggerTrackAttack(trackId: string, pitch: number, velocity: number) {
      const dsp = this.tracksDSP.get(trackId);
      if (!dsp) return;
      const now = this.ctx!.currentTime;
      
      if (dsp.synth) dsp.synth.triggerAttack(pitch, velocity, now);
      if (dsp.drumRack) dsp.drumRack.trigger(pitch, velocity, now);
      if (dsp.drumSampler) dsp.drumSampler.trigger(velocity, now);
      if (dsp.melodicSampler) dsp.melodicSampler.triggerAttack(pitch, velocity, now);
      if (dsp.sampler) dsp.sampler.triggerAttack(pitch, velocity, now);
  }

  public triggerTrackRelease(trackId: string, pitch: number) {
      const dsp = this.tracksDSP.get(trackId);
      if (!dsp) return;
      const now = this.ctx!.currentTime;

      if (dsp.synth) dsp.synth.triggerRelease(pitch, now);
      if (dsp.melodicSampler) dsp.melodicSampler.triggerRelease(pitch, now);
      if (dsp.sampler) dsp.sampler.triggerRelease(pitch, now);
  }

  public previewMidiNote(trackId: string, pitch: number, duration: number = 0.5) {
      this.triggerTrackAttack(trackId, pitch, 0.8);
      setTimeout(() => this.triggerTrackRelease(trackId, pitch), duration * 1000);
  }

  public loadDrumRackSample(trackId: string, padId: number, buffer: AudioBuffer) {
      const dsp = this.tracksDSP.get(trackId);
      if (dsp && dsp.drumRack) {
          dsp.drumRack.loadSample(padId, buffer);
      }
  }

  public loadSamplerBuffer(trackId: string, buffer: AudioBuffer) {
      const dsp = this.tracksDSP.get(trackId);
      if (!dsp) return;
      if (dsp.sampler) dsp.sampler.loadBuffer(buffer);
      if (dsp.melodicSampler) dsp.melodicSampler.loadBuffer(buffer);
      if (dsp.drumSampler) dsp.drumSampler.loadBuffer(buffer);
  }

  public getDrumSamplerNode(trackId: string) { return this.tracksDSP.get(trackId)?.drumSampler || null; }
  public getMelodicSamplerNode(trackId: string) { return this.tracksDSP.get(trackId)?.melodicSampler || null; }
  
  // --- TRANSPORT & MIXING ---

  public setBpm(bpm: number) {
      // Propagate BPM to plugins if needed (delays etc)
      this.tracksDSP.forEach(dsp => {
          dsp.pluginChain.forEach(entry => {
              if (entry.instance.updateParams) {
                  entry.instance.updateParams({ bpm });
              }
          });
      });
  }

  public setTrackVolume(trackId: string, volume: number) {
      const dsp = this.tracksDSP.get(trackId);
      if (dsp && this.ctx) {
          dsp.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.02);
      }
  }

  public setTrackPan(trackId: string, pan: number) {
      const dsp = this.tracksDSP.get(trackId);
      if (dsp && this.ctx) {
          dsp.panner.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.02);
      }
  }

  public setDelayCompensation(enabled: boolean) {
      this.isDelayCompEnabled = enabled;
  }

  public setLatencyMode(mode: 'low' | 'balanced' | 'high') {
      // Just a placeholder for potential buffer adjustments
      console.log(`[AudioEngine] Latency mode set to ${mode}`);
  }

  public setInputDevice(deviceId: string) { /* ... */ }
  public setOutputDevice(deviceId: string) { /* ... */ }
  public playTestTone() {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.frequency.value = 440;
      gain.gain.value = 0.1;
      osc.start();
      osc.stop(this.ctx.currentTime + 0.5);
  }

  public scrub(tracks: Track[], time: number, velocity: number) {
      // Simple seek implementation for scrubbing
      if (Math.abs(velocity) > 0) {
          this.seekTo(time, tracks, false);
      }
  }

  public stopScrubbing() {
      // Nothing to do for simple seek
  }

  // --- VST STREAMING ---

  public async enableVSTAudioStreaming(trackId: string, pluginId: string) {
      const dsp = this.tracksDSP.get(trackId);
      if (!dsp) return;
      const entry = dsp.pluginChain.get(pluginId);
      if (entry && this.ctx) {
          // Temporarily bypass internal processing/routing to divert to worklet
          entry.input.disconnect();
          await novaBridge.initAudioStreaming(this.ctx, entry.input, entry.output);
      }
  }

  public disableVSTAudioStreaming() {
      novaBridge.stopAudioStreaming();
  }

  // --- EXISTING ENGINE METHODS ---

  public startPlayback(startOffset: number, tracks: Track[]) {
    if (!this.ctx) return;
    if (this.isPlaying) this.stopAll();

    this.isPlaying = true;
    this.pausedAt = startOffset;
    this.nextScheduleTime = this.ctx.currentTime + 0.05; 
    this.playbackStartTime = this.ctx.currentTime - startOffset; 

    this.schedulerTimer = window.setInterval(() => {
      this.scheduler(tracks);
    }, this.LOOKAHEAD_MS);
  }

  public stopAll() {
    this.isPlaying = false;
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }

    this.activeSources.forEach((src) => {
      try {
        src.source.stop();
        src.source.disconnect();
        src.gain.disconnect();
      } catch (e) { }
    });
    this.activeSources.clear();
    
    // Stop Notes
    this.tracksDSP.forEach(dsp => {
        if (dsp.synth) dsp.synth.releaseAll();
        if (dsp.melodicSampler) dsp.melodicSampler.stopAll();
        if (dsp.sampler) dsp.sampler.stopAll();
    });
  }

  public seekTo(time: number, tracks: Track[], wasPlaying: boolean) {
    this.stopAll();
    this.pausedAt = time;
    
    // Reset automation state at this specific time
    tracks.forEach(track => this.applyAutomation(track, time));

    if (wasPlaying) {
      this.startPlayback(time, tracks);
    }
  }

  public getCurrentTime(): number {
    if (!this.ctx) return 0;
    if (this.isPlaying) {
      return this.ctx.currentTime - this.playbackStartTime;
    }
    return this.pausedAt;
  }

  public getIsPlaying(): boolean {
      return this.isPlaying;
  }

  public getRMS(analyzer: AnalyserNode | null): number {
      if (!analyzer) return 0;
      const data = new Uint8Array(analyzer.frequencyBinCount);
      analyzer.getByteTimeDomainData(data);
      let sum = 0;
      for(let i=0; i<data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
      }
      return Math.sqrt(sum / data.length);
  }

  private scheduler(tracks: Track[]) {
    if (!this.ctx) return;

    while (this.nextScheduleTime < this.ctx.currentTime + this.SCHEDULE_AHEAD_SEC) {
      const scheduleUntil = this.nextScheduleTime + this.SCHEDULE_AHEAD_SEC;
      
      const projectTimeStart = this.nextScheduleTime - this.playbackStartTime;
      const projectTimeEnd = scheduleUntil - this.playbackStartTime;

      this.scheduleClips(tracks, projectTimeStart, projectTimeEnd, this.nextScheduleTime);
      this.scheduleAutomation(tracks, projectTimeStart, projectTimeEnd, this.nextScheduleTime);
      
      this.nextScheduleTime += this.SCHEDULE_AHEAD_SEC; 
    }
  }

  private scheduleClips(tracks: Track[], projectWindowStart: number, projectWindowEnd: number, contextScheduleTime: number) {
    tracks.forEach(track => {
      if (track.isMuted) return; 

      track.clips.forEach(clip => {
        const clipStartsInWindow = clip.start >= projectWindowStart && clip.start < projectWindowEnd;
        
        const isInitialSeek = Math.abs(projectWindowStart - this.pausedAt) < 0.05 && this.activeSources.size === 0;
        const playheadInsideClip = projectWindowStart > clip.start && projectWindowStart < (clip.start + clip.duration);

        if ((clipStartsInWindow || (isInitialSeek && playheadInsideClip))) {
           this.playClipSource(track.id, clip, contextScheduleTime, projectWindowStart);
        }
      });
    });
  }

  private scheduleAutomation(tracks: Track[], start: number, end: number, when: number) {
    tracks.forEach(track => {
      track.automationLanes.forEach(lane => {
        if (lane.points.length < 2) return;
        
        const relevantPoints = lane.points.filter(p => p.time >= start && p.time < end);
        
        relevantPoints.forEach(p => {
           const timeOffset = p.time - start;
           const scheduleAt = when + timeOffset;
           const dsp = this.tracksDSP.get(track.id);
           
           if (dsp) {
             if (lane.parameterName === 'volume') {
               dsp.gain.gain.linearRampToValueAtTime(p.value, scheduleAt);
             } else if (lane.parameterName === 'pan') {
               dsp.panner.pan.linearRampToValueAtTime(p.value, scheduleAt);
             }
           }
        });
      });
    });
  }

  private playClipSource(trackId: string, clip: Clip, when: number, projectTime: number) {
    if (!this.ctx || !clip.buffer) return;
    if (this.activeSources.has(clip.id)) return;

    const trackDSP = this.tracksDSP.get(trackId);
    if (!trackDSP) return;

    const source = this.ctx.createBufferSource();
    source.buffer = clip.buffer;
    
    const clipGain = this.ctx.createGain();
    clipGain.gain.value = clip.gain || 1.0;

    source.connect(clipGain);
    clipGain.connect(trackDSP.input);

    let offset = 0;
    let duration = clip.duration;
    let startTime = clip.start;

    if (projectTime > clip.start) {
        const timePassed = projectTime - clip.start;
        offset = clip.offset + timePassed;
        duration = clip.duration - timePassed;
        startTime = projectTime; 
    } else {
        offset = clip.offset;
    }

    const exactStartCtxTime = when + (startTime - projectTime);

    if (duration > 0) {
        const safeStart = Math.max(this.ctx.currentTime, exactStartCtxTime);
        
        source.start(safeStart, offset, duration);
        
        const fadeInEnd = safeStart + clip.fadeIn;
        const fadeOutStart = safeStart + duration - clip.fadeOut;

        clipGain.gain.setValueAtTime(0, safeStart);
        clipGain.gain.linearRampToValueAtTime(clip.gain || 1.0, fadeInEnd);
        clipGain.gain.setValueAtTime(clip.gain || 1.0, fadeOutStart);
        clipGain.gain.linearRampToValueAtTime(0, safeStart + duration);

        this.activeSources.set(clip.id, { source, gain: clipGain, clipId: clip.id });

        source.onended = () => {
            this.activeSources.delete(clip.id);
            try { clipGain.disconnect(); } catch(e){}
        };
    }
  }

  public updateTrack(track: Track, allTracks: Track[]) {
    if (!this.ctx) return;

    let dsp = this.tracksDSP.get(track.id);
    if (!dsp) {
      dsp = {
        input: this.ctx.createGain(),
        output: this.ctx.createGain(),
        gain: this.ctx.createGain(),
        panner: this.ctx.createStereoPanner(),
        analyzer: this.ctx.createAnalyser(),
        pluginChain: new Map(),
        sends: new Map()
      };
      
      // Initialize Instruments
      if (track.type === TrackType.MIDI) {
          dsp.synth = new Synthesizer(this.ctx);
          dsp.synth.output.connect(dsp.input);
      } else if (track.type === TrackType.DRUM_RACK) {
          dsp.drumRack = new DrumRackNode(this.ctx);
          dsp.drumRack.output.connect(dsp.input);
      } else if (track.type === TrackType.DRUM_SAMPLER) {
          dsp.drumSampler = new DrumSamplerNode(this.ctx);
          dsp.drumSampler.output.connect(dsp.input);
      } else if (track.type === TrackType.MELODIC_SAMPLER) {
          dsp.melodicSampler = new MelodicSamplerNode(this.ctx);
          dsp.melodicSampler.output.connect(dsp.input);
      } else if (track.type === TrackType.SAMPLER) {
          dsp.sampler = new AudioSampler(this.ctx);
          dsp.sampler.output.connect(dsp.input);
      }

      this.tracksDSP.set(track.id, dsp);
    }
    
    // Update Drum Pads if needed
    if (track.type === TrackType.DRUM_RACK && dsp.drumRack && track.drumPads) {
        dsp.drumRack.updatePadsState(track.drumPads);
    }

    // Reconstruct Plugin Chain
    dsp.input.disconnect();
    
    let head: AudioNode = dsp.input;
    const currentPluginIds = new Set<string>();
    
    track.plugins.forEach(plugin => {
      // In Rec Mode, bypass high latency plugins on rec track
      if (this.isRecMode && plugin.latency > 0 && track.isTrackArmed) return;
      
      if (!plugin.isEnabled) return;
      currentPluginIds.add(plugin.id);

      let pEntry = dsp!.pluginChain.get(plugin.id);
      
      if (!pEntry) {
        const instance = this.createPluginNode(plugin);
        if (instance) {
          pEntry = { input: instance.input, output: instance.output, instance: instance.node };
          dsp!.pluginChain.set(plugin.id, pEntry);
        }
      } else {
        if (pEntry.instance.updateParams) {
          pEntry.instance.updateParams(plugin.params);
        }
      }

      if (pEntry) {
        head.connect(pEntry.input);
        head = pEntry.output;
      }
    });

    dsp.pluginChain.forEach((val, id) => {
        if (!currentPluginIds.has(id)) {
            val.input.disconnect();
            val.output.disconnect();
            dsp!.pluginChain.delete(id);
        }
    });

    head.disconnect();
    head.connect(dsp.gain);
    dsp.gain.connect(dsp.panner);
    dsp.panner.connect(dsp.analyzer);
    dsp.analyzer.connect(dsp.output);

    // Apply basic values
    const now = this.ctx.currentTime;
    const volume = track.isMuted ? 0 : track.volume;
    
    dsp.gain.gain.setTargetAtTime(volume, now, 0.015);
    dsp.panner.pan.setTargetAtTime(track.pan, now, 0.015);

    // Routing
    dsp.output.disconnect();
    
    if (track.outputTrackId === 'master' || !track.outputTrackId) {
       dsp.output.connect(this.masterOutput!);
    } else {
       const busDSP = this.tracksDSP.get(track.outputTrackId);
       if (busDSP) dsp.output.connect(busDSP.input);
       else dsp.output.connect(this.masterOutput!); 
    }

    // Sends
    track.sends.forEach(send => {
       if (!send.isEnabled || send.level <= 0) {
           const existing = dsp!.sends.get(send.id);
           if (existing) { existing.disconnect(); dsp!.sends.delete(send.id); }
           return;
       }

       let sendNode = dsp!.sends.get(send.id);
       if (!sendNode) {
           sendNode = this.ctx!.createGain();
           dsp!.sends.set(send.id, sendNode);
           dsp!.output.connect(sendNode);
       }

       const destDSP = this.tracksDSP.get(send.id);
       if (destDSP) {
           sendNode.disconnect();
           sendNode.connect(destDSP.input);
           sendNode.gain.setTargetAtTime(send.level, now, 0.02);
       }
    });
  }

  private applyAutomation(track: Track, time: number) {
      if (!this.ctx) return;
      const dsp = this.tracksDSP.get(track.id);
      if (!dsp) return;

      track.automationLanes.forEach(lane => {
          const before = lane.points.filter(p => p.time <= time).pop();
          const after = lane.points.find(p => p.time > time);
          
          let val = 0;
          if (!before && !after) return;
          else if (!before) val = after!.value;
          else if (!after) val = before.value;
          else {
              const ratio = (time - before.time) / (after.time - before.time);
              val = before.value + (after.value - before.value) * ratio;
          }

          if (lane.parameterName === 'volume') dsp.gain.gain.setValueAtTime(val, this.ctx.currentTime);
          if (lane.parameterName === 'pan') dsp.panner.pan.setValueAtTime(val, this.ctx.currentTime);
      });
  }

  private createPluginNode(plugin: PluginInstance) {
    if (!this.ctx) return null;
    let node: any = null;
    try {
      switch(plugin.type) {
        case 'REVERB': node = new ReverbNode(this.ctx); break;
        case 'DELAY': node = new SyncDelayNode(this.ctx, 120); break;
        case 'COMPRESSOR': node = new CompressorNode(this.ctx); break;
        case 'PROEQ12': node = new ProEQ12Node(this.ctx, plugin.params as any); break;
        case 'AUTOTUNE': node = new AutoTuneNode(this.ctx); break;
        case 'CHORUS': node = new ChorusNode(this.ctx); break;
        case 'FLANGER': node = new FlangerNode(this.ctx); break;
        case 'DOUBLER': node = new VocalDoublerNode(this.ctx); break;
        case 'STEREOSPREADER': node = new StereoSpreaderNode(this.ctx); break;
        case 'DEESSER': node = new DeEsserNode(this.ctx); break;
        case 'DENOISER': node = new DenoiserNode(this.ctx); break;
        case 'VOCALSATURATOR': node = new VocalSaturatorNode(this.ctx); break;
        case 'MASTERSYNC': node = new MasterSyncNode(this.ctx); break;
        case 'VST3': 
            // Return bypass chain for now as VST handled by streaming
            const input = this.ctx.createGain();
            const output = this.ctx.createGain();
            input.connect(output);
            return { input, output, node: {} };
      }
      if (node) {
          node.updateParams(plugin.params);
          return { input: node.input, output: node.output, node };
      }
    } catch(e) {
      console.error(`Failed to create plugin ${plugin.type}`, e);
    }
    return null;
  }

  public async startRecording(currentTime: number) {
    if (!this.ctx) return false;
    try {
      this.recStream = await navigator.mediaDevices.getUserMedia({ 
          audio: { 
              echoCancellation: false, 
              noiseSuppression: false, 
              autoGainControl: false,
              latency: 0 
          } as any
      });
      this.mediaRecorder = new MediaRecorder(this.recStream);
      this.audioChunks = [];
      this.recStartTime = currentTime;
      
      this.mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) this.audioChunks.push(e.data);
      };
      this.mediaRecorder.start();
      return true;
    } catch(e) { 
      console.error("Mic Access Error:", e); 
      return false; 
    }
  }

  public async stopRecording(): Promise<Clip | null> {
    return new Promise((resolve) => {
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return resolve(null);
        
        this.mediaRecorder.onstop = async () => {
            const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
            if (blob.size === 0) { resolve(null); return; }
            
            try {
                const buffer = await blob.arrayBuffer();
                const audioBuffer = await this.ctx!.decodeAudioData(buffer);
                
                const clip: Clip = {
                    id: `rec-${Date.now()}`,
                    name: 'Vocal Take',
                    start: this.recStartTime,
                    duration: audioBuffer.duration,
                    offset: 0,
                    fadeIn: 0.05,
                    fadeOut: 0.05,
                    type: TrackType.AUDIO,
                    color: '#ff0000',
                    buffer: audioBuffer
                };
                
                if (this.recStream) this.recStream.getTracks().forEach(t => t.stop());
                this.recStream = null;
                resolve(clip);
            } catch(e) {
                console.error("Recording decode error", e);
                resolve(null);
            }
        };
        this.mediaRecorder.stop();
    });
  }
  
  // Offline Rendering
  public async renderProject(tracks: Track[], totalDuration: number, startOffset: number, sampleRate: number, onProgress?: (p: number) => void): Promise<AudioBuffer> {
      // Stub for offline rendering - logic is similar to scheduler but using OfflineAudioContext
      // For now returning empty buffer
      const offlineCtx = new OfflineAudioContext(2, totalDuration * sampleRate, sampleRate);
      return offlineCtx.startRendering();
  }

  public getMasterAnalyzer() { return this.masterAnalyzer; }
  public getTrackAnalyzer(trackId: string) { return this.tracksDSP.get(trackId)?.analyzer || null; }
  public getPluginNodeInstance(trackId: string, pluginId: string) { 
      return this.tracksDSP.get(trackId)?.pluginChain.get(pluginId)?.instance || null; 
  }
  public setRecMode(active: boolean) { this.isRecMode = active; }
  
  public getTrackPluginParameters(trackId: string): { pluginId: string, pluginName: string, params: any[] }[] {
      // Mock or implement introspection
      return [];
  }
}

export const audioEngine = new AudioEngine();
