'use client';

import React, { useEffect, useRef, useState } from 'react';

interface Props {
  stream: MediaStream | null;
  muted?: boolean;
  label?: string;
  isLive?: boolean;
  interactive?: boolean;
  cameraEnabled?: boolean; // shows a CAM OFF overlay when stream exists but cam is disabled
}

export default function VideoMonitor({ stream, muted = true, label = 'FEED', isLive = false, interactive = true, cameraEnabled = true }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPip, setIsPip] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Assign stream srcObject every time stream changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) {
      video.play().catch(() => {});
    }
  }, [stream]);

  // Track fullscreen changes
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const togglePip = async () => {
    if (!videoRef.current) return;
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

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#0f0a0a] overflow-hidden flex flex-col">

      {/* Video element — always shown when stream exists */}
      {stream ? (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={muted}
            className="w-full h-full object-contain"
            style={{ pointerEvents: 'none' }}
          />
          {/* CAM OFF overlay — stream exists but camera is disabled */}
          {!cameraEnabled && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0f0a0a]/95">
              <div className="w-14 h-14 border-[3px] border-[#4C5C2D] flex items-center justify-center">
                <svg className="w-7 h-7 text-[#4C5C2D]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="square" strokeWidth={2} d="M3 3l18 18M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V9" />
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

      {/* Bottom label bar — always visible */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between items-center px-3 py-1.5 bg-[#1B0C0C]/90 border-t-[2px] border-[#4C5C2D]">
        <div className="flex items-center gap-2">
          {isLive && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
          <span className="text-[#FFDE42] font-heading text-xs tracking-widest uppercase font-bold">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {stream && interactive && (
            <button
              onClick={togglePip}
              title="Pop Out (Picture-in-Picture)"
              className="text-[#FFDE42] border-[2px] border-[#4C5C2D] px-2 py-0.5 text-[10px] font-heading font-bold uppercase hover:bg-[#FFDE42] hover:text-[#1B0C0C] transition-colors"
            >
              {isPip ? 'CLOSE' : 'POP OUT'}
            </button>
          )}
          <button
            onClick={toggleFullscreen}
            title="Fullscreen"
            className="text-[#FFDE42] border-[2px] border-[#4C5C2D] px-2 py-0.5 text-[10px] font-heading font-bold uppercase hover:bg-[#FFDE42] hover:text-[#1B0C0C] transition-colors"
          >
            {isFullscreen ? '✕ FS' : '⛶ FS'}
          </button>
        </div>
      </div>
    </div>
  );
}
