import type { Config } from "tailwindcss";

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'brand-base': '#0A0A0B',      // Very dark minimal background
        'brand-surface': '#141415',   // Slightly lighter for cards/surfaces
        'brand-surface-2': '#1E1E20', // For hover states
        'brand-white': '#EDEDED',     // Soft white for primary text
        'brand-gray': '#919191',      // Subtext and disabled icons
        'brand-border': '#2A2A2D',    // Subtle minimal borders
        
        'brand-accent': '#6366f1',    // Indigo minimal accent
        'brand-accent-hover': '#818cf8',
        'brand-danger': '#ef4444',    // Minimal red
        'brand-success': '#10b981',   // Minimal green
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      boxShadow: {
        'glass': '0 4px 30px rgba(0, 0, 0, 0.1)',
        'premium': '0 20px 40px -15px rgba(0,0,0,0.5)',
        'glow': '0 0 20px rgba(99, 102, 241, 0.2)',
      },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(145deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
      }
    },
  },
  plugins: [],
};
export default config;
