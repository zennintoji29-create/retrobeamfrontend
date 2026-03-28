'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';

export default function Navbar({ user, logout }: { user?: any, logout?: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="border-b border-brand-border/40 bg-brand-base/80 backdrop-blur-xl px-4 py-3 sticky top-0 z-40">
      <div className="max-w-[1600px] mx-auto flex justify-between items-center">
        <Link
          href="/"
          className="flex items-baseline gap-1.5 transition-colors group"
        >
          <span className="font-sans text-xl font-bold tracking-tight text-white group-hover:text-brand-white">meet</span>
          <span className="font-sans text-sm font-semibold tracking-wide text-brand-gray group-hover:text-brand-gray/80">.exe</span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden sm:flex items-center gap-4 lg:gap-6 font-sans text-sm">
          {user ? (
            <>
              <div className="flex items-center gap-2 bg-brand-surface-2/40 px-3 py-1.5 rounded-full border border-brand-border/40">
                <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-brand-accent to-brand-accent-hover flex items-center justify-center">
                  <span className="text-[10px] text-white font-bold">{user.username.charAt(0).toUpperCase()}</span>
                </div>
                <span className="text-brand-white text-xs font-semibold tracking-wide hidden md:block">{user.username}</span>
              </div>
              <Link href="/dashboard" className="text-brand-gray hover:text-brand-white transition-colors font-semibold text-xs tracking-wide">
                Dashboard
              </Link>
              <button onClick={logout} className="text-brand-danger/80 hover:text-brand-danger transition-colors font-semibold text-xs tracking-wide">
                Logout
              </button>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="text-brand-gray hover:text-brand-white transition-colors font-semibold tracking-wide text-xs px-4">
                Login
              </Link>
              <Link href="/auth/register" className="bg-brand-white text-brand-base px-4 py-2.5 rounded-xl font-semibold text-xs tracking-wide shadow-sm hover:bg-white hover:scale-105 transition-all">
                Register
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden text-brand-gray w-9 h-9 flex items-center justify-center border border-brand-border/50 rounded-lg hover:bg-brand-surface transition-colors"
          onClick={() => setMenuOpen(v => !v)}
          aria-label="Menu"
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="sm:hidden mt-3 border-t border-brand-border/40 pt-3 pb-2 flex flex-col gap-3 px-1">
          {user ? (
            <>
              <div className="flex items-center gap-2 px-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-brand-accent to-brand-accent-hover flex items-center justify-center">
                  <span className="text-xs text-white font-bold">{user.username.charAt(0).toUpperCase()}</span>
                </div>
                <span className="text-brand-white text-sm font-medium">{user.username}</span>
              </div>
              <Link href="/dashboard" onClick={() => setMenuOpen(false)} className="text-brand-gray hover:text-brand-white font-semibold text-sm px-2 py-1">
                Dashboard
              </Link>
              <button onClick={() => { setMenuOpen(false); logout?.(); }} className="text-brand-danger hover:text-red-500 font-semibold text-sm px-2 py-1 text-left">
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link href="/auth/login" onClick={() => setMenuOpen(false)} className="text-brand-gray hover:text-brand-white font-semibold text-sm px-2 py-1">
                Login
              </Link>
              <Link href="/auth/register" onClick={() => setMenuOpen(false)} className="bg-brand-white text-brand-base px-4 py-2 font-semibold text-sm text-center rounded-xl">
                Register
              </Link>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
