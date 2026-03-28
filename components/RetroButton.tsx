'use client';

import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

interface Props extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children?: React.ReactNode;
  variant?: 'primary' | 'danger' | 'ghost';
  fullWidth?: boolean;
}

export default function RetroButton({ variant = 'primary', fullWidth, className = '', children, ...props }: Props) {
  const baseClasses = 'relative font-sans text-sm font-semibold rounded-xl px-5 py-2.5 transition-all duration-200 overflow-hidden flex items-center justify-center gap-2';
  
  let variantClasses = '';
  switch (variant) {
    case 'primary':
      variantClasses = 'bg-brand-white text-brand-base hover:bg-white border border-transparent shadow-[0_1px_3px_rgba(0,0,0,0.5)] disabled:opacity-50 disabled:hover:bg-brand-white';
      break;
    case 'danger':
      variantClasses = 'bg-brand-danger text-white hover:bg-red-600 border border-transparent shadow-sm disabled:opacity-50';
      break;
    case 'ghost':
      variantClasses = 'bg-brand-surface-2/40 border border-brand-border text-brand-white hover:bg-brand-surface-2 hover:border-brand-border/80 shadow-sm disabled:opacity-50';
      break;
  }

  const widthClass = fullWidth ? 'w-full' : '';

  return (
    <motion.button 
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.98 }}
      className={`${baseClasses} ${variantClasses} ${widthClass} ${className}`}
      {...props}
    >
      <span className="relative z-10">{children}</span>
    </motion.button>
  );
}
