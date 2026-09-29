import type { Config } from 'tailwindcss';

// Tailwind v3 config per ADR-005 rule 6: scoped per workspace.
// Design tokens in `theme.extend` are mirrored across the three MFE configs;
// content globs are scoped to this workspace only so generated utilities
// never collide across federation boundaries.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Shared Sentinel design tokens (keep in sync across mfe-* configs).
        'sentinel-surface': '#0f172a',
        'sentinel-panel': '#1e293b',
        'sentinel-accent': '#38bdf8',
        'sentinel-degraded': '#f59e0b',
        'sentinel-failed': '#ef4444',
      },
    },
  },
  plugins: [],
} satisfies Config;
