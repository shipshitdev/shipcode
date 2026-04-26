import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const PHASES = [
  { label: 'Issue', color: '#22d3ee', icon: '#' },
  { label: 'Plan', color: '#6366f1', icon: '◆' },
  { label: 'Review', color: '#f59e0b', icon: '✓' },
  { label: 'Execute', color: '#34d399', icon: '▶' },
  { label: 'Verify', color: '#a78bfa', icon: '◉' },
  { label: 'PR', color: '#f87171', icon: '↗' },
];

const STAGGER = 18;
const ARROW_DURATION = 12;

export const Pipeline: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const headerOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const headerY = interpolate(frame, [0, 20], [-20, 0], { extrapolateRight: 'clamp' });

  const boxWidth = 200;
  const boxHeight = 160;
  const gap = 80;
  const totalWidth = PHASES.length * boxWidth + (PHASES.length - 1) * gap;
  const startX = (width - totalWidth) / 2;
  const centerY = height / 2;

  return (
    <AbsoluteFill className="bg-[#0a0a0f]">
      <div
        style={{ opacity: headerOpacity, transform: `translateY(${headerY}px)` }}
        className="flex flex-col items-center pt-24"
      >
        <div className="text-2xl uppercase tracking-[0.4em] text-[#6366f1]">The Pipeline</div>
        <div className="mt-3 text-5xl font-semibold text-white">
          From issue to pull request, autonomously.
        </div>
      </div>

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 pointer-events-none"
        role="img"
        aria-label="Pipeline arrows connecting phases"
      >
        <title>Pipeline arrows</title>
        {PHASES.slice(0, -1).map((phase, i) => {
          const startBoxRight = startX + (i + 1) * boxWidth + i * gap;
          const endBoxLeft = startBoxRight + gap;
          const arrowStart = i * STAGGER + 14;
          const progress = interpolate(frame, [arrowStart, arrowStart + ARROW_DURATION], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          const x2 = startBoxRight + (endBoxLeft - startBoxRight) * progress;
          const headOpacity = progress > 0.85 ? 1 : 0;
          return (
            <g key={`arrow-${phase.label}`}>
              <line
                x1={startBoxRight}
                y1={centerY}
                x2={x2}
                y2={centerY}
                stroke="#2a2a35"
                strokeWidth={3}
              />
              <polygon
                points={`${endBoxLeft},${centerY} ${endBoxLeft - 12},${centerY - 8} ${endBoxLeft - 12},${centerY + 8}`}
                fill="#6366f1"
                opacity={headOpacity}
              />
            </g>
          );
        })}
      </svg>

      {PHASES.map((phase, i) => {
        const popStart = i * STAGGER;
        const scale = spring({
          frame: frame - popStart,
          fps,
          config: { damping: 12, stiffness: 120 },
        });
        const opacity = interpolate(frame, [popStart, popStart + 8], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const x = startX + i * (boxWidth + gap);
        const y = centerY - boxHeight / 2;
        const pulseStart = (PHASES.length - 1) * STAGGER + 30;
        const pulse = interpolate(
          frame,
          [pulseStart + i * 6, pulseStart + i * 6 + 18, pulseStart + i * 6 + 36],
          [1, 1.06, 1],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        );

        return (
          <div
            key={phase.label}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: boxWidth,
              height: boxHeight,
              opacity,
              transform: `scale(${scale * pulse})`,
              transformOrigin: 'center',
            }}
            className="flex flex-col items-center justify-center rounded-2xl border border-[#2a2a35] bg-[#13131c] shadow-2xl"
          >
            <div
              className="mb-3 flex h-14 w-14 items-center justify-center rounded-full text-3xl"
              style={{ backgroundColor: `${phase.color}20`, color: phase.color }}
            >
              {phase.icon}
            </div>
            <div className="text-xl font-semibold text-white">{phase.label}</div>
            <div className="mt-1 text-xs uppercase tracking-widest text-[#6b7280]">
              Phase {i + 1}
            </div>
          </div>
        );
      })}

      <div
        style={{
          opacity: interpolate(
            frame,
            [PHASES.length * STAGGER + 40, PHASES.length * STAGGER + 60],
            [0, 1],
            {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            },
          ),
        }}
        className="absolute bottom-24 left-0 right-0 text-center"
      >
        <div className="text-xl text-[#22d3ee]">
          Each phase runs in an isolated git worktree. Stops on red.
        </div>
      </div>
    </AbsoluteFill>
  );
};
