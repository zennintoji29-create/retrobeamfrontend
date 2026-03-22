import React from 'react';

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export default function RetroInput({ label, error, className = '', ...props }: Props) {
  return (
    <div className={`flex flex-col mb-5 ${className}`}>
      <label className="text-synth-cyan font-heading text-lg tracking-widest mb-2 uppercase drop-shadow-[0_0_5px_rgba(0,240,255,0.5)]">
        {label}
      </label>
      <input 
        className={`glass-input font-body p-4 text-lg w-full placeholder-synth-dim/50 transition-all duration-300 ${error ? 'border-synth-red text-synth-red shadow-[0_0_10px_rgba(229,9,20,0.3)] focus:border-synth-red focus:ring-synth-red' : ''}`}
        {...props}
      />
      {error && <span className="text-synth-red text-sm mt-2 font-body font-bold animate-pulse drop-shadow-md">{error}</span>}
    </div>
  );
}
