'use client';

import React from 'react';
import { motion } from 'framer-motion';

export default function RetroCard({ children, className = '' }: { children: React.ReactNode, className?: string }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`relative glass-panel p-8 group overflow-hidden border-synth-red/20 hover:border-synth-red/50 transition-colors duration-500 shadow-glass crack-bg ${className}`}
    >
      {/* Background flare on hover */}
      <div className="absolute -inset-4 bg-gradient-to-tr from-synth-red/0 via-synth-red/10 to-synth-cyan/0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 blur-2xl pointer-events-none"></div>
      
      {/* Subtle border highlight */}
      <div className="absolute inset-0 border border-white/5 rounded-xl pointer-events-none"></div>
      
      <div className="relative z-10">
        {children}
      </div>
    </motion.div>
  );
}
