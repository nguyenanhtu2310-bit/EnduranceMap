import { useId } from 'react';

/**
 * The "Summit Mark" — a waypoint pin holding an elevation profile that peaks at a
 * glowing summit dot. Values are taken verbatim from the logo handoff; the mark is
 * approved artwork, so nothing here is adjusted by eye.
 */

interface IconProps {
  /** Rendered size in px. Below ~32 the flat variant is used automatically. */
  size?: number;
  className?: string;
}

/**
 * Full mark, with the drop shadow and summit glow. The gradient and filter ids are
 * generated per instance — two copies on one page would otherwise share, and whichever
 * mounted second would silently reuse the first one's definitions.
 */
export function EnduranceMapIcon({ size = 96, className }: IconProps) {
  const uid = useId().replace(/:/g, '');
  const glow = `peakGlow-${uid}`;
  const shadow = `pinShadow-${uid}`;

  // The shadow and glow wash out at small sizes; the handoff calls for the flat mark.
  if (size <= 32) return <EnduranceMapIconSimple size={size} className={className} />;

  return (
    <svg
      viewBox="0 0 88 88"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      /* The drop shadow extends past the 88×88 box; without this it is clipped flat. */
      style={{ overflow: 'visible' }}
    >
      <defs>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#eafbe6" />
          <stop offset="1" stopColor="#eafbe6" stopOpacity="0" />
        </radialGradient>
        <filter id={shadow} x="-40%" y="-20%" width="180%" height="180%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#022e01" floodOpacity="0.55" />
        </filter>
      </defs>
      <path
        d="M44 4 C64 4 80 20 80 42 C80 62 60 76 44 84 C28 76 8 62 8 42 C8 20 24 4 44 4Z"
        fill="#07bc02"
        filter={`url(#${shadow})`}
      />
      <path
        d="M44 4 C64 4 80 20 80 42 C80 62 60 76 44 84"
        stroke="#eafbe6"
        strokeOpacity="0.35"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M18 54 L33 31 L43 45 L55 24 L70 53"
        stroke="#0d0f10"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="55" cy="24" r="10" fill={`url(#${glow})`} />
      <circle cx="55" cy="24" r="4" fill="#eafbe6" />
      <circle cx="55" cy="24" r="4" fill="none" stroke="#0d0f10" strokeWidth="1.5" />
    </svg>
  );
}

/** Flat mark for favicon and app-icon scale — no shadow, no glow. */
export function EnduranceMapIconSimple({ size = 32, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 88 88"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M44 4 C64 4 80 20 80 42 C80 62 60 76 44 84 C28 76 8 62 8 42 C8 20 24 4 44 4Z"
        fill="#07bc02"
      />
      <path
        d="M18 54 L33 31 L43 45 L55 24 L70 53"
        stroke="#0d0f10"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="55" cy="24" r="5" fill="#eafbe6" />
    </svg>
  );
}

/**
 * Icon and wordmark scale together as one lockup — the handoff is explicit that they
 * are never sized independently. The reference pairs a 96px icon with a 46px wordmark
 * and a 24px gap, so everything derives from the icon size.
 */
const WORDMARK_RATIO = 46 / 96;
const GAP_RATIO = 24 / 96;

interface LockupProps {
  /** Icon render size in px; the wordmark and gap follow from it. */
  size?: number;
}

export function EnduranceMapLogo({ size = 96 }: LockupProps) {
  return (
    <span className="em-logo" style={{ gap: `${size * GAP_RATIO}px` }}>
      <EnduranceMapIcon size={size} />
      <span className="em-wordmark" style={{ fontSize: `${size * WORDMARK_RATIO}px` }}>
        Endurance<span className="em-wordmark-accent">Map</span>
      </span>
    </span>
  );
}
