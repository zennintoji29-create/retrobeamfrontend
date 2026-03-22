'use client';

import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

interface Props extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children?: React.ReactNode;
  variant?: 'primary' | 'danger' | 'ghost';
  fullWidth?: boolean;
}

export default function RetroButton({ variant = 'primary', fullWidth, className = '', children, ...props }: Props) {
  const baseClasses = 'relative font-heading text-2xl uppercase tracking-[0.1em] px-8 py-4 transition-all duration-300 font-bold overflow-hidden rounded-md';
  
  let variantClasses = '';
  switch (variant) {
    case 'primary':
      variantClasses = 'bg-synth-cyan/10 text-synth-cyan border border-synth-cyan/50 shadow-[0_0_15px_rgba(0,240,255,0.2)] hover:bg-synth-cyan hover:text-synth-void hover:shadow-neon-cyan disabled:opacity-50 disabled:hover:bg-synth-cyan/10 disabled:hover:text-synth-cyan portal-hover';
      break;
    case 'danger':
      variantClasses = 'bg-synth-red/10 text-synth-red border border-synth-red/50 shadow-[0_0_15px_rgba(229,9,20,0.2)] hover:bg-synth-red hover:text-white hover:shadow-neon-red disabled:opacity-50 portal-hover';
      break;
    case 'ghost':
      variantClasses = 'bg-transparent border border-synth-dim/40 text-synth-dim hover:text-white hover:border-white hover:shadow-[0_0_10px_rgba(255,255,255,0.2)] disabled:opacity-50';
      break;
  }

  const widthClass = fullWidth ? 'w-full' : '';

  return (
    <motion.button 
      whileHover={{ scale: 1.02, textShadow: "0px 0px 8px rgb(255,255,255)" }}
      whileTap={{ scale: 0.98 }}
      className={`${baseClasses} ${variantClasses} ${widthClass} ${className} group`}
      {...props}
    >
      <span className="relative z-10 drop-shadow-md">{children}</span>
      {/* Button inner glow effect on hover */}
      <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
    </motion.button>
  );
}
