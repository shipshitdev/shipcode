import { cn } from '@/lib/utils';

const R = 4;
const CIRCUMFERENCE = 2 * Math.PI * R;

interface StatusCircleIconProps {
  fill: number; // 0–1
  className?: string;
  style?: { color?: string };
  size?: number;
}

export function StatusCircleIcon({ fill, className, style, size = 8 }: StatusCircleIconProps) {
  const f = Math.max(0, Math.min(1, fill));
  const dashFilled = f * CIRCUMFERENCE;
  const dashEmpty = CIRCUMFERENCE - dashFilled;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      className={cn('shrink-0', className)}
      style={style}
      aria-hidden="true"
    >
      {f < 1 && (
        <circle
          cx="5"
          cy="5"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.3"
        />
      )}
      {f === 1 ? (
        <circle cx="5" cy="5" r={R} fill="currentColor" />
      ) : f > 0 ? (
        <circle
          cx="5"
          cy="5"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray={`${dashFilled} ${dashEmpty}`}
          transform="rotate(-90 5 5)"
        />
      ) : null}
    </svg>
  );
}
