'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';

const TOTAL_FRAMES = 192;
const FRAME_DELAY_MS = 41;

function getFrameSrc(index: number): string {
  const n = String(index).padStart(3, '0');
  return `/sequence/frame_${n}_delay-0.041s.webp`;
}

export default function Home() {
  const [currentFrame, setCurrentFrame] = useState(0);
  const frameRef = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      frameRef.current = (frameRef.current + 1) % TOTAL_FRAMES;
      setCurrentFrame(frameRef.current);
    }, FRAME_DELAY_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden min-h-screen">

      {/* Floating spore particles */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full animate-float-up"
            style={{
              left: `${(i * 13) % 100}%`,
              width: `${(i % 4) + 1}px`,
              height: `${(i % 4) + 1}px`,
              background: i % 3 === 0 ? 'rgba(255,0,160,0.6)' : i % 3 === 1 ? 'rgba(0,220,255,0.4)' : 'rgba(255,255,255,0.3)',
              filter: 'blur(0.5px)',
              animationDuration: `${10 + (i % 10)}s`,
              animationDelay: `-${(i * 1.7) % 18}s`,
              bottom: '-10px',
            }}
          />
        ))}
      </div>

      {/* CRT scanline overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.08) 3px, rgba(0,0,0,0.08) 4px)' }}
      />

      {/* MAIN CONTENT */}
      <div className="z-20 w-full max-w-7xl flex flex-col items-center px-4 sm:px-8 py-10">

        {/* GLITCH TITLE — full width, centered */}
        <motion.div
          initial={{ y: 40, opacity: 0, filter: 'blur(16px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-1"
        >
          <h1
            data-text="MEET.EXE"
            className="font-heading text-white glitch-text leading-none tracking-[0.12em]"
            style={{
              fontSize: 'clamp(2.8rem, 9vw, 7.5rem)',
              textShadow: `
                0 0 20px rgba(255,170,0,0.95),
                0 0 60px rgba(255,170,0,0.6),
                0 0 120px rgba(255,170,0,0.3),
                0 0 4px rgba(255,170,0,0.8)
              `,
            }}
          >
            MEET.EXE
          </h1>
        </motion.div>

        {/* SUBTITLE */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 1, ease: 'easeOut' }}
          className="font-body text-white/40 uppercase tracking-[0.25em] text-xs sm:text-sm mb-10 text-center"
        >
          Real-time cinematic broadcast &mdash; share your screen or sync video across the void
        </motion.p>

        {/* TWO-COLUMN LAYOUT */}
        <div className="w-full flex flex-col lg:flex-row gap-6 lg:gap-8 items-stretch">

          {/* ── LEFT: Session Card ── */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.75, duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
            className="relative lg:w-[360px] flex-shrink-0"
          >
            {/* Glow */}
            <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none" style={{ width: '130%', height: '130%', top: '-15%', background: 'radial-gradient(ellipse at center, rgba(255,0,160,0.18) 0%, rgba(0,220,255,0.08) 50%, transparent 75%)', filter: 'blur(40px)', zIndex: -1 }} />

            <div className="relative overflow-hidden h-full" style={{ background: 'rgba(5, 3, 15, 0.82)', border: '1px solid rgba(255,0,160,0.35)', borderRadius: '2px', boxShadow: '0 0 0 1px rgba(0,220,255,0.08), 0 0 40px rgba(255,0,160,0.2), 0 0 80px rgba(0,0,0,0.8), inset 0 0 60px rgba(0,0,0,0.4)', backdropFilter: 'blur(20px)' }}>

              {/* Top accent */}
              <div style={{ height: '2px', background: 'linear-gradient(90deg, transparent, rgba(255,0,160,0.9) 30%, rgba(0,220,255,0.7) 70%, transparent)' }} />

              {/* Corner accents */}
              {[
                { top: 8, left: 8, borderTop: '1px solid rgba(255,0,160,0.7)', borderLeft: '1px solid rgba(255,0,160,0.7)' },
                { top: 8, right: 8, borderTop: '1px solid rgba(255,0,160,0.7)', borderRight: '1px solid rgba(255,0,160,0.7)' },
                { bottom: 8, left: 8, borderBottom: '1px solid rgba(0,220,255,0.5)', borderLeft: '1px solid rgba(0,220,255,0.5)' },
                { bottom: 8, right: 8, borderBottom: '1px solid rgba(0,220,255,0.5)', borderRight: '1px solid rgba(0,220,255,0.5)' },
              ].map((style, i) => (
                <div key={i} className="absolute pointer-events-none" style={{ ...style, width: 20, height: 20 }} />
              ))}

              <div className="p-8 sm:p-10 flex flex-col h-full">
                {/* Status */}
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#00ff88', boxShadow: '0 0 8px #00ff88' }} />
                    <span className="font-body text-white/40 text-xs tracking-[0.2em] uppercase">System Online</span>
                  </div>
                  <span className="font-body text-white/20 text-xs tracking-[0.15em] uppercase font-mono">v2.4.1_STABLE</span>
                </div>

                {/* Divider */}
                <div className="flex items-center gap-4 mb-8">
                  <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, transparent, rgba(255,0,160,0.5))' }} />
                  <span className="font-heading text-xs tracking-[0.4em] uppercase" style={{ color: 'rgba(255,0,160,0.9)' }}>Initiate Session</span>
                  <div style={{ flex: 1, height: '1px', background: 'linear-gradient(270deg, transparent, rgba(255,0,160,0.5))' }} />
                </div>

                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 mb-8">
                  <Link href="/auth/login" className="flex-1 group">
                    <div className="relative w-full py-5 font-heading text-lg tracking-[0.2em] uppercase text-center overflow-hidden transition-all duration-300" style={{ background: 'rgba(255,0,160,0.12)', border: '1px solid rgba(255,0,160,0.6)', borderRadius: '1px', color: 'rgb(255,0,160)' }}>
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ background: 'rgba(255,0,160,0.2)', boxShadow: 'inset 0 0 30px rgba(255,0,160,0.15)' }} />
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,0,160,0.06) 2px, rgba(255,0,160,0.06) 4px)' }} />
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none" style={{ boxShadow: '0 0 30px rgba(255,0,160,0.5), inset 0 0 20px rgba(255,0,160,0.1)' }} />
                      <span className="relative z-10 group-hover:text-white transition-colors duration-300">▶&nbsp; Broadcast</span>
                    </div>
                  </Link>
                  <Link href="/join" className="flex-1 group">
                    <div className="relative w-full py-5 font-heading text-lg tracking-[0.2em] uppercase text-center overflow-hidden transition-all duration-300" style={{ background: 'rgba(0,220,255,0.06)', border: '1px solid rgba(0,220,255,0.25)', borderRadius: '1px', color: 'rgba(0,220,255,0.7)' }}>
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ background: 'rgba(0,220,255,0.12)' }} />
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none" style={{ boxShadow: '0 0 20px rgba(0,220,255,0.3), inset 0 0 15px rgba(0,220,255,0.08)' }} />
                      <span className="relative z-10 group-hover:text-white transition-colors duration-300">⬡&nbsp; Join Stream</span>
                    </div>
                  </Link>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-px mb-8" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '1px' }}>
                  {[{ label: 'Latency', value: '&lt;50ms' }, { label: 'Encryption', value: 'E2E' }, { label: 'Protocol', value: 'WebRTC' }].map(({ label, value }) => (
                    <div key={label} className="flex flex-col items-center py-3 px-2" style={{ background: 'rgba(5,3,15,0.9)' }}>
                      <span className="font-heading text-base tracking-widest" style={{ color: 'rgba(0,220,255,0.8)' }} dangerouslySetInnerHTML={{ __html: value }} />
                      <span className="font-body text-white/25 text-xs tracking-[0.15em] uppercase mt-1">{label}</span>
                    </div>
                  ))}
                </div>

                <p className="text-center font-body text-white/20 text-xs tracking-[0.2em] uppercase mt-auto">
                  ⬡ &nbsp; Encrypted &nbsp;·&nbsp; Real-Time &nbsp;·&nbsp; Dimensional &nbsp; ⬡
                </p>
              </div>

              {/* Bottom accent */}
              <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, rgba(0,220,255,0.4) 40%, rgba(255,0,160,0.3) 60%, transparent)' }} />
            </div>
          </motion.div>

          {/* ── RIGHT: Live Sequence Monitor ── */}
          <motion.div
            initial={{ opacity: 0, x: 40, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ delay: 0.95, duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex-1"
          >
            {/* Glow */}
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', width: '80%', height: '60%', top: '20%', background: 'radial-gradient(ellipse, rgba(255,0,160,0.12) 0%, rgba(0,220,255,0.06) 60%, transparent 80%)', filter: 'blur(50px)', pointerEvents: 'none', zIndex: -1 }} />

            <div className="relative overflow-hidden h-full" style={{ background: 'rgba(5, 3, 15, 0.85)', border: '1px solid rgba(0,220,255,0.25)', borderRadius: '2px', boxShadow: '0 0 0 1px rgba(255,0,160,0.06), 0 0 50px rgba(0,220,255,0.1), 0 0 100px rgba(0,0,0,0.9), inset 0 0 40px rgba(0,0,0,0.5)', backdropFilter: 'blur(20px)' }}>

              {/* Top accent — flipped colors */}
              <div style={{ height: '2px', background: 'linear-gradient(90deg, transparent, rgba(0,220,255,0.8) 30%, rgba(255,0,160,0.7) 70%, transparent)' }} />

              {/* Corner accents */}
              {[
                { top: 8, left: 8, borderTop: '1px solid rgba(0,220,255,0.6)', borderLeft: '1px solid rgba(0,220,255,0.6)' },
                { top: 8, right: 8, borderTop: '1px solid rgba(0,220,255,0.6)', borderRight: '1px solid rgba(0,220,255,0.6)' },
                { bottom: 8, left: 8, borderBottom: '1px solid rgba(255,0,160,0.4)', borderLeft: '1px solid rgba(255,0,160,0.4)' },
                { bottom: 8, right: 8, borderBottom: '1px solid rgba(255,0,160,0.4)', borderRight: '1px solid rgba(255,0,160,0.4)' },
              ].map((s, i) => (
                <div key={i} className="absolute pointer-events-none" style={{ ...s, width: 20, height: 20 }} />
              ))}

              {/* Monitor header */}
              <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-2">
                  <div className="animate-pulse w-2 h-2 rounded-full" style={{ background: '#ff0090', boxShadow: '0 0 8px #ff0090' }} />
                  <span className="font-body text-white/35 text-xs tracking-[0.2em] uppercase">Live Feed</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-white/20 text-xs tracking-widest">{String(currentFrame).padStart(3, '0')} / {TOTAL_FRAMES - 1}</span>
                  <div style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.1)' }} />
                  <span className="font-mono text-xs tracking-widest" style={{ color: 'rgba(0,220,255,0.6)' }}>24fps</span>
                </div>
              </div>

              {/* FRAME DISPLAY */}
              <div style={{ position: 'relative', aspectRatio: '16/9', background: '#000', overflow: 'hidden' }}>
                <Image
                  src={getFrameSrc(currentFrame)}
                  alt={`frame ${currentFrame}`}
                  fill
                  style={{ objectFit: 'cover' }}
                  priority={currentFrame < 5}
                  unoptimized
                />

                {/* CRT scanlines */}
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2, background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.1) 3px, rgba(0,0,0,0.1) 4px)' }} />

                {/* Vignette */}
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3, background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.65) 100%)' }} />

                {/* REC */}
                <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 4, display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(5,3,15,0.75)', border: '1px solid rgba(255,0,160,0.5)', borderRadius: '1px', padding: '3px 9px', backdropFilter: 'blur(6px)' }}>
                  <div className="animate-pulse" style={{ width: 5, height: 5, borderRadius: '50%', background: '#ff0090' }} />
                  <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,0,160,0.9)', letterSpacing: '0.2em' }}>REC</span>
                </div>

                {/* Viewer avatars */}
                <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 4, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ display: 'flex' }}>
                    {['#ff0090', '#00dcff', '#00ff88', '#FFAA00'].map((c, i) => (
                      <div key={i} style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: '2px solid rgba(5,3,15,0.85)', marginLeft: i === 0 ? 0 : -7, opacity: 0.9 }} />
                    ))}
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>4 watching</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ width: '100%', height: '2px', background: 'rgba(255,255,255,0.06)', borderRadius: '999px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${(currentFrame / (TOTAL_FRAMES - 1)) * 100}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, rgba(0,220,255,0.9), rgba(255,0,160,0.8))',
                    borderRadius: '999px',
                    transition: 'width 0.04s linear',
                    boxShadow: '0 0 8px rgba(0,220,255,0.5)',
                  }} />
                </div>
              </div>

              {/* Bottom accent */}
              <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, rgba(255,0,160,0.4) 40%, rgba(0,220,255,0.3) 60%, transparent)' }} />
            </div>
          </motion.div>

        </div>
      </div>
    </div>
  );
}