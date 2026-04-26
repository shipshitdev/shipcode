import { AbsoluteFill, Series } from 'remotion';
import { AppShots } from './AppShots';
import { Outro } from './Outro';
import { Pipeline } from './Pipeline';
import { Title } from './Title';

const FPS = 30;

export const Launch: React.FC = () => {
  return (
    <AbsoluteFill className="bg-[#0a0a0f] text-[#f5f5f5] font-sans">
      <Series>
        <Series.Sequence durationInFrames={3 * FPS}>
          <Title />
        </Series.Sequence>
        <Series.Sequence durationInFrames={12 * FPS}>
          <Pipeline />
        </Series.Sequence>
        <Series.Sequence durationInFrames={12 * FPS}>
          <AppShots />
        </Series.Sequence>
        <Series.Sequence durationInFrames={3 * FPS}>
          <Outro />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
