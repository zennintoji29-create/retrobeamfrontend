'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  stream: MediaStream | null;
  muted?: boolean;
  label?: string;
  isLive?: boolean;
  interactive?: boolean;
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPip, setIsPip] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [hasVideoTrack, setHasVideoTrack] = useState(false);

  // Guard against overlapping play() calls
  const playPromiseRef = useRef<Promise<void> | null>(null);
  // Track the stream id we last attached so we can avoid redundant re-attaches
  const attachedStreamIdRef = useRef<string | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // SAFE PLAY
  // ─────────────────────────────────────────────────────────────────────────
  const safePlay = useCallback((video: HTMLVideoElement) => {
    // Bail if a play() is already in flight
    if (playPromiseRef.current) return;

    const doPlay = () => {
      playPromiseRef.current = video.play()
        .then(() => {
          setNeedsTap(false);
          playPromiseRef.current = null;
        })
        .catch((e: DOMException) => {
          playPromiseRef.current = null;
          if (e.name === 'NotAllowedError') {
            // Browser requires a user gesture — show tap-to-play overlay
            setNeedsTap(true);
          } else if (e.name === 'AbortError') {
            // Benign — another load() interrupted this play(), will retry
          } else {
            console.warn('video.play() failed:', e.name, e.message);
          }
        });
    };

    if (video.readyState >= 2) {
      doPlay();
    } else {
      const onReady = () => {
        video.removeEventListener('loadeddata', onReady);
        doPlay();
      };
      // FIX: listen for 'loadeddata' (readyState ≥ 2) rather than
      // 'loadedmetadata' (readyState ≥ 1) — ensures enough data is buffered
      // before we call play(), which reduces AbortError noise on Safari.
      video.addEventListener('loadeddata', onReady);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // CHECK VIDEO TRACKS
  // ─────────────────────────────────────────────────────────────────────────
  const refreshHasVideoTrack = useCallback((s: MediaStream | null) => {
    if (!s) {
      setHasVideoTrack(false);
      return;
    }
    const live = s.getVideoTracks().some(
      t => t.readyState === 'live' && t.enabled,
    );
    setHasVideoTrack(live);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // ATTACH STREAM
  //
  // FIX (vs original): The original called video.load() AFTER setting
  // srcObject. On Safari this resets the element and clears srcObject,
  // causing a blank video. The correct sequence is:
  //   1. pause()
  //   2. srcObject = null  (detach old stream)
  //   3. load()            (reset element state)
  //   4. srcObject = newStream
  //   5. play()
  //
  // We also skip re-attaching when the stream id hasn't changed (avoids
  // an unnecessary flicker on React re-renders that pass the same stream).
  // ─────────────────────────────────────────────────────────────────────────
  const attachStream = useCallback((s: MediaStream | null) => {
    const video = videoRef.current;
    if (!video) return;

    const incomingId = s?.id ?? null;

    // Skip if same stream is already attached
    if (incomingId !== null && incomingId === attachedStreamIdRef.current) {
      // Still refresh hasVideoTrack in case tracks changed on the same stream
      refreshHasVideoTrack(s);
      return;
    }

    // Cancel any in-flight play() before we touch the element
    if (playPromiseRef.current) {
      playPromiseRef.current.then(() => attachStream(s)).catch(() => attachStream(s));
      return;
    }

    // 1. Pause
    if (!video.paused) {
      video.pause();
    }

    // 2. Detach old stream
    video.srcObject = null;

    // 3. Reset element (must happen BEFORE setting new srcObject)
    video.load();

    attachedStreamIdRef.current = incomingId;

    if (s) {
      // 4. Attach new stream
      video.srcObject = s;
      refreshHasVideoTrack(s);
      // 5. Play
      safePlay(video);
    } else {
      setHasVideoTrack(false);
      setNeedsTap(false);
    }
  }, [safePlay, refreshHasVideoTrack]);

  // ─────────────────────────────────────────────────────────────────────────
  // STREAM CHANGE EFFECT
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    attachStream(stream);
    if (!stream) return;

    // Re-attach when the browser adds/removes tracks on the same stream object
    // (e.g. when replaceTrack changes the underlying track mid-session).
    const onAddTrack = (e: MediaStreamTrackEvent) => {
      if (e.track.kind === 'video') {
        e.track.addEventListener('unmute', () => refreshHasVideoTrack(stream));
        e.track.addEventListener('ended', () => refreshHasVideoTrack(stream));
        refreshHasVideoTrack(stream);
        // Force video element to pick up the new track
        const video = videoRef.current;
        if (video) {
          // Only re-attach if this is a new stream id (shouldn't be, but be safe)
          if (video.srcObject !== stream) {
            attachStream(stream);
          } else {
            // Same stream object, track was added — reload so the element notices
            if (playPromiseRef.current) return;
            video.pause();
            video.srcObject = null;
            video.load();
            video.srcObject = stream;
            safePlay(video);
          }
        }
      }
    };

    const onRemoveTrack = (e: MediaStreamTrackEvent) => {
      if (e.track.kind === 'video') {
        refreshHasVideoTrack(stream);
      }
    };

    // Per-track mute/unmute listeners — remote tracks mute when disabled
    const trackCleanups: (() => void)[] = [];
    const attachTrackListeners = () => {
      stream.getTracks().forEach(track => {
        const onMute = () => {
          if (track.kind === 'video') setHasVideoTrack(false);
        };
        const onUnmute = () => {
          if (track.kind === 'video') setHasVideoTrack(true);
        };
        track.addEventListener('mute', onMute);
        track.addEventListener('unmute', onUnmute);
        trackCleanups.push(() => {
          track.removeEventListener('mute', onMute);
          track.removeEventListener('unmute', onUnmute);
        });
      });
    };
    attachTrackListeners();

    stream.addEventListener('addtrack', onAddTrack);
    stream.addEventListener('removetrack', onRemoveTrack);

    return () => {
      stream.removeEventListener('addtrack', onAddTrack);
      stream.removeEventListener('removetrack', onRemoveTrack);
      trackCleanups.forEach(fn => fn());
    };
  }, [stream, attachStream, safePlay, refreshHasVideoTrack]);

  // ─────────────────────────────────────────────────────────────────────────
  // FULLSCREEN LISTENER
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
  const handleManualPlay = () => {
    const video = videoRef.current;
    if (!video) return;
    playPromiseRef.current = null;
    safePlay(video);
  };

  const togglePip = async () => {
    if (!videoRef.current) return;
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

  // FIX: For remote peers, cameraEnabled is not passed (defaults true), so
  // we must also check hasVideoTrack to decide whether to show "CAM OFF".
  // Show cam-off overlay only when stream exists but has no live video track.
  const showCamOff = stream !== null && (!cameraEnabled || !hasVideoTrack);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#0f0a0a] overflow-hidden flex flex-col">
      {stream ? (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={muted}
            preload="auto"
            className="w-full h-full object-contain"
            disablePictureInPicture={!interactive}
            style={{ pointerEvents: 'none' }}
          />

          {/* Tap-to-play overlay (autoplay blocked by browser) */}
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

          {/* Camera off overlay */}
          {showCamOff && !needsTap && (
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
        /* No stream at all */
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

      {/* Label bar */}
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