import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const SHOTS = [
  { src: 'shots/kanban.png', caption: 'Kanban over GitHub issues — drag to ship.' },
  {
    src: 'shots/pipeline.png',
    caption: 'Live phase log streams from Claude / Codex / OpenRouter.',
  },
  { src: 'shots/graph.png', caption: 'Issue dependency graph — see the critical path.' },
  { src: 'shots/diff.png', caption: 'Verify diffs before the PR opens.' },
];

const SHOT_FRAMES = 90;

const Shot: React.FC<{ src: string; caption: string }> = ({ src, caption }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const opacity = interpolate(frame, [0, 12, SHOT_FRAMES - 12, SHOT_FRAMES], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = interpolate(frame, [0, SHOT_FRAMES], [1.05, 1.12], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const tx = interpolate(frame, [0, SHOT_FRAMES], [-20, 20], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const captionY = interpolate(frame, [0, 14], [40, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill className="bg-[#0a0a0f]">
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity,
          transform: `scale(${scale}) translate(${tx}px, 0)`,
        }}
        className="flex items-center justify-center"
      >
        <Img
          src={staticFile(src)}
          style={{
            width: width * 0.78,
            height: 'auto',
            maxHeight: height * 0.72,
            objectFit: 'contain',
            borderRadius: 24,
            boxShadow: '0 40px 120px rgba(99,102,241,0.35)',
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 80,
          opacity,
          transform: `translateY(${captionY}px)`,
        }}
        className="flex justify-center"
      >
        <div className="rounded-full bg-[#13131c]/80 px-8 py-4 text-2xl text-white backdrop-blur-md">
          {caption}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const AppShots: React.FC = () => {
  return (
    <AbsoluteFill className="bg-[#0a0a0f]">
      {SHOTS.map((shot, i) => (
        <Sequence key={shot.src} from={i * SHOT_FRAMES} durationInFrames={SHOT_FRAMES}>
          <Shot src={shot.src} caption={shot.caption} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
