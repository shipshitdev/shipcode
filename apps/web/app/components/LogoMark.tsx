export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      aria-hidden="true"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="shipcode-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0d1117" />
          <stop offset="100%" stopColor="#161b22" />
        </linearGradient>
        <linearGradient id="shipcode-accent" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#818cf8" />
        </linearGradient>
        <linearGradient id="shipcode-glow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.15" />
        </linearGradient>
        <filter id="shipcode-soft-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="18" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width="1024" height="1024" rx="230" ry="230" fill="url(#shipcode-bg)" />
      <rect
        width="1024"
        height="1024"
        rx="230"
        ry="230"
        fill="none"
        stroke="url(#shipcode-accent)"
        strokeWidth="2"
        opacity="0.15"
      />
      <ellipse
        cx="512"
        cy="510"
        rx="260"
        ry="260"
        fill="url(#shipcode-glow)"
        filter="url(#shipcode-soft-glow)"
      />
      <polyline
        points="350,340 255,512 350,684"
        fill="none"
        stroke="url(#shipcode-accent)"
        strokeWidth="56"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <polyline
        points="674,340 769,512 674,684"
        fill="none"
        stroke="url(#shipcode-accent)"
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
        stroke="url(#shipcode-accent)"
        strokeWidth="56"
        strokeLinecap="round"
      />
      <line
        x1="312"
        y1="800"
        x2="712"
        y2="800"
        stroke="url(#shipcode-accent)"
        strokeWidth="2"
        opacity="0.2"
      />
    </svg>
  );
}
