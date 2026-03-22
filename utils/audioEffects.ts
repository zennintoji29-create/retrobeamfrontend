export class RetroAudioFilter {
  context: AudioContext;
  source: MediaStreamAudioSourceNode | null = null;
  destination: MediaStreamAudioDestinationNode;
  
  lowpass: BiquadFilterNode;
  highpass: BiquadFilterNode;
  distortion: WaveShaperNode;

  constructor() {
    this.context = new window.AudioContext();
    this.destination = this.context.createMediaStreamDestination();

    // Create filters for "Walkie-Talkie" / "Radio" effect
    this.lowpass = this.context.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 3000;

    this.highpass = this.context.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 400;

    this.distortion = this.context.createWaveShaper();
    this.distortion.curve = this.makeDistortionCurve(50); // add mild crunch
    this.distortion.oversample = '4x';

    // Chain them: source -> highpass -> lowpass -> distortion -> destination
    this.highpass.connect(this.lowpass);
    this.lowpass.connect(this.distortion);
    this.distortion.connect(this.destination);
  }

  applyToStream(stream: MediaStream): MediaStream {
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return stream;

    // Disconnect previous if any
    if (this.source) {
      this.source.disconnect();
    }

    // Isolate the audio track to pipe into the context
    const audioStream = new MediaStream([audioTracks[0]]);
    this.source = this.context.createMediaStreamSource(audioStream);
    this.source.connect(this.highpass);

    // Get the filtered track and combine it with the video tracks
    const filteredAudioTrack = this.destination.stream.getAudioTracks()[0];
    const newStream = new MediaStream([filteredAudioTrack, ...stream.getVideoTracks()]);
    return newStream;
  }

  // Create a shaping curve for the distortion node
  private makeDistortionCurve(amount: number) {
    const k = amount;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  destroy() {
    if (this.source) this.source.disconnect();
    this.highpass.disconnect();
    this.lowpass.disconnect();
    this.distortion.disconnect();
    if (this.context.state !== 'closed') {
      this.context.close();
    }
  }
}
