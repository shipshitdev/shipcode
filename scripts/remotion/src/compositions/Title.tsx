import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 12, stiffness: 80 } });
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill className="items-center justify-center bg-[#0a0a0f]">
      <div
        style={{ opacity, transform: `scale(${scale})` }}
        className="flex flex-col items-center gap-6"
      >
        <div className="text-9xl font-bold tracking-tight text-white">ShipCode</div>
        <div className="text-3xl font-light text-[#22d3ee]">
          GitHub issues in. Pull requests out.
        </div>
      </div>
    </AbsoluteFill>
  );
};
