'use client';

import Link from 'next/link';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';

const TOTAL_FRAMES = 192;
const FRAME_DELAY_MS = 41;

function getFrameSrc(index: number): string {
  const n = String(index).padStart(3, '0');
  return `/sequence/frame_${n}_delay-0.041s.webp`;
}

// ── Magnetic pull button ──────────────────────────────────────────────────────
function Magnetic({ children, strength = 0.28 }: { children: React.ReactElement; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 22 });
  const sy = useSpring(y, { stiffness: 220, damping: 22 });

  const onMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - r.left - r.width / 2) * strength);
    y.set((e.clientY - r.top - r.height / 2) * strength);
  };

  return (
    <motion.div ref={ref} style={{ x: sx, y: sy, display: 'inline-block' }}
      onMouseMove={onMove} onMouseLeave={() => { x.set(0); y.set(0); }}>
      {children}
    </motion.div>
  );
}

// ── Stat card under monitor ───────────────────────────────────────────────────
function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      flex: 1, padding: '8px 12px', borderRadius: 8,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.01em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em', color: 'rgba(74,222,128,0.9)' }}>{value}</span>
    </div>
  );
}

// ── Control chip in monitor bar ───────────────────────────────────────────────
function ControlChip({ label, active, icon }: { label: string; active?: boolean; icon: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
      background: active ? 'rgba(99,102,241,0.14)' : 'rgba(255,255,255,0.06)',
      border: `1px solid ${active ? 'rgba(99,102,241,0.35)' : 'transparent'}`,
    }}>
      {icon}
      <span style={{
        fontSize: 11, fontWeight: active ? 500 : 400,
        color: active ? 'rgba(129,140,248,0.95)' : 'rgba(255,255,255,0.42)',
      }}>{label}</span>
    </div>
  );
}

