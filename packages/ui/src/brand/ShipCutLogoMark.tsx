import { type SVGProps, useId } from 'react';

export type ShipCutLogoMarkProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

export function ShipCutLogoMark({ size, className, ...props }: ShipCutLogoMarkProps) {
  const id = useId().replace(/:/g, '_');
  const gradientId = `${id}-shipcut-red`;
  const shadowId = `${id}-shipcut-shadow`;

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
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff4d4f" />
          <stop offset="100%" stopColor="#dc2626" />
        </linearGradient>
        <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="18" stdDeviation="26" floodColor="#7f1d1d" floodOpacity="0.35" />
        </filter>
      </defs>

      <rect
        x="104"
        y="104"
        width="816"
        height="816"
        rx="196"
        ry="196"
        fill={`url(#${gradientId})`}
        filter={`url(#${shadowId})`}
      />
      <path
        d="M426 320L426 704L738 512Z"
        fill="#ffffff"
        stroke="#ffffff"
        strokeWidth="44"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
