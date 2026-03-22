'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function Navbar({ user, logout }: { user?: any, logout?: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="border-b border-white/10 bg-synth-void/80 backdrop-blur-xl px-4 py-3 sticky top-0 z-40">
      <div className="max-w-[1600px] mx-auto flex justify-between items-center">
        <Link
          href="/"
          className="font-heading text-2xl sm:text-3xl lg:text-4xl text-white tracking-[0.15em] flex items-center gap-1 hover:text-synth-cyan transition-colors"
        >
          RETRO<span className="text-synth-red">BEAM</span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden sm:flex items-center gap-4 lg:gap-6 font-body text-base">
          {user ? (
            <>
              <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/10">
                <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-synth-red to-synth-cyan flex items-center justify-center shadow-[0_0_10px_rgba(229,9,20,0.5)]">
                  <span className="text-xs text-white font-bold">{user.username.charAt(0).toUpperCase()}</span>
                </div>
                <span className="text-white text-sm font-medium tracking-wide hidden md:block">{user.username}</span>
              </div>
              <Link href="/dashboard" className="text-synth-cyan hover:text-white transition-colors uppercase tracking-widest font-bold text-sm">
                Dashboard
              </Link>
              <button onClick={logout} className="text-synth-red hover:text-white transition-colors uppercase tracking-widest font-bold text-sm">
                Abort
              </button>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="text-white hover:text-synth-cyan transition-colors uppercase tracking-widest font-bold text-sm px-4">
                Login
              </Link>
              <Link href="/auth/register" className="bg-synth-red text-white px-5 py-2 rounded uppercase tracking-widest font-bold text-sm shadow-[0_0_15px_rgba(229,9,20,0.4)] hover:bg-white hover:text-synth-red transition-all">
                Register
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden text-white w-9 h-9 flex items-center justify-center border border-white/20 rounded hover:bg-white/10 transition-colors"
          onClick={() => setMenuOpen(v => !v)}
          aria-label="Menu"
        >
          <span className="text-xl">{menuOpen ? '✕' : '☰'}</span>
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="sm:hidden mt-2 border-t border-white/10 pt-3 pb-2 flex flex-col gap-3 px-1">
          {user ? (
            <>
              <div className="flex items-center gap-2 px-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-synth-red to-synth-cyan flex items-center justify-center">
                  <span className="text-xs text-white font-bold">{user.username.charAt(0).toUpperCase()}</span>
                </div>
                <span className="text-white text-sm font-medium">{user.username}</span>
              </div>
              <Link href="/dashboard" onClick={() => setMenuOpen(false)} className="text-synth-cyan uppercase tracking-widest font-bold text-sm px-2 py-1">
                Dashboard
              </Link>
              <button onClick={() => { setMenuOpen(false); logout?.(); }} className="text-synth-red uppercase tracking-widest font-bold text-sm px-2 py-1 text-left">
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link href="/auth/login" onClick={() => setMenuOpen(false)} className="text-white uppercase tracking-widest font-bold text-sm px-2 py-1">
                Login
              </Link>
              <Link href="/auth/register" onClick={() => setMenuOpen(false)} className="bg-synth-red text-white px-4 py-2 uppercase tracking-widest font-bold text-sm text-center rounded">
                Register
              </Link>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
