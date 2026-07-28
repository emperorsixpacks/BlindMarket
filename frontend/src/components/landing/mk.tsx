import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * mk — marketing-surface primitives (landing + MarketingLayout chrome ONLY).
 *
 * The marketing surface deliberately wears a different suit than the app:
 * pill radii and film grain here, zero-radius terminal chrome in the app.
 * Radii use arbitrary values (`rounded-[999px]`) because the Tailwind theme
 * zeroes every *named* radius utility for the app's sharp-corner system.
 * Palette is FIXED (not theme-var driven): the marketing composition is the
 * same in both app themes, like any editorial site.
 */

type Tone = 'cream' | 'ghost-dark' | 'ink' | 'ghost-light';

const TONES: Record<Tone, string> = {
  // On dark sections
  cream:
    'bg-[#f5efe0] text-[#0a0a0b] shadow-[0_20px_44px_-22px_rgba(0,0,0,0.85)] hover:bg-white',
  'ghost-dark':
    'border border-white/25 text-[#fafaf9] hover:border-white/60 hover:bg-white/[0.06]',
  // On the paper band
  ink: 'bg-[#101013] text-[#fafaf9] shadow-[0_20px_44px_-22px_rgba(10,10,11,0.7)] hover:bg-black',
  'ghost-light':
    'border border-black/15 text-[#0a0a0b] hover:border-black/40 hover:bg-black/[0.04]',
};

export function MkButton({
  label,
  tone = 'cream',
  size = 'md',
  className = '',
}: {
  label: string;
  tone?: Tone;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const pad = size === 'sm' ? 'h-10 px-5 text-[13.5px]' : 'h-12 px-7 text-[14.5px]';
  return (
    <span
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-[999px] font-mk font-medium tracking-[-0.01em] transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] ${pad} ${TONES[tone]} ${className}`}
    >
      {label}
    </span>
  );
}

/** Film grain — the texture that keeps the flat blacks and papers from
 * reading as vector fills. Fixed-position-free (absolute in its section),
 * pointer-events-none, cheap: one tiled SVG turbulence texture. */
const GRAIN_URI = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

export function Grain({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 mix-blend-soft-light opacity-[0.35] ${className}`}
      style={{ backgroundImage: GRAIN_URI }}
    />
  );
}

/** Scroll reveal shared by every below-hero block. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
