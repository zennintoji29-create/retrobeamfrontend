'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

export default function Home() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative overflow-hidden min-h-screen">
      {/* Outer floating spores (lightweight pure css) */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        {Array.from({ length: 25 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-pink-400/50 blur-sm animate-float-up"
            style={{
              left: `${(i * 13) % 100}%`,
              width: `${(i % 3) + 2}px`,
              height: `${(i % 3) + 2}px`,
              animationDuration: `${12 + (i % 8)}s`,
              animationDelay: `-${(i * 2.5) % 20}s`,
              bottom: '-10px',
            }}
          />
        ))}
      </div>

      <div className="z-10 w-full max-w-5xl flex flex-col items-center">
        {/* TITLE */}
        <motion.div
          initial={{ y: 30, opacity: 0, filter: 'blur(10px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 1.5, ease: 'easeOut' }}
          className="text-center mb-10 sm:mb-12 flex flex-col items-center"
        >
          <h1
            data-text="MEET.EXE"
            className="text-5xl sm:text-7xl md:text-[8rem] lg:text-[10rem] font-heading text-white mb-4 tracking-[0.15em] leading-none glitch-text"
            style={{ textShadow: '0 0 30px rgba(255,0,160,0.7), 0 0 60px rgba(255,0,160,0.4), 0 0 90px rgba(255,0,160,0.2)' }}
          >
            MEET.EXE
          </h1>
          <p className="text-sm md:text-base lg:text-lg font-body text-white/50 max-w-xl mx-auto leading-relaxed tracking-[0.1em] sm:tracking-[0.15em] uppercase px-4">
            Real-time cinematic broadcast &mdash; share your screen or sync video across the void
          </p>
        </motion.div>

        {/* HERO PANEL */}
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.7, duration: 1, ease: 'easeOut' }}
          className="w-full max-w-2xl mx-auto relative px-4 sm:px-0"
        >
          {/* Portal glow behind */}
          <div className="absolute inset-0 bg-synth-magenta/20 blur-3xl rounded-full scale-110 animate-pulse pointer-events-none" />

          {/* Card */}
          <div className="relative glass-panel p-6 sm:p-10 border border-synth-magenta/40 shadow-[0_0_60px_rgba(255,0,160,0.25)]">
            {/* Separator line */}
            <div className="flex items-center gap-4 mb-6 sm:mb-8">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent to-synth-magenta/60" />
              <span className="text-synth-magenta/90 font-heading tracking-[0.2em] sm:tracking-[0.3em] text-xs sm:text-sm uppercase">Initiate Session</span>
              <div className="flex-1 h-px bg-gradient-to-l from-transparent to-synth-magenta/60" />
            </div>

            <div className="flex flex-col sm:flex-row gap-4 sm:gap-5">
              {/* Primary CTA */}
              <Link href="/auth/login" className="flex-1 group">
                <div className="relative w-full px-6 sm:px-8 py-4 sm:py-5 font-heading text-lg sm:text-xl tracking-[0.15em] uppercase text-center rounded-lg border border-synth-magenta bg-synth-magenta/15 text-synth-magenta transition-all duration-300 hover:bg-synth-magenta hover:text-white hover:shadow-[0_0_30px_rgba(255,0,160,0.6)] overflow-hidden portal-hover">
                  <span className="relative z-10">Broadcast</span>
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.1)_0px,rgba(255,255,255,0.1)_1px,transparent_1px,transparent_4px)]" />
                </div>
              </Link>

              {/* Secondary CTA */}
              <Link href="/join" className="flex-1 group">
                <div className="relative w-full px-6 sm:px-8 py-4 sm:py-5 font-heading text-lg sm:text-xl tracking-[0.15em] uppercase text-center rounded-lg border border-white/20 bg-white/5 text-white/70 transition-all duration-300 hover:bg-white/15 hover:text-white hover:border-white/50 hover:shadow-[0_0_20px_rgba(255,255,255,0.15)] overflow-hidden">
                  <span className="relative z-10">Join Stream</span>
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.1)_0px,rgba(255,255,255,0.1)_1px,transparent_1px,transparent_4px)]" />
                </div>
              </Link>
            </div>

            {/* Bottom tagline */}
            <p className="text-center text-white/30 text-xs font-body tracking-[0.1em] sm:tracking-[0.2em] uppercase mt-6 sm:mt-8">
              ⬡ &nbsp; Encrypted &nbsp;·&nbsp; Real-Time &nbsp;·&nbsp; Dimensional &nbsp; ⬡
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
