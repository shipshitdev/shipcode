import { Composition } from 'remotion';
import { Launch } from './compositions/Launch';

const FPS = 30;
const TOTAL_FRAMES = 30 * FPS;

export const RemotionRoot = () => {
  return (
    <Composition
      id="Launch"
      component={Launch}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
