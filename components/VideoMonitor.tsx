'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  stream: MediaStream | null;
  muted?: boolean;
  label?: string;
  isLive?: boolean;
  interactive?: boolean;
  cameraEnabled?: boolean;
  /** Pulsing speaking ring when the peer is talking */
  isSpeaking?: boolean;
  /** Connection quality indicator dot */
  connectionQuality?: 'good' | 'poor' | 'lost' | null;
  /** Avatar initials shown in no-video state */
  initials?: string;
}

export default function VideoMonitor({
  stream,
  muted = true,
  label = 'FEED',
  isLive = false,
  interactive = true,
  cameraEnabled = true,
  isSpeaking = false,
  connectionQuality = null,
  initials,
}: Props) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPip,        setIsPip]        = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [needsTap,     setNeedsTap]     = useState(false);
  const [isBuffering,  setIsBuffering]  = useState(false);

  // Edge case: stream with only audio tracks (mic-only peer) — show avatar card
  const hasVideoTrack = !!stream?.getVideoTracks().length;
  const showVideo     = !!stream && cameraEnabled && hasVideoTrack;
  const showAudioOnly = !!stream && (!cameraEnabled || !hasVideoTrack);

  const avatarText = initials || label.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '??';

  // ── Stream attachment ────────────────────────────────────────────────────
  const attachStream = useCallback((s: MediaStream | null) => {
    const video = videoRef.current;
    if (!video || video.srcObject === s) return;
    video.srcObject = s;
    if (s) {
      video.play()
        .then(() => { setNeedsTap(false); setIsBuffering(false); })
        .catch((e: DOMException) => {
          if (e.name === 'NotAllowedError') setNeedsTap(true);
          // NotSupportedError can happen if stream has 0 tracks at attach time — safe to ignore
        });
    }
  }, []);

  useEffect(() => {
    attachStream(stream);
    if (!stream) return;
    const refresh = () => {
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = null;
      video.srcObject = stream;
      video.play().catch(() => {});
    };
    stream.addEventListener('addtrack',    refresh);
    stream.addEventListener('removetrack', refresh);
    return () => {
      stream.removeEventListener('addtrack',    refresh);
      stream.removeEventListener('removetrack', refresh);
    };
  }, [stream, attachStream]);

  // ── Buffer / stall detection ─────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const on  = () => setIsBuffering(true);
    const off = () => setIsBuffering(false);
    v.addEventListener('waiting', on);
    v.addEventListener('stalled', on);
    v.addEventListener('playing', off);
    v.addEventListener('canplay', off);
    return () => {
      v.removeEventListener('waiting', on);
      v.removeEventListener('stalled', on);
      v.removeEventListener('playing', off);
      v.removeEventListener('canplay', off);
    };
  }, []);

  // ── Fullscreen tracking ──────────────────────────────────────────────────
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const handleManualPlay = () =>
    videoRef.current?.play().then(() => setNeedsTap(false)).catch(console.warn);

  const togglePip = async () => {
    if (!videoRef.current || !document.pictureInPictureEnabled) return;
    try {
      document.pictureInPictureElement
        ? (await document.exitPictureInPicture(), setIsPip(false))
        : (await videoRef.current.requestPictureInPicture(), setIsPip(true));
    } catch (e) { console.error('PIP:', e); }
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      document.fullscreenElement
        ? await document.exitFullscreen()
        : await containerRef.current.requestFullscreen();
    } catch (e) { console.error('FS:', e); }
  };

  const pipAvailable = typeof document !== 'undefined' && !!document.pictureInPictureEnabled;

  const qualityDot = connectionQuality === 'good' ? 'bg-green-400'
                   : connectionQuality === 'poor' ? 'bg-yellow-400 animate-pulse'
                   : connectionQuality === 'lost' ? 'bg-red-500 animate-pulse'
                   : null;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[#0f0a0a] overflow-hidden flex flex-col select-none"
    >
      {/* Speaking ring */}
      {isSpeaking && (
        <div
          className="absolute inset-0 z-[5] pointer-events-none"
          style={{ boxShadow: 'inset 0 0 0 3px #FFDE42, inset 0 0 20px 2px rgba(255,222,66,0.12)' }}
        />
      )}

      {/* Video element — always mounted, visibility controlled via opacity */}
      <video
        ref={videoRef}
        autoPlay playsInline
        muted={muted}
        disablePictureInPicture={!interactive}
        className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-200
          ${showVideo ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />

      {/* ── No-video state ────────────────────────────────────────────────── */}
      {!showVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pb-7">
          {/* Avatar square */}
          <div
            className={`w-14 h-14 sm:w-16 sm:h-16 border-[3px] flex items-center justify-center
              font-heading font-black text-xl sm:text-2xl transition-colors duration-200
              ${isSpeaking
                ? 'border-[#FFDE42] text-[#FFDE42] bg-[#FFDE42]/10'
                : 'border-[#4C5C2D] text-[#4C5C2D]'}`}
          >
            {avatarText}
          </div>

          {showAudioOnly ? (
            /* Audio-only: animated waveform bars */
            <div className="flex items-end gap-[3px] h-4">
              {[0.35, 0.65, 1, 0.55, 0.8, 0.45, 0.9, 0.5, 0.7].map((h, i) => (
                <div
                  key={i}
                  className={`w-[3px] rounded-sm transition-all duration-100
                    ${isSpeaking ? 'bg-[#FFDE42]' : 'bg-[#4C5C2D]'}`}
                  style={{
                    height: isSpeaking ? `${h * 16}px` : '3px',
                    transitionDelay: `${i * 40}ms`,
                  }}
                />
              ))}
            </div>
          ) : (
            /* No stream: camera icon */
            <svg className="w-6 h-6 text-[#4C5C2D]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="square" strokeWidth={1.5}
                d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-7.5A2.25 2.25 0 0013.5 6.75h-9A2.25 2.25 0 002.25 9v7.5A2.25 2.25 0 004.5 18.75z" />
            </svg>
          )}

          <span
            className={`font-heading text-[9px] tracking-[0.15em] uppercase font-bold transition-colors duration-200
              ${isSpeaking ? 'text-[#FFDE42]' : 'text-[#4C5C2D]'}`}
          >
            {showAudioOnly ? (isSpeaking ? 'SPEAKING' : 'CAM OFF') : 'NO SIGNAL'}
          </span>
        </div>
      )}

      {/* ── Buffering spinner ─────────────────────────────────────────────── */}
      {isBuffering && showVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20 pointer-events-none">
          <div className="w-7 h-7 border-[2px] border-[#FFDE42] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* ── Tap-to-play ───────────────────────────────────────────────────── */}
      {needsTap && (
        <button
          onClick={handleManualPlay}
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0f0a0a]/80 z-20"
        >
          <div className="w-14 h-14 border-[3px] border-[#FFDE42] flex items-center justify-center">
            <svg className="w-7 h-7 text-[#FFDE42]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <span className="text-[#FFDE42] font-heading text-xs tracking-widest uppercase font-bold">TAP TO PLAY</span>
        </button>
      )}

      {/* ── Bottom label bar ─────────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between items-center
        px-2 py-1 bg-[#1B0C0C]/90 border-t-[2px] border-[#4C5C2D] z-10 gap-1">
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          {isLive     && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />}
          {qualityDot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${qualityDot}`} />}
          {isSpeaking && !muted && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#FFDE42] animate-pulse shrink-0" title="Speaking" />
          )}
          <span className="text-[#FFDE42] font-heading text-[10px] tracking-widest uppercase font-bold truncate leading-none">
            {label}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {stream && interactive && pipAvailable && (
            <button onClick={togglePip}
              className="text-[#FFDE42] border border-[#4C5C2D] px-1.5 py-px text-[9px] font-heading font-bold uppercase hover:bg-[#FFDE42] hover:text-[#1B0C0C] transition-colors leading-none">
              {isPip ? 'CLOSE' : 'POP'}
            </button>
          )}
          <button onClick={toggleFullscreen}
            className="text-[#FFDE42] border border-[#4C5C2D] px-1.5 py-px text-[9px] font-heading font-bold uppercase hover:bg-[#FFDE42] hover:text-[#1B0C0C] transition-colors leading-none">
            {isFullscreen ? '✕' : '⛶'}
          </button>
        </div>
      </div>
    </div>
  );
}