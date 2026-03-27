/**
 * Clean Speech Audio Pipeline
 * Replaces the retro walkie-talkie filter with a proper voice enhancement chain.
 * Chain: source → highpass (cut rumble) → compressor (even out volume) → gain → destination
 */
export class RetroAudioFilter {
  context: AudioContext;
  source: MediaStreamAudioSourceNode | null = null;
  destination: MediaStreamAudioDestinationNode;

  private highpass: BiquadFilterNode;
  private compressor: DynamicsCompressorNode;
  private gain: GainNode;

  constructor() {
    this.context = new window.AudioContext();
    this.destination = this.context.createMediaStreamDestination();

    // 1. Highpass — cuts low-frequency rumble (AC hum, desk bumps) below 80Hz
    this.highpass = this.context.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 80;
    this.highpass.Q.value = 0.7;

    // 2. Dynamics compressor — evens out loud/quiet speech, kills clipping peaks
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -24;  // start compressing at -24dB
    this.compressor.knee.value = 10;         // soft knee for natural sound
    this.compressor.ratio.value = 4;         // 4:1 ratio — gentle, not squashed
    this.compressor.attack.value = 0.003;    // 3ms attack — fast enough to catch plosives
    this.compressor.release.value = 0.25;    // 250ms release — natural decay

    // 3. Gain — slight boost after compression to restore perceived loudness
    this.gain = this.context.createGain();
    this.gain.gain.value = 1.2;

    // Chain: highpass → compressor → gain → destination
    this.highpass.connect(this.compressor);
    this.compressor.connect(this.gain);
    this.gain.connect(this.destination);
  }

  applyToStream(stream: MediaStream): MediaStream {
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return stream;

    // Resume context if suspended (browser autoplay policy)
    if (this.context.state === 'suspended') {
      this.context.resume();
    }

    if (this.source) {
      this.source.disconnect();
    }

    const audioStream = new MediaStream([audioTracks[0]]);
    this.source = this.context.createMediaStreamSource(audioStream);
    this.source.connect(this.highpass);

    const filteredAudioTrack = this.destination.stream.getAudioTracks()[0];
    return new MediaStream([filteredAudioTrack, ...stream.getVideoTracks()]);
  }

  destroy() {
    if (this.source) this.source.disconnect();
    this.highpass.disconnect();
    this.compressor.disconnect();
    this.gain.disconnect();
    if (this.context.state !== 'closed') {
      this.context.close();
    }
  }
}