import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: { damping: 14, stiffness: 90 } });
  const logoOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const cmdsOpacity = interpolate(frame, [20, 40], [0, 1], { extrapolateRight: 'clamp' });
  const cmdsY = interpolate(frame, [20, 40], [16, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill className="items-center justify-center bg-[#0a0a0f]">
      <div
        style={{ opacity: logoOpacity, transform: `scale(${logoScale})` }}
        className="flex flex-col items-center"
      >
        <div className="text-8xl font-bold tracking-tight text-white">ShipCode</div>
        <div className="mt-2 text-2xl font-light text-[#22d3ee]">shipshit.dev</div>
      </div>

      <div
        style={{ opacity: cmdsOpacity, transform: `translateY(${cmdsY}px)` }}
        className="mt-16 flex flex-col items-center gap-5"
      >
        <div className="rounded-xl border border-[#2a2a35] bg-[#13131c] px-8 py-5 font-mono text-2xl text-white">
          <span className="text-[#6b7280]">$</span> brew install --cask shipcode
        </div>
        <div className="rounded-xl border border-[#2a2a35] bg-[#13131c] px-8 py-5 font-mono text-2xl text-white">
          <span className="text-[#6b7280]">$</span> npx @shipshitdev/shipcode
        </div>
        <div className="mt-4 text-lg text-[#6b7280]">GitHub issues in. Pull requests out.</div>
      </div>
    </AbsoluteFill>
  );
};
