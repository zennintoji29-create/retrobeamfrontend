export default function StatusBadge({ isLive }: { isLive: boolean }) {
  if (isLive) {
    return (
      <div className="flex items-center gap-2 bg-brand-danger/10 border border-brand-danger/40 px-3 py-1 rounded-full backdrop-blur-md">
        <div className="w-2 h-2 rounded-full bg-brand-danger animate-pulse" />
        <span className="font-sans text-xs font-bold text-brand-danger uppercase tracking-widest">Live</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-brand-surface-2/40 border border-brand-border/50 px-3 py-1 rounded-full">
      <div className="w-2 h-2 rounded-full bg-brand-gray/50" />
      <span className="font-sans text-xs font-semibold text-brand-gray uppercase tracking-widest">Offline</span>
    </div>
  );
}
