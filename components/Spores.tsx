'use client';

import React from 'react';

// Minimal ambient background for modern aesthetic
export default function Spores() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-accent/5 via-transparent to-transparent opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-t from-brand-base via-transparent to-transparent opacity-80" />
    </div>
  );
}
