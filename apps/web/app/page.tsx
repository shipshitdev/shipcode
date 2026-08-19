import { CtaBanner } from '@/components/CtaBanner';
import { Features } from '@/components/Features';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { PipelineSteps } from '@/components/PipelineSteps';
import { homeDiscoveryMetadata } from '@/site';

export const metadata = {
  title: 'ShipCode',
  description: 'AI development pipelines for GitHub issues, PRs, worktrees, and verification.',
  ...homeDiscoveryMetadata,
};

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <PipelineSteps />
        <Features />
        <CtaBanner />
      </main>
      <Footer />
    </>
  );
}
