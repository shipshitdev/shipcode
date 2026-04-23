import { type SVGProps, useId } from 'react';

export type ShipCodeLogoMarkProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

export function ShipCodeLogoMark({ size, className, ...props }: ShipCodeLogoMarkProps) {
  const id = useId().replace(/:/g, '_');
  const backgroundId = `${id}-shipcode-bg`;
  const accentId = `${id}-shipcode-accent`;
  const glowId = `${id}-shipcode-glow`;
  const softGlowId = `${id}-shipcode-soft-glow`;

  return (
    <svg
      viewBox="0 0 1024 1024"
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <defs>
        <linearGradient id={backgroundId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0b1220" />
          <stop offset="100%" stopColor="#111827" />
        </linearGradient>
        <linearGradient id={accentId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
        <radialGradient id={glowId} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </radialGradient>
        <filter id={softGlowId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="28" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width="1024" height="1024" rx="224" ry="224" fill={`url(#${backgroundId})`} />
      <rect
        width="1024"
        height="1024"
        rx="224"
        ry="224"
        fill="none"
        stroke={`url(#${accentId})`}
        strokeWidth="3"
        opacity="0.18"
      />
      <rect
        x="164"
        y="188"
        width="696"
        height="648"
        rx="136"
        ry="136"
        fill="#0f172a"
        stroke={`url(#${accentId})`}
        strokeWidth="6"
        opacity="0.2"
      />
      <ellipse
        cx="512"
        cy="428"
        rx="238"
        ry="214"
        fill={`url(#${glowId})`}
        filter={`url(#${softGlowId})`}
      />
      <rect
        x="234"
        y="264"
        width="156"
        height="460"
        rx="52"
        ry="52"
        fill="#101827"
        stroke="#1f2937"
        strokeWidth="8"
      />
      <rect
        x="434"
        y="224"
        width="156"
        height="500"
        rx="52"
        ry="52"
        fill={`url(#${accentId})`}
        opacity="0.95"
      />
      <rect
        x="634"
        y="304"
        width="156"
        height="420"
        rx="52"
        ry="52"
        fill="#101827"
        stroke="#1f2937"
        strokeWidth="8"
      />
      <rect x="258" y="304" width="108" height="24" rx="12" fill="#334155" opacity="0.8" />
      <rect x="458" y="264" width="108" height="24" rx="12" fill="#ecfeff" opacity="0.9" />
      <rect x="658" y="344" width="108" height="24" rx="12" fill="#334155" opacity="0.8" />
      <rect x="258" y="356" width="108" height="176" rx="28" fill="#111827" opacity="0.92" />
      <rect x="458" y="316" width="108" height="216" rx="28" fill="#0f172a" opacity="0.22" />
      <rect x="658" y="396" width="108" height="136" rx="28" fill="#111827" opacity="0.92" />
      <rect x="234" y="748" width="556" height="10" rx="5" fill="#1f2937" opacity="0.9" />
      <rect x="234" y="772" width="396" height="10" rx="5" fill="#1f2937" opacity="0.72" />
      <rect
        x="654"
        y="772"
        width="136"
        height="10"
        rx="5"
        fill={`url(#${accentId})`}
        opacity="0.5"
      />
      <rect x="442" y="736" width="140" height="8" rx="4" fill="#ecfeff" opacity="0.42" />
    </svg>
  );
}
