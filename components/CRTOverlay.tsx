export default function CinematicOverlay() {
  return (
    <>
      {/* Soft Vignette */}
      <div className="pointer-events-none fixed inset-0 z-[9998] shadow-[inset_0_0_150px_rgba(0,0,0,0.8)] mix-blend-multiply" />
      
      {/* Light Film Grain */}
      <div className="pointer-events-none fixed inset-0 z-[9999] opacity-[0.04] mix-blend-overlay">
        <svg width="100%" height="100%">
          <filter id="noise">
            <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
            <feColorMatrix type="matrix" values="1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 1 0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#noise)" />
        </svg>
      </div>
      
      {/* Subtle Scanlines */}
      <div className="pointer-events-none fixed inset-0 z-[9997] crt-scanlines opacity-30 mix-blend-overlay" />
    </>
  );
}
