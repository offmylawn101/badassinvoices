/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: "#FFD700",
          dark: "#B8860B",
        },
        lucky: {
          red: "#DC2626",
          green: "#22C55E",
        },
        casino: {
          black: "#0F0F0F",
          dark: "#1A1A2E",
        },
      },
      animation: {
        'spin-wheel': 'spin-wheel 2s ease-out',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
      },
      keyframes: {
        'spin-wheel': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(1080deg)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(255, 215, 0, 0.5)' },
          '50%': { boxShadow: '0 0 40px rgba(255, 215, 0, 0.8)' },
        },
      },
    },
  },
  plugins: [],
};
