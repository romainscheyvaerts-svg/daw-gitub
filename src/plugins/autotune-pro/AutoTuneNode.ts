
import { AutoTuneParams, SCALES } from './AutoTuneUI';

// Note: On inline le code du worklet ici pour garantir le chargement sans erreur 404 sur certains bundlers.
// Dans une prod idéale, on chargerait le fichier JS séparé.
const WORKLET_CODE = `
class AutoTuneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.bufferMask = this.bufferSize - 1;
    this.buffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.analysisBuffer = new Float32Array(1024);
    this.analysisIndex = 0;
    this.lastDetectedFreq = 0;
    this.framesSinceLastAnalysis = 0;
    this.phase = 0;
    this.grainSize = 2048;
    this.currentRatio = 1.0;
    this.scales = {
      'CHROMATIC': [0,1,2,3,4,5,6,7,8,9,10,11],
      'MAJOR': [0,2,4,5,7,9,11],
      'MINOR': [0,2,3,5,7,8,10],
      'MINOR_HARMONIC': [0,2,3,5,7,8,11],
      'PENTATONIC': [0,3,5,7,10],
      'TRAP_DARK': [0,1,4,5,7,8,11]
    };
  }
  static get parameterDescriptors() {
    return [
      { name: 'retuneSpeed', defaultValue: 0.1, minValue: 0.0, maxValue: 1.0 },
      { name: 'amount', defaultValue: 1.0, minValue: 0.0, maxValue: 1.0 },
      { name: 'rootKey', defaultValue: 0, minValue: 0, maxValue: 11 },
      { name: 'scaleType', defaultValue: 0, minValue: 0, maxValue: 5 },
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1 }
    ];
  }
  detectPitch(buffer) {
    const SIZE = buffer.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.015) return 0; 
    const minPeriod = 40; 
    const maxPeriod = 600;
    let bestCorrelation = 0;
    let bestOffset = -1;
    for (let offset = minPeriod; offset < maxPeriod; offset++) {
      let correlation = 0;
      for (let i = 0; i < SIZE - offset; i += 2) { 
        correlation += buffer[i] * buffer[i + offset];
      }
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }
    if (bestCorrelation > 0.5 && bestOffset > 0) {
      return sampleRate / bestOffset;
    }
    return 0;
  }
  getNearestFreq(inputFreq, rootKey, scaleIdx) {
    if (inputFreq <= 0) return inputFreq;
    const midi = 69 + 12 * Math.log2(inputFreq / 440);
    const note = Math.round(midi);
    const scaleNames = ['CHROMATIC', 'MAJOR', 'MINOR', 'MINOR_HARMONIC', 'PENTATONIC', 'TRAP_DARK'];
    const currentScale = this.scales[scaleNames[scaleIdx]] || this.scales['CHROMATIC'];
    const noteInOctave = note % 12;
    const relativeNote = (noteInOctave - rootKey + 12) % 12;
    let minDiff = Infinity;
    let targetRelative = relativeNote;
    for (let i = 0; i < currentScale.length; i++) {
      const scaleNote = currentScale[i];
      let diff = Math.abs(relativeNote - scaleNote);
      if (diff > 6) diff = 12 - diff;
      if (diff < minDiff) {
        minDiff = diff;
        targetRelative = scaleNote;
      }
    }
    let octaveShift = 0;
    const dist = targetRelative - relativeNote;
    if (dist > 6) octaveShift = -1;
    if (dist < -6) octaveShift = 1;
    const targetMidi = (Math.floor(midi / 12) + octaveShift) * 12 + targetRelative + rootKey;
    return 440 * Math.pow(2, (targetMidi - 69) / 12);
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const bypass = parameters.bypass[0];
    if (bypass > 0.5 || !input || !input[0]) {
      if (input && input[0] && output[0]) output[0].set(input[0]);
      if (input && input[1] && output[1]) output[1].set(input[1]);
      return true;
    }
    const channelData = input[0];
    const outL = output[0];
    const outR = output[1] || outL;
    const blockSize = channelData.length;
    const retuneSpeed = parameters.retuneSpeed[0];
    const amount = parameters.amount[0];
    const rootKey = Math.round(parameters.rootKey[0]);
    const scaleType = Math.round(parameters.scaleType[0]);
    if (this.analysisIndex + blockSize < this.analysisBuffer.length) {
      this.analysisBuffer.set(channelData, this.analysisIndex);
      this.analysisIndex += blockSize;
    } else {
      const detected = this.detectPitch(this.analysisBuffer);
      if (detected > 0) {
        this.lastDetectedFreq = detected;
      }
      this.analysisIndex = 0;
    }
    const targetFreq = this.getNearestFreq(this.lastDetectedFreq, rootKey, scaleType);
    let targetRatio = 1.0;
    if (this.lastDetectedFreq > 50 && targetFreq > 50) {
      targetRatio = targetFreq / this.lastDetectedFreq;
    }
    targetRatio = Math.max(0.5, Math.min(2.0, targetRatio));
    const smoothing = 0.1 + (retuneSpeed * 0.89); 
    this.currentRatio = (this.currentRatio * smoothing) + (targetRatio * (1 - smoothing));
    for (let i = 0; i < blockSize; i++) {
      this.buffer[this.writeIndex] = channelData[i];
      this.phase += (1.0 - this.currentRatio) / this.grainSize;
      if (this.phase > 1) this.phase -= 1;
      if (this.phase < 0) this.phase += 1;
      const offsetA = this.phase * this.grainSize;
      const offsetB = ((this.phase + 0.5) % 1) * this.grainSize;
      let readPosA = this.writeIndex - offsetA;
      let readPosB = this.writeIndex - offsetB;
      if (readPosA < 0) readPosA += this.bufferSize;
      if (readPosB < 0) readPosB += this.bufferSize;
      const idxA = Math.floor(readPosA);
      const fracA = readPosA - idxA;
      const valA = this.buffer[idxA & this.bufferMask] * (1-fracA) + this.buffer[(idxA+1) & this.bufferMask] * fracA;
      const idxB = Math.floor(readPosB);
      const fracB = readPosB - idxB;
      const valB = this.buffer[idxB & this.bufferMask] * (1-fracB) + this.buffer[(idxB+1) & this.bufferMask] * fracB;
      const winA = 1 - 2 * Math.abs(this.phase - 0.5);
      const winB = 1 - 2 * Math.abs(((this.phase + 0.5) % 1) - 0.5);
      const wet = (valA * winA) + (valB * winB);
      const signal = (wet * amount) + (channelData[i] * (1 - amount));
      outL[i] = signal;
      if(outR) outR[i] = signal;
      this.writeIndex = (this.writeIndex + 1) & this.bufferMask;
    }
    if (this.framesSinceLastAnalysis++ > 8) {
      this.port.postMessage({ pitch: this.lastDetectedFreq, target: targetFreq, cents: 1200 * Math.log2(this.currentRatio) });
      this.framesSinceLastAnalysis = 0;
    }
    return true;
  }
}
registerProcessor('auto-tune-pro-processor', AutoTuneProcessor);
`;

