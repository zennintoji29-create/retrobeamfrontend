import { useEffect, useRef, useState, useCallback } from 'react';

export const TOTAL_FRAMES = 192;
const FRAME_DELAY_MS = 41; // ~24fps
const PRELOAD_BATCH = 16;  // Larger initial burst for faster initial load

export function getFrameSrc(index: number): string {
  const n = String(index).padStart(3, '0');
  return `/sequence/frame_${n}_delay-0.041s.webp`;
}

export function useFrameSequence() {
  const [currentFrame, setCurrentFrame] = useState(0);
  // Keep Image refs alive in a Map so GC can't evict them
  const imageCache = useRef<Map<number, HTMLImageElement>>(new Map());
  const frameRef = useRef(0);
  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  // Warm-up: whether the first batch is fully loaded
  const warmRef = useRef(false);

  const preloadFrame = useCallback((index: number): Promise<void> => {
    return new Promise((resolve) => {
      if (imageCache.current.has(index)) { resolve(); return; }
      const img = new Image();
      img.onload = () => { imageCache.current.set(index, img); resolve(); };
      img.onerror = () => resolve(); // Don't block on error
      img.src = getFrameSrc(index);
    });
  }, []);

  const preloadBatch = useCallback(async (startIndex: number) => {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < PRELOAD_BATCH; i++) {
      const idx = (startIndex + i) % TOTAL_FRAMES;
      promises.push(preloadFrame(idx));
    }
    await Promise.all(promises);

    // Mark warm once first batch is ready
    if (!warmRef.current) warmRef.current = true;

    // Chain: once this batch is done, load the next
    const nextStart = (startIndex + PRELOAD_BATCH) % TOTAL_FRAMES;
    if (imageCache.current.size < TOTAL_FRAMES) {
      preloadBatch(nextStart);
    }
  }, [preloadFrame]);

  useEffect(() => {
    const tick = (timestamp: number) => {
      // Don't start animating until first batch is warm
      if (warmRef.current && timestamp - lastTickRef.current >= FRAME_DELAY_MS) {
        const next = (frameRef.current + 1) % TOTAL_FRAMES;
        // Only advance if the next frame is actually loaded
        if (imageCache.current.has(next)) {
          frameRef.current = next;
          setCurrentFrame(next);
          lastTickRef.current = timestamp; // Only update clock when we ACTUALLY advance
        }
        // If frame not ready yet, DON'T update lastTickRef — retry next rAF tick
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    // Start preloading — animation begins once first batch (16 frames) is ready
    preloadBatch(0);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      imageCache.current.clear();
      warmRef.current = false;
    };
  }, [preloadBatch]);

  return { currentFrame, getFrameSrc, imageCache };
}
