import type { CSSProperties } from 'react';

export type LogoVariant = 'tile' | 'monogram' | 'sprout' | 'coin';

const BRAND = 'var(--color-background-brand-default)';

/**
 * The Wealthwise logo mark. Four interchangeable variants so the brand mark can
 * be swapped in one place. All are theme-aware (brand token adapts to dark mode)
 * and render crisply at any size.
 */
export function LogoMark({
  variant = 'tile',
  size = 32,
  style,
}: {
  variant?: LogoVariant;
  size?: number;
  style?: CSSProperties;
}) {
  const common = { width: size, height: size, viewBox: '0 0 32 32', style, 'aria-hidden': true } as const;

  switch (variant) {
    // Rounded tile with an upward trend line — reads as "growth".
    case 'tile':
      return (
        <svg {...common} fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="8" fill={BRAND} />
          <path
            d="M8 20.5 L13.5 14 L18 17 L24 9.5"
            stroke="#fff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M20 9.5 L24 9.5 L24 13.5"
            stroke="#fff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // A "W" drawn as a chart zigzag whose right peak rises highest.
    case 'monogram':
      return (
        <svg {...common} fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M5 8 L10.5 24 L16 14 L21.5 24 L27 6"
            stroke={BRAND}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // A sprout — wealth that grows.
    case 'sprout':
      return (
        <svg {...common} fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 28 L16 14" stroke={BRAND} strokeWidth="2.5" strokeLinecap="round" />
          <path
            d="M16 15 C16 9 11 6 6 6 C6 12 11 15 16 15 Z"
            fill={BRAND}
            opacity="0.85"
          />
          <path
            d="M16 13 C16 8 20 5 25 5 C25 10 21 13 16 13 Z"
            fill={BRAND}
          />
        </svg>
      );

    // A coin with an upward arrow.
    case 'coin':
      return (
        <svg {...common} fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="16" r="13" fill={BRAND} />
          <path
            d="M16 22 L16 11"
            stroke="#fff"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="M11.5 15 L16 10.5 L20.5 15"
            stroke="#fff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

/** Mark + "Wealthwise" wordmark, for the header and login screen. */
export function Logo({
  variant = 'tile',
  size = 28,
  className,
}: {
  variant?: LogoVariant;
  size?: number;
  className?: string;
}) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <LogoMark variant={variant} size={size} />
      <span
        className="heading-xsmall"
        style={{ color: 'var(--color-text-base-default)', letterSpacing: '-0.01em' }}
      >
        Wealthwise
      </span>
    </span>
  );
}
