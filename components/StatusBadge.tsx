export default function StatusBadge({ isLive }: { isLive: boolean }) {
  if (isLive) {
    return (
      <div className="flex items-center gap-3 bg-synth-red/10 border border-synth-red/50 px-4 py-1.5 rounded-full shadow-[0_0_15px_rgba(229,9,20,0.3)] backdrop-blur-md">
        <div className="w-2.5 h-2.5 rounded-full bg-synth-red animate-pulse shadow-[0_0_8px_#ff3c3c]"></div>
        <span className="font-heading text-xl text-synth-red glow-text-red uppercase tracking-[0.2em] pt-0.5">LIVE</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-white/5 border border-white/20 px-4 py-1.5 rounded-full opacity-70 backdrop-blur-md shadow-inner">
      <div className="w-2.5 h-2.5 rounded-full bg-synth-dim"></div>
      <span className="font-heading text-xl text-synth-dim uppercase tracking-[0.2em] pt-0.5">OFFLINE</span>
    </div>
  );
}
