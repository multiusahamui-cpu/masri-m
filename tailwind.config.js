/** Tailwind dibangun lokal (sebelumnya CDN). Konfigurasi identik dengan versi CDN lama. */
export default {
  darkMode: 'class',
  content: ['./index.html', './index.tsx', './App.tsx', './constants.ts', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'sans-serif'] },
      colors: {
        masri: { primary: '#047857', dark: '#064e3b', light: '#ecfdf5', gold: '#d97706', accent: '#10b981' },
      },
    },
  },
  plugins: [],
};
