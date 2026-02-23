import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        np: {
          blue: { DEFAULT: '#386797', dark: '#1e3a5f', hover: '#2d5a85', light: '#e8eef4' },
          dark: '#3E3E3E',
          light: '#F7F8FA',
          accent: '#4A90D9',
          success: '#34A853',
          warning: '#FBBC04',
          error: '#EA4335',
        },
        fire: { DEFAULT: '#c4704b', warm: '#b5613d', light: '#fdf0eb' },
        fog: { DEFAULT: '#a8b5c4', light: '#f0f3f7' },
        teal: { DEFAULT: '#2A9D8F', dark: '#1e7a6f', light: '#e6f5f3' },
        gold: { DEFAULT: '#d4a54a', light: '#fdf6e8' },
        surface: { DEFAULT: '#ffffff', secondary: '#f8f6f3', warm: '#f5f0eb' },
        border: { DEFAULT: '#e5e2de', light: '#f0eeeb' },
        text: { primary: '#2c2c2c', secondary: '#6b7280', muted: '#9ca3af' },
        expanding: '#2A9D8F',
        building: '#386797',
        calibrating: '#d4a54a',
        integrating: '#c4704b',
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        body: ['Outfit', 'system-ui', 'sans-serif'],
        display: ['Cormorant Garamond', 'Georgia', 'serif'],
        heading: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        card: '14px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08)',
      },
      keyframes: {
        breath: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' },
        },
      },
      animation: {
        breath: 'breath 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

export default config
