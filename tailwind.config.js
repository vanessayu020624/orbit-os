export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0073ea', dark: '#0060b9' },
        ok: '#00c875', warn: '#fdab3d', danger: '#e2445c', idle: '#c4c4c4',
      },
    },
  },
  plugins: [],
}
