'use client';

import React, { useEffect, useState } from 'react';

export default function Spores() {
  const [spores, setSpores] = useState<any[]>([]);

  useEffect(() => {
    // Generate random spores
    const newSpores = Array.from({ length: 60 }).map((_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      animationDuration: `${Math.random() * 15 + 10}s`, // slow floating
      animationDelay: `-${Math.random() * 20}s`,
      opacity: Math.random() * 0.5 + 0.2,
      size: `${Math.random() * 4 + 2}px`,
    }));
    setSpores(newSpores);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {spores.map(spore => (
        <div
          key={spore.id}
          className="absolute rounded-full bg-white blur-[1px] mix-blend-screen animate-float-up"
          style={{
            left: spore.left,
            width: spore.size,
            height: spore.size,
            opacity: spore.opacity,
            animationDuration: spore.animationDuration,
            animationDelay: spore.animationDelay,
            bottom: '-10px',
          }}
        />
      ))}
      
      {/* Background fog overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0000] via-transparent to-transparent opacity-80" />
      <div className="absolute inset-0 bg-[url('/bg-tendrils.png')] bg-cover bg-center bg-no-repeat opacity-60 mix-blend-screen" />

      {/* Lightning Flashes */}
      <div className="absolute inset-0 bg-red-600 animate-lightning mix-blend-color opacity-0 pointer-events-none" />
    </div>
  );
}
