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
          <stop offset="0%" stopColor="#0d1117" />
          <stop offset="100%" stopColor="#161b22" />
        </linearGradient>
        <linearGradient id={accentId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#818cf8" />
        </linearGradient>
        <linearGradient id={glowId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.15" />
        </linearGradient>
        <filter id={softGlowId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="18" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width="1024" height="1024" rx="230" ry="230" fill={`url(#${backgroundId})`} />
      <rect
        width="1024"
        height="1024"
        rx="230"
        ry="230"
        fill="none"
        stroke={`url(#${accentId})`}
        strokeWidth="2"
        opacity="0.15"
      />
      <ellipse
        cx="512"
        cy="510"
        rx="260"
        ry="260"
        fill={`url(#${glowId})`}
        filter={`url(#${softGlowId})`}
      />
      <polyline
        points="350,340 255,512 350,684"
        fill="none"
        stroke={`url(#${accentId})`}
        strokeWidth="56"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <polyline
        points="674,340 769,512 674,684"
        fill="none"
        stroke={`url(#${accentId})`}
        strokeWidth="56"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <line
        x1="572"
        y1="320"
        x2="452"
        y2="704"
        stroke={`url(#${accentId})`}
        strokeWidth="56"
        strokeLinecap="round"
      />
      <line
        x1="312"
        y1="800"
        x2="712"
        y2="800"
        stroke={`url(#${accentId})`}
        strokeWidth="2"
        opacity="0.2"
      />
    </svg>
  );
}
