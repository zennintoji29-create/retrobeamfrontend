'use client';

import Link from 'next/link';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';

// ─── Constants ────────────────────────────────────────────────────────────────
const TOTAL_FRAMES = 192;
const FRAME_DELAY_MS = 41;

function getFrameSrc(index: number): string {
  const n = String(index).padStart(3, '0');
  return `/sequence/frame_${n}_delay-0.041s.webp`;
}

// ─── Ambient particle — single slow-drifting orb ─────────────────────────────
function AmbientOrb({ delay, cx, cy, size, opacity }: {
  delay: number; cx: string; cy: string; size: number; opacity: number;
}) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        left: cx, top: cy,
        width: size, height: size,
        background: 'radial-gradient(circle, rgba(99,120,255,0.18) 0%, transparent 70%)',
        opacity,
        transform: 'translate(-50%, -50%)',
        filter: 'blur(40px)',
      }}
      animate={{ y: [0, -24, 0], x: [0, 12, 0] }}
      transition={{ duration: 14 + delay * 3, repeat: Infinity, ease: 'easeInOut', delay }}
    />
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────────
function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-3" style={{
      background: 'rgba(255,255,255,0.03)',
      borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.07)',
    }}>
      <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: 15, fontWeight: 600, letterSpacing: '0.04em', color: 'rgba(255,255,255,0.88)' }}>
        {value}
      </span>
      <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>
        {label}
      </span>
    </div>
  );
}

// ─── Primary CTA button ───────────────────────────────────────────────────────
function PrimaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex-1">
      <motion.div
        whileHover={{ scale: 1.012, backgroundColor: 'rgba(99,120,255,0.22)' }}
        whileTap={{ scale: 0.985 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        style={{
          padding: '14px 20px',
          borderRadius: 10,
          background: 'rgba(99,120,255,0.14)',
          border: '1px solid rgba(99,120,255,0.45)',
          color: 'rgba(180,190,255,0.95)',
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'border-color 0.2s',
        }}
      >
        {children}
      </motion.div>
    </Link>
  );
}

// ─── Secondary CTA button ─────────────────────────────────────────────────────
function SecondaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex-1">
      <motion.div
        whileHover={{ scale: 1.012, backgroundColor: 'rgba(255,255,255,0.06)' }}
        whileTap={{ scale: 0.985 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        style={{
          padding: '14px 20px',
          borderRadius: 10,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.55)',
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          textAlign: 'center',
          cursor: 'pointer',
        }}
      >
        {children}
      </motion.div>
    </Link>
  );
}

