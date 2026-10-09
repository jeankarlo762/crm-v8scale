import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Qualquer `border`/`divide` sem cor explícita usa o token (evita o gray-200 padrão do Tailwind, que fica branco no dark).
      borderColor: { DEFAULT: 'rgb(var(--border) / <alpha-value>)' },
      divideColor: { DEFAULT: 'rgb(var(--border) / <alpha-value>)' },
      colors: {
        background: 'rgb(var(--background) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-hover': 'rgb(var(--surface-hover) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        divider: 'rgb(var(--divider) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        'fg-muted': 'rgb(var(--fg-muted) / <alpha-value>)',
        'primary-soft': 'rgb(var(--primary-soft) / <alpha-value>)',
        overlay: 'rgb(var(--overlay) / <alpha-value>)',
        'primary-soft-fg': 'rgb(var(--primary-soft-fg) / <alpha-value>)',
        tone: {
        green: { bg: 'rgb(var(--tone-green-bg) / <alpha-value>)', fg: 'rgb(var(--tone-green-fg) / <alpha-value>)', solid: 'rgb(var(--tone-green-solid) / <alpha-value>)' },
        amber: { bg: 'rgb(var(--tone-amber-bg) / <alpha-value>)', fg: 'rgb(var(--tone-amber-fg) / <alpha-value>)', solid: 'rgb(var(--tone-amber-solid) / <alpha-value>)' },
        orange: { bg: 'rgb(var(--tone-orange-bg) / <alpha-value>)', fg: 'rgb(var(--tone-orange-fg) / <alpha-value>)', solid: 'rgb(var(--tone-orange-solid) / <alpha-value>)' },
        red: { bg: 'rgb(var(--tone-red-bg) / <alpha-value>)', fg: 'rgb(var(--tone-red-fg) / <alpha-value>)', solid: 'rgb(var(--tone-red-solid) / <alpha-value>)' },
        sky: { bg: 'rgb(var(--tone-sky-bg) / <alpha-value>)', fg: 'rgb(var(--tone-sky-fg) / <alpha-value>)', solid: 'rgb(var(--tone-sky-solid) / <alpha-value>)' },
        blue: { bg: 'rgb(var(--tone-blue-bg) / <alpha-value>)', fg: 'rgb(var(--tone-blue-fg) / <alpha-value>)', solid: 'rgb(var(--tone-blue-solid) / <alpha-value>)' },
        indigo: { bg: 'rgb(var(--tone-indigo-bg) / <alpha-value>)', fg: 'rgb(var(--tone-indigo-fg) / <alpha-value>)', solid: 'rgb(var(--tone-indigo-solid) / <alpha-value>)' },
        purple: { bg: 'rgb(var(--tone-purple-bg) / <alpha-value>)', fg: 'rgb(var(--tone-purple-fg) / <alpha-value>)', solid: 'rgb(var(--tone-purple-solid) / <alpha-value>)' },
        slate: { bg: 'rgb(var(--tone-slate-bg) / <alpha-value>)', fg: 'rgb(var(--tone-slate-fg) / <alpha-value>)', solid: 'rgb(var(--tone-slate-solid) / <alpha-value>)' },
        gray: { bg: 'rgb(var(--tone-gray-bg) / <alpha-value>)', fg: 'rgb(var(--tone-gray-fg) / <alpha-value>)', solid: 'rgb(var(--tone-gray-solid) / <alpha-value>)' },
        pink: { bg: 'rgb(var(--tone-pink-bg) / <alpha-value>)', fg: 'rgb(var(--tone-pink-fg) / <alpha-value>)', solid: 'rgb(var(--tone-pink-solid) / <alpha-value>)' },
      },
        // Paleta primária: vermelho #B80000 (placeholder até a identidade visual da V8 Scale).
        // Mantemos a CHAVE "orange" para não precisar renomear ~66 telas que já
        // usam classes orange-*; os valores agora são tons de vermelho.
        orange: {
          50:  '#fef2f2',
          100: '#fde0e0',
          200: '#f9b8b8',
          300: '#f08a8a',
          400: '#dd4b4b',
          500: '#B80000',
          600: '#9f0000',
          700: '#8f0000',
          800: '#750000',
          900: '#5c0000',
        },
        primary: {
          50:  '#fef2f2',
          100: '#fde0e0',
          500: '#B80000',
          600: '#9f0000',
          700: '#8f0000',
          900: '#5c0000',
        },
      },
    },
  },
  plugins: [],
} satisfies Config
