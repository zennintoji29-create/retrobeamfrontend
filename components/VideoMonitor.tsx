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

  const playPromiseRef = useRef<Promise<void> | null>(null);

  // 🔥 CRITICAL FIX: Safe play with proper readyState guard
  const safePlay = useCallback((video: HTMLVideoElement) => {
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
            console.warn('Video play() failed:', e.name, e.message);
          }
        });
    };

    if (video.readyState >= 2) {
      doPlay();
    } else {
      const onReady = () => {
        video.removeEventListener('loadedmetadata', onReady);
        doPlay();
      };
      video.addEventListener('loadedmetadata', onReady);
    }
  }, []);

  // 🔥 CRITICAL FIX: Always re-attach on stream change or track enable/disable
  const attachStream = useCallback((s: MediaStream | null) => {
    const video = videoRef.current;
    if (!video) return;

    // Always pause and reset before attaching new stream
    if (!video.paused) {
      video.pause();
    }
    playPromiseRef.current = null;

    if (s) {
      video.srcObject = s;
      const videoTracks = s.getVideoTracks();
      setHasVideoTrack(videoTracks.length > 0 && videoTracks.some(t => t.readyState === 'live'));
      
      // 🔥 FIX: Force load() to ensure video element picks up the stream
      video.load();
      safePlay(video);
    } else {
      video.srcObject = null;
      video.load();
      setHasVideoTrack(false);
      setNeedsTap(false);
    }
  }, [safePlay]);

  // 🔥 FIX: Listen for track changes and re-attach
  useEffect(() => {
    attachStream(stream);
    if (!stream) return;

    const onAddTrack = (e: MediaStreamTrackEvent) => {
      const video = videoRef.current;
      if (!video) return;

      if (e.track.kind === 'video') {
        setHasVideoTrack(true);
      }

      // Re-init video element with updated stream
      if (!video.paused) video.pause();
      playPromiseRef.current = null;
      video.srcObject = null;
      video.load();
      video.srcObject = stream;
      safePlay(video);
    };

    const onRemoveTrack = (e: MediaStreamTrackEvent) => {
      if (e.track.kind === 'video') {
        const remaining = stream.getVideoTracks().filter(t => t.readyState === 'live');
        setHasVideoTrack(remaining.length > 0);
      }
    };

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

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

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