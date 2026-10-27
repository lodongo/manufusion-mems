/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

// Every colour comes from the tenant theme (CSS variables set in src/lib/site.ts). The slate/emerald/white
// names keep older screens working; the token names (page, panel, line, ink, soft, muted, brand, brandsoft)
// are the ones to use in new code.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        white: v('ink'),
        onbrand: v('onbrand'),
        page: v('page'),
        panel: v('panel'),
        line: v('line'),
        ink: v('ink'),
        soft: v('soft'),
        muted: v('muted'),
        brand: v('brand'),
        brandsoft: v('brandsoft'),
        danger: v('danger'),
        slate: {
          200: v('soft'),
          300: v('soft'),
          400: v('muted'),
          500: v('muted'),
          700: v('line'),
          800: v('line'),
          900: v('panel'),
          950: v('page'),
        },
        emerald: {
          300: v('brandsoft'),
          400: v('brand'),
          500: v('brand'),
        },
      },
    },
  },
  plugins: [],
};
