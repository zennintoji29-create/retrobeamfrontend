'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  stream: MediaStream | null;
  muted?: boolean;
  label?: string;
  isLive?: boolean;
  interactive?: boolean;
  /** Shows a CAM OFF overlay when stream exists but camera is disabled */
  cameraEnabled?: boolean;
}

export default function VideoMonitor({
  stream,
  muted = true,
  label = 'FEED',
  isLive = false,
  interactive = true,
  cameraEnabled = true,
}: Props) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPip,         setIsPip]         = useState(false);
  const [isFullscreen,  setIsFullscreen]  = useState(false);
  // FIX: track whether the video element has successfully started playing.
  // On mobile (especially Android WebView) autoPlay is blocked silently.
  // We show a tap-to-play overlay when paused so the user can unblock it.
  const [needsTap, setNeedsTap] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────
  // FIX (mobile video not rendering / frozen frames):
  //   srcObject must be assigned imperatively — React's declarative rendering
  //   does not handle MediaStream objects correctly (they are mutable, so React
  //   never detects a "change" and skips re-rendering the video element).
  //
  // FIX (stream track added/removed without new MediaStream object):
  //   We listen to addtrack/removetrack on the stream and force a srcObject
  //   reassignment + play() call.  Without this, the video freezes when a
  //   remote peer turns their camera back on (track re-added to existing stream).
  //
  // FIX (Android WebView autoPlay blocked):
  //   play() is wrapped in a catch.  If it rejects with NotAllowedError we set
  //   needsTap=true to show a manual-play overlay.
  // ─────────────────────────────────────────────────────────────────────────
  const attachStream = useCallback((s: MediaStream | null) => {
    const video = videoRef.current;
    if (!video) return;

    // Guard: only reassign if something actually changed to avoid a flash
    if (video.srcObject === s) return;

    video.srcObject = s;

    if (s) {
      video
        .play()
        .then(() => setNeedsTap(false))
        .catch((e: DOMException) => {
          if (e.name === 'NotAllowedError') {
            // Autoplay policy blocked playback — show tap overlay
            setNeedsTap(true);
          } else {
            console.warn('Video play() failed:', e);
          }
        });
    }
  }, []);

  useEffect(() => {
    attachStream(stream);
    if (!stream) return;

    const onTrackChange = () => {
      // Force srcObject reassignment so the video element picks up the new track
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = null;
      video.srcObject = stream;
      video.play().catch(() => {});
    };

    stream.addEventListener('addtrack',    onTrackChange);
    stream.addEventListener('removetrack', onTrackChange);

    return () => {
      stream.removeEventListener('addtrack',    onTrackChange);
      stream.removeEventListener('removetrack', onTrackChange);
    };
  }, [stream, attachStream]);

  // ── Fullscreen tracking ─────────────────────────────────────────────────
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ── Manual play (tap-to-play for autoplay-blocked environments) ─────────
  const handleManualPlay = () => {
    videoRef.current?.play().then(() => setNeedsTap(false)).catch(console.warn);
  };

  // ── PiP ─────────────────────────────────────────────────────────────────
  const togglePip = async () => {
    if (!videoRef.current) return;
    // FIX: PiP is not available in Android WebView or iOS — guard it
    if (!document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPip(false);
      } else {
        await videoRef.current.requestPictureInPicture();
        setIsPip(true);
      }
    } catch (err) {
      console.error('PIP Error:', err);
    }
  };

  // ── Fullscreen ───────────────────────────────────────────────────────────
  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch (err) {
      console.error('Fullscreen Error:', err);
    }
  };

  const pipAvailable = typeof document !== 'undefined' && !!document.pictureInPictureEnabled;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[#0f0a0a] overflow-hidden flex flex-col"
    >
      {/* ── Video element ──────────────────────────────────────────────── */}
      {stream ? (
        <>
          {/*
            FIX (echo — THE most important fix):
              The local preview MUST have `muted`.  If the caller passes
              muted={false} on the local stream, the speaker audio feeds back
              into the mic and causes the echo loop.
              The `muted` prop is passed in from the parent; for local tiles
              the parent always passes muted={true}.

            FIX (mobile video scaling):
              `object-contain` prevents cropping on portrait-mode mobile
              cameras.  `object-cover` would crop, causing layout shifts.

            FIX (iOS Safari):
              `playsInline` is required on iOS — without it Safari opens a
              full-screen player and the tile layout breaks.
          */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={muted}
            className="w-full h-full object-contain"
            // FIX: disablePictureInPicture on non-interactive tiles prevents
            // an unexpected PiP UI from appearing on long-press (mobile).
            disablePictureInPicture={!interactive}
            style={{ pointerEvents: 'none' }}
          />

          {/* Tap-to-play overlay (autoplay blocked) */}
          {needsTap && (
            <button
              onClick={handleManualPlay}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0f0a0a]/80 z-10"
            >
              <div className="w-16 h-16 border-[3px] border-[#FFDE42] flex items-center justify-center">
                <svg className="w-8 h-8 text-[#FFDE42]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <span className="text-[#FFDE42] font-heading text-sm tracking-widest uppercase font-bold">
                TAP TO PLAY
              </span>
            </button>
          )}

          {/* CAM OFF overlay */}
          {!cameraEnabled && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0f0a0a]/95 z-10">
              <div className="w-14 h-14 border-[3px] border-[#4C5C2D] flex items-center justify-center">
                <svg className="w-7 h-7 text-[#4C5C2D]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="square" strokeWidth={2}
                    d="M3 3l18 18M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V9" />
                </svg>
              </div>
              <span className="text-[#4C5C2D] font-heading text-sm tracking-widest uppercase font-bold">CAM OFF</span>
            </div>
          )}
        </>
      ) : (
        /* No stream placeholder */
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0f0a0a]">
          <div className="w-16 h-16 border-[3px] border-[#4C5C2D] flex items-center justify-center">
            <svg className="w-8 h-8 text-[#4C5C2D]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={1.5}
                d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-7.5A2.25 2.25 0 0013.5 6.75h-9A2.25 2.25 0 002.25 9v7.5A2.25 2.25 0 004.5 18.75z" />
            </svg>
          </div>
          <span className="text-[#4C5C2D] font-heading text-sm tracking-widest uppercase font-bold">NO SIGNAL</span>
        </div>
      )}

      {/* ── Bottom label bar ──────────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between items-center px-3 py-1.5 bg-[#1B0C0C]/90 border-t-[2px] border-[#4C5C2D] z-10">
        <div className="flex items-center gap-2 min-w-0">
          {isLive && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />}
          <span className="text-[#FFDE42] font-heading text-xs tracking-widest uppercase font-bold truncate">{label}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {stream && interactive && pipAvailable && (
            <button
              onClick={togglePip}
              title="Pop Out (Picture-in-Picture)"
              className="text-[#FFDE42] border-[2px] border-[#4C5C2D] px-2 py-0.5 text-[10px] font-heading font-bold uppercase hover:bg-[#FFDE42] hover:text-[#1B0C0C] transition-colors"
            >
              {isPip ? 'CLOSE' : 'POP'}
            </button>
          )}
          <button
            onClick={toggleFullscreen}
            title="Fullscreen"
            className="text-[#FFDE42] border-[2px] border-[#4C5C2D] px-2 py-0.5 text-[10px] font-heading font-bold uppercase hover:bg-[#FFDE42] hover:text-[#1B0C0C] transition-colors"
          >
            {isFullscreen ? '✕' : '⛶'}
          </button>
        </div>
      </div>
    </div>
  );
}