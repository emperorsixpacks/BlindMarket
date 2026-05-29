/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      /* ── BlindMarket Design System Tokens ─────────────────────── */
      colors: {
        bg:         'var(--bb-bg)',
        surface:    'var(--bb-surface)',
        'surface-2': 'var(--bb-surface-2)',
        line:       'var(--bb-line)',
        'line-2':   'var(--bb-line-2)',
        ink:        'var(--bb-ink)',
        'ink-2':    'var(--bb-ink-2)',
        'ink-3':    'var(--bb-ink-3)',
        invert:     'var(--bb-invert)',
        'invert-fg': 'var(--bb-invert-fg)',
        cream:      'var(--bb-cream)',
        ok:         'var(--bb-ok)',
        warn:       'var(--bb-warn)',
        err:        'var(--bb-err)',
        info:       'var(--bb-info)',
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", 'system-ui', '-apple-system', "'Segoe UI'", 'Roboto', 'sans-serif'],
        mono: ["'IBM Plex Mono'", 'ui-monospace', "'SF Mono'", 'Menlo', 'monospace'],
        // Dot-matrix / LED display face — used for the landing hero headline.
        display: ["'Doto'", "'IBM Plex Mono'", 'ui-monospace', 'monospace'],
      },
      /* Sharp corners — zero border-radius everywhere */
      borderRadius: {
        DEFAULT: '0',
        none: '0',
        sm: '0',
        md: '0',
        lg: '0',
        xl: '0',
        '2xl': '0',
        '3xl': '0',
        full: '0',
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      letterSpacing: {
        tightest: '-.02em',
        tighter: '-.01em',
        tight: '-.005em',
        normal: '0',
        wide: '.05em',
        wider: '.1em',
        widest: '.22em',
      },
      animation: {
        'bb-fade': 'bbFade 300ms ease-out forwards',
        'bb-blink': 'bbBlink 1.05s step-end infinite',
        'bb-pulse': 'bbPulse 1.6s ease-in-out infinite',
      },
      keyframes: {
        bbFade: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        bbBlink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        bbPulse: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms')({
      strategy: 'class',
    }),
    require('@tailwindcss/typography'),
  ],
}