export class AutoTuneNode {
  private ctx: AudioContext;
  public input: GainNode;
  public output: GainNode;
  private worklet: AudioWorkletNode | null = null;
  private onStatusCallback: ((data: any) => void) | null = null;
  private isWorkletReady: boolean = false;

  private params: AutoTuneParams = {
    speed: 0.1,
    humanize: 0.2,
    mix: 1.0,
    rootKey: 0,
    scale: 'CHROMATIC',
    isEnabled: true
  };

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.init();
  }

  private async init() {
    try {
        const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        
        // Add module
        await this.ctx.audioWorklet.addModule(url);

        this.worklet = new AudioWorkletNode(this.ctx, 'auto-tune-pro-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            parameterData: {
                retuneSpeed: this.params.speed,
                amount: this.params.mix,
                rootKey: this.params.rootKey,
                scaleType: SCALES.indexOf(this.params.scale)
            }
        });

        this.worklet.port.onmessage = (e) => {
            if (this.onStatusCallback) this.onStatusCallback(e.data);
        };

        this.input.disconnect();
        this.input.connect(this.worklet);
        this.worklet.connect(this.output);
        this.isWorkletReady = true;
        
        // Apply initial params
        this.applyParams();

    } catch (e) {
        console.error("AutoTune Init Failed:", e);
        // Fallback Bypass en cas d'échec
        this.input.connect(this.output);
    }
  }

  public updateParams(p: Partial<AutoTuneParams>) {
      this.params = { ...this.params, ...p };
      this.applyParams();
  }

  private applyParams() {
      if (!this.worklet || !this.isWorkletReady) return;
      
      const { speed, mix, rootKey, scale, isEnabled } = this.params;
      const p = this.worklet.parameters;
      const now = this.ctx.currentTime;

      p.get('bypass')?.setValueAtTime(isEnabled ? 0 : 1, now);
      p.get('retuneSpeed')?.setTargetAtTime(speed, now, 0.05);
      p.get('amount')?.setTargetAtTime(mix, now, 0.05);
      p.get('rootKey')?.setValueAtTime(rootKey, now);
      
      const scaleIdx = SCALES.indexOf(scale);
      p.get('scaleType')?.setValueAtTime(scaleIdx >= 0 ? scaleIdx : 0, now);
  }

  public setStatusCallback(cb: (data: any) => void) {
      this.onStatusCallback = cb;
  }
}
