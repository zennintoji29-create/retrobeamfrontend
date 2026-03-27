'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

export default function Home() {
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
              background: i % 3 === 0
                ? 'rgba(255,0,160,0.6)'
                : i % 3 === 1
                ? 'rgba(0,220,255,0.4)'
                : 'rgba(255,255,255,0.3)',
              filter: 'blur(0.5px)',
              animationDuration: `${10 + (i % 10)}s`,
              animationDelay: `-${(i * 1.7) % 18}s`,
              bottom: '-10px',
            }}
          />
        ))}
      </div>

      {/* Full-page scanline overlay — thin horizontal lines for CRT feel */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.08) 3px, rgba(0,0,0,0.08) 4px)',
        }}
      />

      {/* Centered content */}
      <div className="z-20 w-full max-w-6xl flex flex-col items-center px-4 sm:px-6">

        {/* TITLE BLOCK */}
        <motion.div
          initial={{ y: 40, opacity: 0, filter: 'blur(16px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-2 flex flex-col items-center"
        >
          <h1
            data-text="MEET.EXE"
            className="font-heading text-white glitch-text leading-none tracking-[0.12em]"
            style={{
              fontSize: 'clamp(4rem, 16vw, 13rem)',
              textShadow: `
                0 0 20px rgba(255,0,160,0.9),
                0 0 60px rgba(255,0,160,0.6),
                0 0 120px rgba(255,0,160,0.3),
                0 0 4px rgba(0,220,255,0.8)
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
          className="font-body text-white/40 uppercase tracking-[0.25em] text-xs sm:text-sm mb-12 sm:mb-16 text-center"
        >
          Real-time cinematic broadcast &mdash; share your screen or sync video across the void
        </motion.p>

        {/* HERO PANEL */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.75, duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-3xl mx-auto"
        >
          {/* Outer ambient glow */}
          <div
            className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
            style={{
              width: '110%',
              height: '130%',
              top: '-15%',
              background: 'radial-gradient(ellipse at center, rgba(255,0,160,0.18) 0%, rgba(0,220,255,0.08) 50%, transparent 75%)',
              filter: 'blur(40px)',
              zIndex: -1,
            }}
          />

          {/* Card */}
          <div
            className="relative overflow-hidden"
            style={{
              background: 'rgba(5, 3, 15, 0.82)',
              border: '1px solid rgba(255,0,160,0.35)',
              borderRadius: '2px',
              boxShadow: `
                0 0 0 1px rgba(0,220,255,0.08),
                0 0 40px rgba(255,0,160,0.2),
                0 0 80px rgba(0,0,0,0.8),
                inset 0 0 60px rgba(0,0,0,0.4)
              `,
              backdropFilter: 'blur(20px)',
            }}
          >
            {/* Top accent bar */}
            <div
              style={{
                height: '2px',
                background: 'linear-gradient(90deg, transparent, rgba(255,0,160,0.9) 30%, rgba(0,220,255,0.7) 70%, transparent)',
              }}
            />

            {/* Corner accents */}
            {[
              { top: 8, left: 8, borderTop: '1px solid rgba(255,0,160,0.7)', borderLeft: '1px solid rgba(255,0,160,0.7)' },
              { top: 8, right: 8, borderTop: '1px solid rgba(255,0,160,0.7)', borderRight: '1px solid rgba(255,0,160,0.7)' },
              { bottom: 8, left: 8, borderBottom: '1px solid rgba(0,220,255,0.5)', borderLeft: '1px solid rgba(0,220,255,0.5)' },
              { bottom: 8, right: 8, borderBottom: '1px solid rgba(0,220,255,0.5)', borderRight: '1px solid rgba(0,220,255,0.5)' },
            ].map((style, i) => (
              <div key={i} className="absolute pointer-events-none" style={{ ...style, width: 20, height: 20 }} />
            ))}

            {/* Card inner content */}
            <div className="p-8 sm:p-12">

              {/* Status row */}
              <div className="flex items-center justify-between mb-8 sm:mb-10">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ background: '#00ff88', boxShadow: '0 0 8px #00ff88' }}
                  />
                  <span className="font-body text-white/40 text-xs tracking-[0.2em] uppercase">System Online</span>
                </div>
                <span className="font-body text-white/20 text-xs tracking-[0.15em] uppercase font-mono">v2.4.1_STABLE</span>
              </div>

              {/* Divider with label */}
              <div className="flex items-center gap-4 mb-8 sm:mb-10">
                <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, transparent, rgba(255,0,160,0.5))' }} />
                <span
                  className="font-heading text-xs sm:text-sm tracking-[0.3em] sm:tracking-[0.4em] uppercase"
                  style={{ color: 'rgba(255,0,160,0.9)' }}
                >
                  Initiate Session
                </span>
                <div style={{ flex: 1, height: '1px', background: 'linear-gradient(270deg, transparent, rgba(255,0,160,0.5))' }} />
              </div>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 sm:gap-5 mb-8 sm:mb-10">

                {/* PRIMARY — Broadcast */}
                <Link href="/auth/login" className="flex-1 group">
                  <div
                    className="relative w-full py-5 sm:py-6 font-heading text-lg sm:text-xl tracking-[0.2em] uppercase text-center overflow-hidden transition-all duration-300"
                    style={{
                      background: 'rgba(255,0,160,0.12)',
                      border: '1px solid rgba(255,0,160,0.6)',
                      borderRadius: '1px',
                      color: 'rgb(255,0,160)',
                    }}
                  >
                    {/* Hover fill */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{
                        background: 'rgba(255,0,160,0.2)',
                        boxShadow: 'inset 0 0 30px rgba(255,0,160,0.15)',
                      }}
                    />
                    {/* Scanline on hover */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{
                        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,0,160,0.06) 2px, rgba(255,0,160,0.06) 4px)',
                      }}
                    />
                    {/* Glow on hover */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none"
                      style={{ boxShadow: '0 0 30px rgba(255,0,160,0.5), inset 0 0 20px rgba(255,0,160,0.1)' }}
                    />
                    <span className="relative z-10 group-hover:text-white transition-colors duration-300">
                      ▶&nbsp; Broadcast
                    </span>
                  </div>
                </Link>

                {/* SECONDARY — Join Stream */}
                <Link href="/join" className="flex-1 group">
                  <div
                    className="relative w-full py-5 sm:py-6 font-heading text-lg sm:text-xl tracking-[0.2em] uppercase text-center overflow-hidden transition-all duration-300"
                    style={{
                      background: 'rgba(0,220,255,0.06)',
                      border: '1px solid rgba(0,220,255,0.25)',
                      borderRadius: '1px',
                      color: 'rgba(0,220,255,0.7)',
                    }}
                  >
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{ background: 'rgba(0,220,255,0.12)' }}
                    />
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none"
                      style={{ boxShadow: '0 0 20px rgba(0,220,255,0.3), inset 0 0 15px rgba(0,220,255,0.08)' }}
                    />
                    <span className="relative z-10 group-hover:text-white transition-colors duration-300">
                      ⬡&nbsp; Join Stream
                    </span>
                  </div>
                </Link>
              </div>

              {/* Stats row */}
              <div
                className="grid grid-cols-3 gap-px mb-8"
                style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '1px' }}
              >
                {[
                  { label: 'Latency', value: '&lt;50ms' },
                  { label: 'Encryption', value: 'E2E' },
                  { label: 'Protocol', value: 'WebRTC' },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="flex flex-col items-center py-3 px-2"
                    style={{ background: 'rgba(5,3,15,0.9)' }}
                  >
                    <span
                      className="font-heading text-base sm:text-lg tracking-widest"
                      style={{ color: 'rgba(0,220,255,0.8)' }}
                      dangerouslySetInnerHTML={{ __html: value }}
                    />
                    <span className="font-body text-white/25 text-xs tracking-[0.15em] uppercase mt-1">{label}</span>
                  </div>
                ))}
              </div>

              {/* Bottom tagline */}
              <p className="text-center font-body text-white/20 text-xs tracking-[0.2em] uppercase">
                ⬡ &nbsp; Encrypted &nbsp;·&nbsp; Real-Time &nbsp;·&nbsp; Dimensional &nbsp; ⬡
              </p>
            </div>

            {/* Bottom accent bar */}
            <div
              style={{
                height: '1px',
                background: 'linear-gradient(90deg, transparent, rgba(0,220,255,0.4) 40%, rgba(255,0,160,0.3) 60%, transparent)',
              }}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}