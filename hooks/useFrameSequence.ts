import { useEffect, useRef, useState, useCallback } from 'react';

export const TOTAL_FRAMES = 192;
const FRAME_DELAY_MS = 41;
const PRELOAD_BATCH = 8; // Load this many ahead at a time

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

  // Sequential batch preloading instead of 192 simultaneous fetches
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

    // Chain: once this batch is done, load the next
    const nextStart = (startIndex + PRELOAD_BATCH) % TOTAL_FRAMES;
    if (imageCache.current.size < TOTAL_FRAMES) {
      preloadBatch(nextStart);
    }
  }, [preloadFrame]);

  useEffect(() => {
    // Use rAF + timestamp instead of setInterval + setState
    const tick = (timestamp: number) => {
      if (timestamp - lastTickRef.current >= FRAME_DELAY_MS) {
        const next = (frameRef.current + 1) % TOTAL_FRAMES;
        // Only advance if the next frame is actually loaded
        if (imageCache.current.has(next)) {
          frameRef.current = next;
          setCurrentFrame(next);
        }
        lastTickRef.current = timestamp;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    // Start preloading first batch, then chain
    preloadBatch(0);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      imageCache.current.clear();
    };
  }, [preloadBatch]);

  return { currentFrame, getFrameSrc, imageCache };
}
