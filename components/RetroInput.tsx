import React from 'react';

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export default function RetroInput({ label, error, className = '', ...props }: Props) {
  return (
    <div className={`flex flex-col mb-4 ${className}`}>
      <label className="text-brand-gray font-sans text-xs font-semibold tracking-widest mb-1.5 uppercase">
        {label}
      </label>
      <input 
        className={`w-full bg-brand-surface-2/40 border text-brand-white text-sm rounded-xl px-4 py-3 placeholder-brand-gray/40 transition-all duration-200 outline-none focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent ${error ? 'border-brand-danger text-brand-danger focus:ring-brand-danger/20 focus:border-brand-danger' : 'border-brand-border hover:border-brand-border/80'}`}
        {...props}
      />
      {error && <span className="text-brand-danger text-xs mt-1.5 font-medium">{error}</span>}
    </div>
  );
}
