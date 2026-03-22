import type { Metadata } from 'next';
import { Outfit, Bebas_Neue } from 'next/font/google';
import './globals.css';
import CRTOverlay from '@/components/CRTOverlay';
import AnimatedBackground from '@/components/AnimatedBackground';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-body',
});

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-heading',
});

export const metadata: Metadata = {
  title: 'RetroBeam | Cinematic',
  description: 'Real-Time Cinematic Screen-Sharing & Broadcasting.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${outfit.variable} ${bebasNeue.variable}`}>
      <body className="antialiased min-h-[100dvh] relative font-body text-white overflow-x-hidden bg-black">
        <AnimatedBackground />
        
        {/* Content sits above canvas (z-0) and fog (z-[1]) */}
        <div className="relative z-[2] flex flex-col min-h-[100dvh]">
          {children}
        </div>
        
        {/* Fog & lightning — between canvas and content */}
        <div className="fixed inset-0 z-[1] pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-black/50"></div>
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70"></div>
          <div className="absolute inset-0 bg-red-600 animate-lightning mix-blend-color opacity-0"></div>
        </div>

        <CRTOverlay />
      </body>
    </html>
  );
}
