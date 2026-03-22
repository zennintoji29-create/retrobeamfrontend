'use client';

import React, { useState, useEffect } from 'react';

interface Props {
  lines: string[];
  onComplete?: () => void;
  speed?: number;
}

export default function BootText({ lines, onComplete, speed = 40 }: Props) {
  const [visibleLines, setVisibleLines] = useState<string[]>([]);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);

  useEffect(() => {
    if (currentLineIndex >= lines.length) {
      if (onComplete) onComplete();
      return;
    }

    const currentFullLine = lines[currentLineIndex];

    if (currentCharIndex < currentFullLine.length) {
      const timeout = setTimeout(() => {
        setCurrentCharIndex(prev => prev + 1);
      }, speed);
      return () => clearTimeout(timeout);
    } else {
      const timeout = setTimeout(() => {
        setVisibleLines(prev => [...prev, currentFullLine]);
        setCurrentLineIndex(prev => prev + 1);
        setCurrentCharIndex(0);
      }, 500); // pause between lines
      return () => clearTimeout(timeout);
    }
  }, [currentLineIndex, currentCharIndex, lines, speed, onComplete]);

  return (
    <div className="font-mono text-retro-green text-lg md:text-2xl flex flex-col items-start glow-text">
      {visibleLines.map((line, i) => (
        <div key={i} className="mb-2 whitespace-pre-wrap">{line}</div>
      ))}
      
      {currentLineIndex < lines.length && (
        <div className="flex mb-2 whitespace-pre-wrap">
          {lines[currentLineIndex].substring(0, currentCharIndex)}
          <span className="w-3 bg-retro-green animate-blink inline-block ml-1">&nbsp;</span>
        </div>
      )}
      
      {currentLineIndex >= lines.length && (
        <div className="flex mb-2">
          <span className="w-3 bg-retro-green animate-blink inline-block">&nbsp;</span>
        </div>
      )}
    </div>
  );
}
