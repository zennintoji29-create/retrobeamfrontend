'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Maximize, Minimize, Expand, VideoOff } from 'lucide-react';

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
  label = 'Guest',
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
            setNeedsTap(true);
          } else if (e.name === 'AbortError') {
            // Benign
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
  // ─────────────────────────────────────────────────────────────────────────
  const attachStream = useCallback((s: MediaStream | null) => {
    const video = videoRef.current;
    if (!video) return;

    const incomingId = s?.id ?? null;

    if (incomingId !== null && incomingId === attachedStreamIdRef.current) {
      refreshHasVideoTrack(s);
      return;
    }

    if (playPromiseRef.current) {
      playPromiseRef.current.then(() => attachStream(s)).catch(() => attachStream(s));
      return;
    }

    if (!video.paused) {
      video.pause();
    }

    video.srcObject = null;
    video.load();
    attachedStreamIdRef.current = incomingId;

    if (s) {
      video.srcObject = s;
      refreshHasVideoTrack(s);
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

    const onAddTrack = (e: MediaStreamTrackEvent) => {
      const kind = e.track.kind;
      if (kind === 'video' || kind === 'audio') {
        if (kind === 'video') {
          e.track.addEventListener('unmute', () => refreshHasVideoTrack(stream));
          e.track.addEventListener('ended', () => refreshHasVideoTrack(stream));
          refreshHasVideoTrack(stream);
        }
        const video = videoRef.current;
        if (video) {
          if (video.srcObject !== stream) {
            attachStream(stream);
          } else {
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
      const video = videoRef.current;
      if (video && video.srcObject === stream) {
        if (playPromiseRef.current) return;
        video.pause();
        video.srcObject = null;
        video.load();
        video.srcObject = stream;
        safePlay(video);
      }
    };

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
  const showCamOff = stream !== null && (!cameraEnabled || !hasVideoTrack);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#0a0a0b] overflow-hidden flex flex-col group">
      {stream ? (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={muted}
            preload="auto"
            className="w-full h-full object-cover sm:object-contain"
            disablePictureInPicture={!interactive}
          />

          {/* Tap-to-play overlay */}
          {needsTap && (
            <button
              onClick={handleManualPlay}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-brand-base/80 z-10 backdrop-blur-sm"
            >
              <div className="w-14 h-14 rounded-full bg-brand-accent/20 flex items-center justify-center border border-brand-accent/50 group-hover:bg-brand-accent/40 transition-colors">
                <svg className="w-6 h-6 text-brand-accent" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <span className="text-brand-white text-xs font-semibold tracking-widest uppercase shadow-sm">
                Tap to Play
              </span>
            </button>
          )}

          {/* Camera off overlay */}
          {showCamOff && !needsTap && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-brand-base/90 z-10 backdrop-blur-sm">
              <div className="w-16 h-16 rounded-full bg-brand-surface-2 flex items-center justify-center border border-brand-border shadow-sm">
                <VideoOff size={24} className="text-brand-gray" />
              </div>
              <span className="text-brand-gray text-xs font-semibold tracking-wider uppercase">Camera Off</span>
            </div>
          )}
        </>
      ) : (
        /* No stream at all */
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0a0b] z-10">
          <div className="w-16 h-16 rounded-full bg-brand-surface-2/50 flex items-center justify-center border border-brand-border shadow-sm">
            <VideoOff size={24} className="text-brand-gray/60" />
          </div>
          <span className="text-brand-gray/60 text-xs font-semibold tracking-wider uppercase">Loading...</span>
        </div>
      )}

      {/* Label bar */}
      <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center z-10 transition-opacity">
        <div className="flex items-center gap-2 min-w-0 bg-brand-surface/70 backdrop-blur-md border border-brand-border/50 px-3 py-1.5 rounded-lg shadow-sm">
          {isLive && <span className="w-1.5 h-1.5 rounded-full bg-brand-danger shadow-glow animate-pulse shrink-0" />}
          <span className="text-brand-white text-[11px] font-semibold tracking-widest uppercase truncate">{label}</span>
        </div>
        
        <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {stream && interactive && pipAvailable && (
            <button
              onClick={togglePip}
              title="Pop Out (Picture-in-Picture)"
              className="p-1.5 bg-brand-surface/70 backdrop-blur-md rounded-lg text-brand-white border border-brand-border/50 hover:bg-brand-surface transition-colors shadow-sm"
            >
              <Expand size={12} />
            </button>
          )}
          {interactive && (
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              className="p-1.5 bg-brand-surface/70 backdrop-blur-md rounded-lg text-brand-white border border-brand-border/50 hover:bg-brand-surface transition-colors shadow-sm"
            >
              {isFullscreen ? <Minimize size={12} /> : <Maximize size={12} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}