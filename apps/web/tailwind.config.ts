import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#EE4D2D',
          50: '#fff4f2',
          100: '#ffe8e3',
          200: '#ffcfc7',
          300: '#ffaa99',
          400: '#ff7a5c',
          500: '#EE4D2D',
          600: '#d94326',
          700: '#b8361e',
          800: '#8f2815',
          900: '#6b1d0e',
        },
        secondary: {
          DEFAULT: '#FF6633',
          500: '#FF6633',
        },
      },
      fontFamily: {
        sans: ['Be Vietnam Pro', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'flash-pulse': 'flashPulse 1.2s ease-in-out infinite',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        float: 'float 3s ease-in-out infinite',
        'fade-up': 'fadeUp 0.5s ease-out',
        'slide-in': 'slideIn 0.4s ease-out',
        shimmer: 'shimmer 1.5s infinite',
      },
      keyframes: {
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        flashPulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
