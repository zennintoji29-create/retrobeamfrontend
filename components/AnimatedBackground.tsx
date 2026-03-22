'use client';

import { useEffect, useRef } from 'react';

const TOTAL_FRAMES = 192;

function frameSrc(i: number) {
  return `/sequence/frame_${String(i).padStart(3, '0')}_delay-0.041s.webp`;
}

export default function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let frameIndex = 0;
    let animationId: number;
    let lastTime = 0;
    const FRAME_DELAY = 41;

    const images: (HTMLImageElement | null)[] = new Array(TOTAL_FRAMES).fill(null);

    // ── Resize: match actual device viewport exactly ──────────────────────────
    function resize() {
      const vw = window.visualViewport?.width ?? window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      canvas!.width = vw;
      canvas!.height = vh;
    }
    resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);

    // ── Draw loop: runs as soon as at least the first frame is ready ──────────
    function drawFrame() {
      if (!ctx || !canvas) return;

      // Walk forward until we find a loaded frame
      let found = false;
      for (let attempt = 0; attempt < TOTAL_FRAMES; attempt++) {
        const idx = (frameIndex + attempt) % TOTAL_FRAMES;
        const img = images[idx];
        if (img && img.complete && img.naturalWidth > 0) {
          if (attempt > 0) frameIndex = idx; // skip unloaded frames

          const scale = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          const x = (canvas.width - w) / 2;
          const y = (canvas.height - h) / 2;
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, x, y, w, h);
          found = true;
          break;
        }
      }

      if (!found) {
        // No frames ready yet — fill black and wait
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

    function loop(timestamp: number) {
      const elapsed = timestamp - lastTime;
      if (elapsed >= FRAME_DELAY) {
        lastTime = timestamp;
        drawFrame();
        frameIndex = (frameIndex + 1) % TOTAL_FRAMES;
      }
      animationId = requestAnimationFrame(loop);
    }

    // Start the loop immediately — don't wait for all frames
    animationId = requestAnimationFrame(loop);

    // Load frames in order  
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      const img = new Image();
      img.decoding = 'async';
      img.src = frameSrc(i);
      images[i] = img;
    }

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        // Use 100dvh on mobile so it respects address-bar shrinkage
        minHeight: '100dvh',
        pointerEvents: 'none',
        zIndex: 0,
        opacity: 0.85,
        mixBlendMode: 'screen',
        display: 'block',
      }}
    />
  );
}
