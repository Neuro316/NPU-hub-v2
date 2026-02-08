import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        np: {
          blue: '#386797',
          dark: '#3E3E3E',
          light: '#F7F8FA',
          accent: '#4A90D9',
          success: '#34A853',
          warning: '#FBBC04',
          error: '#EA4335',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
