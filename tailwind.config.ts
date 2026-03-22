import type { Config } from "tailwindcss";

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'synth-red': '#E50914', // Netflix/Stranger Things Red
        'synth-cyan': '#00F0FF', // Cyberpunk glow
        'synth-purple': '#4D0A66', // Deep purple
        'synth-magenta': '#FF00A0', // High pink
        'synth-void': '#050117', // Very dark space background
        'synth-card': 'rgba(15, 10, 40, 0.4)', // Glassmorphism dark
        'synth-dim': '#8b9bb4', // Soft cinematic text
      },
      fontFamily: {
        heading: ['var(--font-heading)', 'sans-serif'], // Bebas Neue
        body: ['var(--font-body)', 'sans-serif'],       // Outfit
      },
      animation: {
        flicker: 'flicker 8s infinite',
        glitch: 'glitch 0.3s steps(2) infinite',
        blink: 'blink 1.5s step-end infinite',
        'pulse-glow': 'pulse-glow 3s ease-in-out infinite',
        'grid-move': 'gridMove 10s linear infinite',
        'float-up': 'floatUp linear infinite',
        'lightning': 'lightning 10s infinite',
      },
      keyframes: {
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.97' },
          '75%': { opacity: '0.99' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        glitch: {
          '0%': { clipPath: 'inset(10% 0 10% 0)' },
          '50%': { clipPath: 'inset(80% 0 5% 0)' },
          '100%': { clipPath: 'inset(30% 0 30% 0)' },
        },
        'pulse-glow': {
          '0%, 100%': {
            boxShadow: '0 0 15px rgba(229, 9, 20, 0.2), inset 0 0 10px rgba(229, 9, 20, 0.1)',
          },
          '50%': {
            boxShadow: '0 0 25px rgba(229, 9, 20, 0.5), inset 0 0 15px rgba(229, 9, 20, 0.2)',
          },
        },
        gridMove: {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '0 40px' },
        },
        floatUp: {
          '0%': { transform: 'translateY(100vh) translateX(0)', opacity: '0' },
          '10%': { opacity: 'var(--tw-opacity)' },
          '90%': { opacity: 'var(--tw-opacity)' },
          '100%': { transform: 'translateY(-20vh) translateX(20px)', opacity: '0' },
        },
        lightning: {
          '0%, 95%, 98%, 100%': { opacity: '0' },
          '96%': { opacity: '0.8' },
          '97%': { opacity: '0' },
          '99%': { opacity: '0.4' },
        },
        'glitch-shift-a': {
          '0%, 80%, 100%': { transform: 'translate(0)', clipPath: 'polygon(0 0, 100% 0, 100% 45%, 0 45%)' },
          '82%': { transform: 'translate(-6px, 1px)', clipPath: 'polygon(0 0, 100% 0, 100% 40%, 0 40%)' },
          '84%': { transform: 'translate(4px, -1px)', clipPath: 'polygon(0 5%, 100% 5%, 100% 48%, 0 48%)' },
          '86%': { transform: 'translate(0)' },
        },
        'glitch-shift-b': {
          '0%, 85%, 100%': { transform: 'translate(0)', clipPath: 'polygon(0 60%, 100% 60%, 100% 100%, 0 100%)' },
          '87%': { transform: 'translate(5px, 2px)', clipPath: 'polygon(0 55%, 100% 55%, 100% 100%, 0 100%)' },
          '89%': { transform: 'translate(-3px, -2px)', clipPath: 'polygon(0 62%, 100% 62%, 100% 100%, 0 100%)' },
          '91%': { transform: 'translate(0)' },
        }
      },
      boxShadow: {
        'neon-red': '0 0 15px rgba(229, 9, 20, 0.5), 0 0 }30px rgba(229, 9, 20, 0.3)',
        'neon-cyan': '0 0 15px rgba(0, 240, 255, 0.5), 0 0 30px rgba(0, 240, 255, 0.3)',
        'neon-magenta': '0 0 15px rgba(255, 0, 160, 0.5), 0 0 30px rgba(255, 0, 160, 0.3)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
    },
  },
  plugins: [],
};
export default config;
