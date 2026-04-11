import { CodeWindow } from './components/CodeWindow';
import { CTASection } from './components/CTASection';
import { FeatureGrid } from './components/FeatureGrid';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { HowItWorks } from './components/HowItWorks';
import { InstallCommand } from './components/InstallCommand';
import { PlanReviewLoop } from './components/PlanReviewLoop';

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <InstallCommand />
        <PlanReviewLoop />
        <HowItWorks />
        <FeatureGrid />
        <CodeWindow />
        <CTASection />
      </main>
      <Footer />
    </>
  );
}
