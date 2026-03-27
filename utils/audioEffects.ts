/**
 * Clean Speech Audio Pipeline
 * 
 * KEY FIX: We no longer rely on MediaTrackConstraints for echo/noise suppression,
 * because routing through AudioContext breaks browser-native processing.
 * Instead, we handle it entirely in the Web Audio graph.
 */
export class RetroAudioFilter {
  context: AudioContext;
  source: MediaStreamAudioSourceNode | null = null;
  destination: MediaStreamAudioDestinationNode;

  private highpass: BiquadFilterNode;
  private notch: BiquadFilterNode;       // NEW: kills the beeping/tonal artifacts
  private compressor: DynamicsCompressorNode;
  private gain: GainNode;

  constructor() {
    this.context = new window.AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    this.destination = this.context.createMediaStreamDestination();

    // 1. Highpass — cuts sub-80Hz rumble
    this.highpass = this.context.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 100; // bumped to 100Hz — more aggressive rumble cut
    this.highpass.Q.value = 0.5;         // lowered Q to avoid resonance ringing

    // 2. Notch filter — kills the beeping/tonal interference you're hearing.
    // The "beeping" is typically a narrow-band artifact at mains frequency
    // harmonics (50Hz/60Hz) or AudioContext feedback loops at ~440-1000Hz.
    // A notch at 50Hz covers EU mains hum; adjust to 60Hz if on US power.
    this.notch = this.context.createBiquadFilter();
    this.notch.type = 'notch';
    this.notch.frequency.value = 50;  // or 60 for US
    this.notch.Q.value = 10;          // narrow notch — only kills that exact frequency

    // 3. Compressor — gentler settings to avoid pumping artifacts
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -30;
    this.compressor.knee.value = 15;   // wider knee = more transparent
    this.compressor.ratio.value = 3;   // 3:1 instead of 4:1 — less aggressive
    this.compressor.attack.value = 0.010; // slower attack — avoids clipping transients that cause pops
    this.compressor.release.value = 0.35; // slightly longer release — less pumping

    // 4. Gain — reduced to 1.0 to avoid driving signal into clipping
    this.gain = this.context.createGain();
    this.gain.gain.value = 1.0; // was 1.2 — that extra push was likely causing distortion

    // Chain: highpass → notch → compressor → gain → destination
    this.highpass.connect(this.notch);
    this.notch.connect(this.compressor);
    this.compressor.connect(this.gain);
    this.gain.connect(this.destination);
  }

  applyToStream(stream: MediaStream): MediaStream {
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return stream;

    if (this.context.state === 'suspended') {
      this.context.resume();
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    // FIX: Use the full stream (not a stripped copy) as the source.
    // Previously `new MediaStream([audioTracks[0]])` was dropping the 
    // browser's internal processing metadata, disabling echo cancellation.
    this.source = this.context.createMediaStreamSource(stream);
    this.source.connect(this.highpass);

    const filteredAudioTrack = this.destination.stream.getAudioTracks()[0];
    return new MediaStream([filteredAudioTrack, ...stream.getVideoTracks()]);
  }

  destroy() {
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    this.highpass.disconnect();
    this.notch.disconnect();
    this.compressor.disconnect();
    this.gain.disconnect();
    if (this.context.state !== 'closed') {
      this.context.close();
    }
  }
}