// ─── Live monitor frame display ───────────────────────────────────────────────
function LiveMonitor({ currentFrame }: { currentFrame: number }) {
  return (
    <div style={{
      position: 'relative',
      aspectRatio: '16/9',
      background: '#080808',
      overflow: 'hidden',
      borderRadius: '0 0 2px 2px',
    }}>
      <Image
        src={getFrameSrc(currentFrame)}
        alt={`frame ${currentFrame}`}
        fill
        style={{ objectFit: 'cover', opacity: 0.92 }}
        priority={currentFrame < 5}
        unoptimized
      />

      {/* Very subtle vignette — no CRT gimmick, just gentle depth */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
        background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.55) 100%)',
      }} />

      {/* REC badge — calm, minimal */}
      <div style={{
        position: 'absolute', top: 14, right: 14, zIndex: 4,
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(12,12,18,0.82)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 6,
        padding: '5px 10px',
        backdropFilter: 'blur(8px)',
      }}>
        <motion.div
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          style={{ width: 6, height: 6, borderRadius: '50%', background: '#f04060' }}
        />
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.18em' }}>
          LIVE
        </span>
      </div>

      {/* Participant avatars — calm, real-feeling */}
      <div style={{ position: 'absolute', bottom: 14, left: 14, zIndex: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex' }}>
          {['#4a6fa5', '#5a7a6a', '#7a5a6a', '#7a6a4a'].map((c, i) => (
            <div key={i} style={{
              width: 24, height: 24, borderRadius: '50%',
              background: c,
              border: '2px solid rgba(10,10,16,0.9)',
              marginLeft: i === 0 ? 0 : -8,
              opacity: 0.95,
            }} />
          ))}
        </div>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.05em' }}>
          4 participants
        </span>
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function Home() {
  const [currentFrame, setCurrentFrame] = useState(0);
  const frameRef = useRef(0);

  // Parallax mouse tracking — very subtle
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, { stiffness: 40, damping: 30 });
  const springY = useSpring(mouseY, { stiffness: 40, damping: 30 });
  const orbX = useTransform(springX, [-1, 1], [-18, 18]);
  const orbY = useTransform(springY, [-1, 1], [-12, 12]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const { innerWidth: w, innerHeight: h } = window;
    mouseX.set((e.clientX / w) * 2 - 1);
    mouseY.set((e.clientY / h) * 2 - 1);
  }, [mouseX, mouseY]);

  useEffect(() => {
    const interval = setInterval(() => {
      frameRef.current = (frameRef.current + 1) % TOTAL_FRAMES;
      setCurrentFrame(frameRef.current);
    }, FRAME_DELAY_MS);
    return () => clearInterval(interval);
  }, []);

  const progress = (currentFrame / (TOTAL_FRAMES - 1)) * 100;

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center relative overflow-hidden min-h-screen"
      onMouseMove={handleMouseMove}
      style={{ background: '#090a10' }}
    >

      {/* ── Ambient background — calm deep blue-gray orbs ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div style={{ x: orbX, y: orbY }} className="absolute inset-0">
          <AmbientOrb cx="20%" cy="30%" size={480} opacity={0.6} delay={0} />
          <AmbientOrb cx="78%" cy="65%" size={360} opacity={0.4} delay={4} />
          <AmbientOrb cx="50%" cy="85%" size={280} opacity={0.25} delay={7} />
        </motion.div>
        {/* Very subtle noise grain — adds texture without artificiality */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
          opacity: 0.35,
        }} />
      </div>

      {/* ── Page content ── */}
      <div className="z-10 w-full max-w-6xl flex flex-col items-center px-5 sm:px-8 py-12">

        {/* Logo mark */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          style={{ marginBottom: 40 }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.03)',
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3a8f5a', boxShadow: '0 0 6px #3a8f5a' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              meet.exe — online
            </span>
          </div>
        </motion.div>

        {/* ── Hero headline ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
          style={{ textAlign: 'center', marginBottom: 16 }}
        >
          <h1 style={{
            fontFamily: '"DM Sans", "SF Pro Display", system-ui, sans-serif',
            fontSize: 'clamp(2.4rem, 6.5vw, 5.5rem)',
            fontWeight: 300,
            letterSpacing: '-0.03em',
            color: 'rgba(255,255,255,0.92)',
            lineHeight: 1.08,
            margin: 0,
          }}>
            Real‑time video
            <br />
            <span style={{
              fontWeight: 600,
              background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(140,155,255,0.9) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              without the friction
            </span>
          </h1>
        </motion.div>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          style={{
            fontSize: 15,
            color: 'rgba(255,255,255,0.36)',
            letterSpacing: '0.02em',
            textAlign: 'center',
            maxWidth: 440,
            lineHeight: 1.7,
            marginBottom: 52,
            fontFamily: '"DM Sans", system-ui, sans-serif',
          }}
        >
          Broadcast live, share your screen, or sync video across the room — encrypted, peer-to-peer, no installs.
        </motion.p>

        {/* ── Two-column layout ── */}
        <div className="w-full flex flex-col lg:flex-row gap-5 items-stretch">

          {/* ── LEFT: Session card ── */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
            style={{ flexShrink: 0 }}
            className="lg:w-[340px]"
          >
            <div style={{
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16,
              overflow: 'hidden',
              height: '100%',
              backdropFilter: 'blur(12px)',
            }}>
              {/* Thin top rule */}
              <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(99,120,255,0.5) 40%, rgba(99,120,255,0.2) 70%, transparent)' }} />

              <div style={{ padding: '28px 28px 24px' }}>

                {/* Section label */}
                <div style={{ marginBottom: 24 }}>
                  <p style={{ margin: 0, fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.28)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                    Start a session
                  </p>
                </div>

                {/* CTA buttons */}
                <div className="flex gap-3 mb-6">
                  <PrimaryButton href="/auth/login">
                    ↑ &nbsp;Broadcast
                  </PrimaryButton>
                  <SecondaryButton href="/join">
                    + &nbsp;Join
                  </SecondaryButton>
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '20px 0' }} />

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2">
                  <StatChip label="Latency" value="&lt;50ms" />
                  <StatChip label="Encrypt" value="E2E" />
                  <StatChip label="Protocol" value="RTCP" />
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '20px 0' }} />

                {/* Feature list */}
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    'Screen share & camera',
                    'Mesh peer-to-peer',
                    'No account required',
                  ].map((feat) => (
                    <li key={feat} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'rgba(255,255,255,0.42)', fontFamily: '"DM Sans", system-ui, sans-serif' }}>
                      <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(99,120,255,0.6)', flexShrink: 0 }} />
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Bottom rule */}
              <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />
            </div>
          </motion.div>

          {/* ── RIGHT: Live monitor ── */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            style={{ flex: 1 }}
          >
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 16,
              overflow: 'hidden',
              height: '100%',
              backdropFilter: 'blur(12px)',
            }}>
              {/* Monitor header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 18px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <motion.div
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                    style={{ width: 7, height: 7, borderRadius: '50%', background: '#f04060' }}
                  />
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                    Live preview
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>
                    {String(currentFrame).padStart(3, '0')} / {TOTAL_FRAMES - 1}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(99,120,255,0.7)', letterSpacing: '0.1em' }}>
                    24fps
                  </span>
                </div>
              </div>

              {/* Frame display */}
              <LiveMonitor currentFrame={currentFrame} />

              {/* Progress bar */}
              <div style={{ padding: '10px 18px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{
                  width: '100%', height: 2,
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: 99,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: 'rgba(99,120,255,0.7)',
                    borderRadius: 99,
                    transition: 'width 0.04s linear',
                  }} />
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── Bottom footnote ── */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.8 }}
          style={{
            marginTop: 32,
            fontSize: 11,
            color: 'rgba(255,255,255,0.18)',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            textAlign: 'center',
            fontFamily: 'monospace',
          }}
        >
          Encrypted · WebRTC · Peer-to-peer
        </motion.p>
      </div>
    </div>
  );
}