'use client';

import React from 'react';
import { motion } from 'framer-motion';

export default function RetroCard({ children, className = '' }: { children: React.ReactNode, className?: string }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={`relative glass-panel p-6 group overflow-hidden border border-brand-border/40 hover:border-brand-border/80 transition-all duration-300 shadow-sm rounded-2xl bg-brand-surface-2/20 backdrop-blur-sm ${className}`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-brand-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
      <div className="relative z-10 w-full">
        {children}
      </div>
    </motion.div>
  );
}
