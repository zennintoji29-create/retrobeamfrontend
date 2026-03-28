export default function CinematicOverlay() {
  return (
    <>
      {/* Soft Vignette */}
      <div className="pointer-events-none fixed inset-0 z-[9998] shadow-[inset_0_0_150px_rgba(0,0,0,0.8)] mix-blend-multiply" />
      
      {/* Light Film Grain (Optimized as CSS Background) */}
      <div 
        className="pointer-events-none fixed inset-0 z-[9999] opacity-[0.04] mix-blend-overlay"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='200' height='200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 1 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}
      />
      
      {/* Subtle Scanlines */}
      <div className="pointer-events-none fixed inset-0 z-[9997] crt-scanlines opacity-30 mix-blend-overlay" />
    </>
  );
}