export default function Home() {
  const [currentFrame, setCurrentFrame] = useState(0);
  const frameRef = useRef(0);
  const monitorRef = useRef<HTMLDivElement>(null);

  const rotX = useMotionValue(0);
  const rotY = useMotionValue(0);
  const sRX = useSpring(rotX, { stiffness: 55, damping: 18 });
  const sRY = useSpring(rotY, { stiffness: 55, damping: 18 });

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!monitorRef.current) return;
    const r = monitorRef.current.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    rotX.set(ny * -7);
    rotY.set(nx * 7);
  }, [rotX, rotY]);

  useEffect(() => {
    const id = setInterval(() => {
      frameRef.current = (frameRef.current + 1) % TOTAL_FRAMES;
      setCurrentFrame(frameRef.current);
    }, FRAME_DELAY_MS);
    return () => clearInterval(id);
  }, []);

  const pct = (currentFrame / (TOTAL_FRAMES - 1)) * 100;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0b0b0d',
      display: 'flex', flexDirection: 'column',
      fontFamily: '"Geist", "SF Pro Display", ui-sans-serif, system-ui, sans-serif',
      position: 'relative', overflow: 'hidden',
    }}>

      {/* ── Background geometry — one large diffuse light source ── */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {/* Main light bloom */}
        <div style={{
          position: 'absolute', top: '-10%', right: '-5%',
          width: '55%', height: '70%',
          background: 'radial-gradient(ellipse at 70% 30%, rgba(255,255,255,0.032) 0%, transparent 65%)',
          filter: 'blur(1px)',
        }} />
        {/* Warm accent bottom-left */}
        <div style={{
          position: 'absolute', bottom: '-5%', left: '-5%',
          width: '40%', height: '50%',
          background: 'radial-gradient(ellipse at 20% 80%, rgba(251,146,60,0.038) 0%, transparent 60%)',
        }} />
        {/* Ultra-subtle grid */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: [
            'linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px)',
            'linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px)',
          ].join(','),
          backgroundSize: '72px 72px',
          maskImage: 'radial-gradient(ellipse 100% 100% at 50% 0%, black 20%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse 100% 100% at 50% 0%, black 20%, transparent 80%)',
        }} />
      </div>

      {/* ══════════════ NAV ══════════════════════════════════════════════════ */}
      <motion.nav
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 40px',
          borderBottom: '1px solid rgba(255,255,255,0.055)',
          position: 'relative', zIndex: 10,
        }}
      >
        {/* Wordmark */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.04em', color: '#fff' }}>meet</span>
          <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: '-0.01em', color: 'rgba(255,255,255,0.28)' }}>.exe</span>
        </div>

        {/* Nav right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#4ade80',
              boxShadow: '0 0 0 3px rgba(74,222,128,0.18)',
            }} />
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', letterSpacing: '-0.01em' }}>
              Systems online
            </span>
          </div>
          <Link href="/auth/login">
            <span style={{
              fontSize: 13, fontWeight: 500,
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer', letterSpacing: '-0.01em',
            }}>
              Sign in
            </span>
          </Link>
        </div>
      </motion.nav>

      {/* ══════════════ HERO ═════════════════════════════════════════════════ */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center',
        padding: '60px 40px',
        maxWidth: 1120, width: '100%', margin: '0 auto',
        gap: 64,
      }}
      className="flex-col lg:flex-row"
      >

        {/* ─── Left: copy ──────────────────────────────────────────────────── */}
        <div style={{ flex: '0 0 auto', maxWidth: 480 }}>

          {/* Beta badge */}
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '5px 12px 5px 7px',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 99, marginBottom: 32,
              background: 'rgba(255,255,255,0.04)',
            }}
          >
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              padding: '2px 7px', borderRadius: 99,
              background: 'rgba(251,146,60,0.18)', color: 'rgba(251,146,60,0.9)',
            }}>Beta</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: '-0.01em' }}>
              Open · Encrypted · Zero installs
            </span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
            style={{
              margin: '0 0 18px',
              fontSize: 'clamp(2.5rem, 5vw, 4rem)',
              fontWeight: 700,
              letterSpacing: '-0.045em',
              lineHeight: 1.03,
              color: 'rgba(255,255,255,0.94)',
            }}
          >
            Video calls<br />
            <span style={{ color: 'rgba(255,255,255,0.24)', fontWeight: 350 }}>that stay out</span><br />
            of your way.
          </motion.h1>

          {/* Sub */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.55, delay: 0.3 }}
            style={{
              margin: '0 0 38px',
              fontSize: 15, lineHeight: 1.68,
              color: 'rgba(255,255,255,0.36)',
              letterSpacing: '-0.008em',
              maxWidth: 390,
            }}
          >
            Open a room instantly. Broadcast live, share your screen, or sync video with anyone — peer-to-peer, no accounts needed.
          </motion.p>

          {/* CTA buttons */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.38 }}
            style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
          >
            {/* Primary */}
            <Magnetic>
              <Link href="/auth/login">
                <motion.button
                  whileHover={{ scale: 1.018 }}
                  whileTap={{ scale: 0.962 }}
                  style={{
                    padding: '13px 26px',
                    borderRadius: 10, border: 'none',
                    background: '#ffffff',
                    color: '#0b0b0d',
                    fontSize: 14, fontWeight: 650,
                    letterSpacing: '-0.02em',
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', gap: 9,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                  }}
                >
                  {/* Live dot */}
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    <span style={{
                      display: 'block', width: 7, height: 7, borderRadius: '50%', background: '#ef4444',
                    }} />
                    <motion.span
                      animate={{ scale: [1, 1.9, 1], opacity: [0.7, 0, 0.7] }}
                      transition={{ duration: 1.8, repeat: Infinity }}
                      style={{
                        position: 'absolute', inset: 0, borderRadius: '50%',
                        background: '#ef4444',
                      }}
                    />
                  </span>
                  Start broadcasting
                </motion.button>
              </Link>
            </Magnetic>

            {/* Secondary */}
            <Magnetic>
              <Link href="/join">
                <motion.button
                  whileHover={{ borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(255,255,255,0.08)' }}
                  whileTap={{ scale: 0.962 }}
                  style={{
                    padding: '13px 22px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.05)',
                    color: 'rgba(255,255,255,0.68)',
                    fontSize: 14, fontWeight: 500,
                    letterSpacing: '-0.015em',
                    cursor: 'pointer', fontFamily: 'inherit',
                    backdropFilter: 'blur(6px)',
                  }}
                >
                  Join a room →
                </motion.button>
              </Link>
            </Magnetic>
          </motion.div>

          {/* Social proof */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.58, duration: 0.5 }}
            style={{
              marginTop: 42, paddingTop: 26,
              borderTop: '1px solid rgba(255,255,255,0.07)',
              display: 'flex', alignItems: 'center', gap: 14,
            }}
          >
            <div style={{ display: 'flex' }}>
              {['#818cf8','#f59e0b','#4ade80','#f43f5e'].map((c, i) => (
                <div key={i} style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: c, opacity: 0.88,
                  border: '2px solid #0b0b0d',
                  marginLeft: i ? -9 : 0,
                }} />
              ))}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.28)', letterSpacing: '-0.01em' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>2,400+</span> rooms opened this week
            </p>
          </motion.div>
        </div>

        {/* ─── Right: Live monitor ──────────────────────────────────────────── */}
        <motion.div
          ref={monitorRef}
          onMouseMove={onMouseMove}
          onMouseLeave={() => { rotX.set(0); rotY.set(0); }}
          initial={{ opacity: 0, scale: 0.93, y: 18 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
          style={{ flex: 1, minWidth: 0, perspective: 900 }}
        >
          <motion.div style={{ rotateX: sRX, rotateY: sRY, transformStyle: 'preserve-3d' }}>

            {/* Monitor shell */}
            <div style={{
              borderRadius: 14,
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.1)',
              background: '#111115',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.04), 0 40px 90px rgba(0,0,0,0.65), 0 8px 24px rgba(0,0,0,0.45)',
            }}>

              {/* Chrome bar */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(255,255,255,0.02)',
              }}>
                {/* Traffic lights */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {['#ff5f57','#ffbd2e','#27c840'].map(c => (
                    <div key={c} style={{ width: 11, height: 11, borderRadius: '50%', background: c, opacity: 0.9 }} />
                  ))}
                </div>

                {/* URL pill */}
                <div style={{
                  flex: 1, maxWidth: 220,
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', borderRadius: 6,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}>
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                    <rect x="1.5" y="3" width="7" height="6" rx="1" stroke="rgba(255,255,255,0.25)" strokeWidth="1.2" />
                    <path d="M3.5 3V2a1.5 1.5 0 013 0v1" stroke="rgba(255,255,255,0.25)" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', letterSpacing: '0.01em' }}>
                    meet.exe / room / xk7m2
                  </span>
                </div>

                {/* Live badge */}
                <motion.div
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.7, repeat: Infinity, ease: 'easeInOut' }}
                  style={{
                    marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
                    padding: '3px 9px', borderRadius: 5,
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.2)',
                  }}
                >
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#ef4444' }} />
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(239,68,68,0.9)' }}>LIVE</span>
                </motion.div>
              </div>

              {/* Video */}
              <div style={{ position: 'relative', aspectRatio: '16/9', background: '#000', overflow: 'hidden' }}>
                <Image
                  src={getFrameSrc(currentFrame)}
                  alt=""
                  fill
                  style={{ objectFit: 'cover' }}
                  priority={currentFrame < 5}
                  unoptimized
                />
                {/* Vignette */}
                <div style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none',
                  background: 'radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,0.5) 100%)',
                }} />

                {/* Bottom HUD */}
                <div style={{
                  position: 'absolute', bottom: 14, left: 14,
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 12px', borderRadius: 8,
                  background: 'rgba(11,11,13,0.72)',
                  border: '1px solid rgba(255,255,255,0.09)',
                  backdropFilter: 'blur(12px)',
                }}>
                  <div style={{ display: 'flex' }}>
                    {['#818cf8','#f59e0b','#4ade80','#f43f5e'].map((c, i) => (
                      <div key={i} style={{
                        width: 20, height: 20, borderRadius: '50%', background: c,
                        border: '1.5px solid rgba(11,11,13,0.9)',
                        marginLeft: i ? -7 : 0,
                      }} />
                    ))}
                  </div>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>4 in call</span>
                </div>

                <div style={{
                  position: 'absolute', bottom: 15, right: 14,
                  fontFamily: 'monospace', fontSize: 10,
                  color: 'rgba(255,255,255,0.2)', letterSpacing: '0.04em',
                }}>
                  {String(currentFrame).padStart(3, '0')} / {TOTAL_FRAMES - 1}
                </div>
              </div>

              {/* Controls bar */}
              <div style={{
                padding: '10px 14px 13px',
                background: '#0e0e11',
                display: 'flex', flexDirection: 'column', gap: 9,
              }}>
                {/* Scrubber */}
                <div style={{ position: 'relative', height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 99 }}>
                  <div style={{
                    position: 'absolute', top: 0, left: 0, bottom: 0,
                    width: `${pct}%`,
                    background: 'rgba(255,255,255,0.85)',
                    borderRadius: 99,
                    transition: 'width 0.04s linear',
                  }} />
                  <div style={{
                    position: 'absolute', top: '50%',
                    left: `${pct}%`,
                    transform: 'translate(-50%, -50%)',
                    width: 9, height: 9, borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 0 0 2px rgba(255,255,255,0.18)',
                  }} />
                </div>

                {/* Icon row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ControlChip label="Mic" icon={
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <rect x="4" y="1" width="4" height="7" rx="2" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
                      <path d="M2 6.5A4 4 0 0010 6.5M6 10.5v-1" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  } />
                  <ControlChip label="Camera" icon={
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <rect x="1" y="3" width="7" height="6" rx="1.5" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
                      <path d="M8 5l3-2v6l-3-2" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" strokeLinejoin="round" />
                    </svg>
                  } />
                  <ControlChip active label="Sharing" icon={
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <rect x="1" y="1" width="10" height="8" rx="1.5" stroke="rgba(129,140,248,0.9)" strokeWidth="1.2" />
                      <path d="M4 11h4M6 9v2" stroke="rgba(129,140,248,0.9)" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  } />
                  <div style={{ marginLeft: 'auto' }}>
                    <div style={{
                      padding: '4px 12px', borderRadius: 6,
                      background: 'rgba(239,68,68,0.1)',
                      border: '1px solid rgba(239,68,68,0.18)',
                      fontSize: 11, fontWeight: 500,
                      color: 'rgba(239,68,68,0.8)', cursor: 'pointer',
                    }}>
                      Leave
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats row beneath monitor */}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <StatPill label="Latency" value="34ms" />
              <StatPill label="Packet loss" value="0.0%" />
              <StatPill label="Quality" value="1080p" />
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* ══ Footer ══════════════════════════════════════════════════════════ */}
      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.85, duration: 0.5 }}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 40px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          position: 'relative', zIndex: 10,
        }}
      >
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.18)', letterSpacing: '-0.01em' }}>
          © 2025 meet.exe
        </span>
        <div style={{ display: 'flex', gap: 24 }}>
          {['Privacy', 'Terms', 'GitHub'].map(t => (
            <span key={t} style={{
              fontSize: 12, color: 'rgba(255,255,255,0.22)',
              cursor: 'pointer', letterSpacing: '-0.01em',
              transition: 'color 0.15s',
            }}
              onMouseEnter={e => { (e.target as HTMLElement).style.color = 'rgba(255,255,255,0.55)'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color = 'rgba(255,255,255,0.22)'; }}
            >
              {t}
            </span>
          ))}
        </div>
      </motion.footer>
    </div>
  );
}