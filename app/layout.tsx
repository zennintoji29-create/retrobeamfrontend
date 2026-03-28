import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'meet.exe - Cinematic Video Calls',
  description: 'Real-Time Minimal Screen-Sharing & Broadcasting.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable}`}>
      <body className="antialiased min-h-[100dvh] relative font-sans text-brand-white bg-brand-base overflow-x-hidden custom-scrollbar">
        {children}
      </body>
    </html>
  );
}
