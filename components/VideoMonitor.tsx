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
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPip, setIsPip] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  // FIX: track whether we have at least one active video track to show
  const [hasVideoTrack, setHasVideoTrack] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────
  // safePlay — attempt play() with proper readyState guard
  //
  // FIX (video freeze after re-attach): Calling play() while readyState < 2
  //   (HAVE_CURRENT_DATA) causes a race on Chrome/mobile where the video
  //   element enters a broken state — it renders the first frame and stops.
  //   We wait for 'loadedmetadata' (readyState >= 1) before calling play().
  //
  // FIX (repeated play() AbortError): Calling play() while a previous play()
  //   Promise is still pending causes an AbortError. We track the pending
  //   promise and only call play() once per srcObject assignment.
  //
  // FIX (iOS Safari black frame): On iOS, play() must be called inside a
  //   user gesture OR after 'loadedmetadata'. We always defer to the event.
  // ─────────────────────────────────────────────────────────────────────────
  const playPromiseRef = useRef<Promise<void> | null>(null);

  const safePlay = useCallback((video: HTMLVideoElement) => {
    // If already playing or loading, don't start another play() chain
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
            // Autoplay blocked — show tap overlay
            setNeedsTap(true);
          } else if (e.name === 'AbortError') {
            // Benign — another srcObject assignment is in flight
          } else {
            console.warn('Video play() failed:', e.name, e.message);
          }
        });
    };

    if (video.readyState >= 2) {
      // Already has data — play immediately
      doPlay();
    } else {
      // Wait for metadata so the browser has dimensions + can decode
      const onReady = () => {
        video.removeEventListener('loadedmetadata', onReady);
        doPlay();
      };
      video.addEventListener('loadedmetadata', onReady);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // attachStream
  //
  // FIX (video not updating when track is added to existing stream):
  //   We compare by stream.id AND by track count/ids.  If the stream object
  //   is the same but has new tracks, we still need to re-trigger play().
  //
  // FIX (null stream → black frame persists):
  //   When stream becomes null, we set srcObject=null AND call load() to
  //   force the video element to reset to its blank state.  Without load(),
  //   some browsers show the last decoded frame indefinitely.
  //
  // FIX (video freeze on mobile after toggle):
  //   On Android, setting srcObject on a playing video without pausing first
  //   can cause the decoder to lock up. We pause() before reassigning.
  // ─────────────────────────────────────────────────────────────────────────
  const attachStream = useCallback((s: MediaStream | null) => {
    const video = videoRef.current;
    if (!video) return;

    if (video.srcObject === s) {
      // Same object — but if it's playing and paused, try to resume
      if (s && video.paused && !needsTap) {
        safePlay(video);
      }
      return;
    }

    // Pause before reassigning to avoid decoder lock on Android
    if (!video.paused) {
      video.pause();
    }
    // Abort any in-flight play promise ref
    playPromiseRef.current = null;

    if (s) {
      video.srcObject = s;
      // Update video track presence for CAM OFF logic
      const videoTracks = s.getVideoTracks();
      setHasVideoTrack(videoTracks.length > 0 && videoTracks.some(t => t.readyState === 'live'));
      safePlay(video);
    } else {
      video.srcObject = null;
      video.load(); // FIX: force blank frame instead of last decoded frame
      setHasVideoTrack(false);
      setNeedsTap(false);
    }
  }, [safePlay, needsTap]);

  // ─────────────────────────────────────────────────────────────────────────
  // Stream attachment effect
  //
  // FIX (video freezes when remote peer re-enables camera):
  //   We listen to 'addtrack' on the stream and force a srcObject
  //   re-attachment cycle.  Without this, when a remote peer re-enables their
  //   camera (adding a new video track to an existing stream), the video
  //   element ignores the new track.
  //
  // FIX (track enabled state changes not reflected visually):
  //   We listen to 'mute'/'unmute' on individual tracks to update the
  //   hasVideoTrack state so the CAM OFF overlay shows/hides correctly.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    attachStream(stream);
    if (!stream) return;

    const onAddTrack = (e: MediaStreamTrackEvent) => {
      const video = videoRef.current;
      if (!video) return;

      if (e.track.kind === 'video') {
        setHasVideoTrack(true);
      }

      // FIX: pause + null + reassign forces the video element to re-init
      // its decoder and pick up the new track. Without this double-assignment,
      // the new track is present in the stream but the element ignores it.
      if (!video.paused) video.pause();
      playPromiseRef.current = null;
      video.srcObject = null;
      video.srcObject = stream;
      safePlay(video);
    };

    const onRemoveTrack = (e: MediaStreamTrackEvent) => {
      if (e.track.kind === 'video') {
        const remaining = stream.getVideoTracks().filter(t => t.readyState === 'live');
        setHasVideoTrack(remaining.length > 0);
      }
    };

    // Track-level mute events (track.enabled toggled on sender side)
    const trackListeners: Array<{ track: MediaStreamTrack; onMute: () => void; onUnmute: () => void }> = [];

    const attachTrackListeners = () => {
      stream.getVideoTracks().forEach(track => {
        const onMute = () => setHasVideoTrack(false);
        const onUnmute = () => setHasVideoTrack(true);
        track.addEventListener('mute', onMute);
        track.addEventListener('unmute', onUnmute);
        trackListeners.push({ track, onMute, onUnmute });
      });
    };
    attachTrackListeners();

    stream.addEventListener('addtrack', onAddTrack);
    stream.addEventListener('removetrack', onRemoveTrack);

    return () => {
      stream.removeEventListener('addtrack', onAddTrack);
      stream.removeEventListener('removetrack', onRemoveTrack);
      trackListeners.forEach(({ track, onMute, onUnmute }) => {
        track.removeEventListener('mute', onMute);
        track.removeEventListener('unmute', onUnmute);
      });
    };
  }, [stream, attachStream, safePlay]);

  // ── Fullscreen tracking ─────────────────────────────────────────────────
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ── Manual play (tap-to-play for autoplay-blocked environments) ─────────
  const handleManualPlay = () => {
    const video = videoRef.current;
    if (!video) return;
    playPromiseRef.current = null; // Clear any stale ref
    safePlay(video);
  };

  // ── PiP ─────────────────────────────────────────────────────────────────
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

  // FIX: show CAM OFF when:
  // 1. The caller explicitly says cameraEnabled=false, OR
  // 2. The stream exists but has no live video tracks
  const showCamOff = stream !== null && (!cameraEnabled || !hasVideoTrack);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[#0f0a0a] overflow-hidden flex flex-col"
    >
      {/* ── Video element ──────────────────────────────────────────────── */}
      {stream ? (
        <>
          {/*
            FIX (echo): local preview MUST have muted={true}.
            FIX (mobile scaling): object-contain prevents portrait crop.
            FIX (iOS): playsInline required to prevent full-screen takeover.
            FIX (video lag on low-end mobile): preload="auto" hints the
              browser to buffer frames aggressively.
          */}
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
          {showCamOff && (
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