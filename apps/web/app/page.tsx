import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { InstallCommand } from './components/InstallCommand'
import { PlanReviewLoop } from './components/PlanReviewLoop'
import { HowItWorks } from './components/HowItWorks'
import { FeatureGrid } from './components/FeatureGrid'
import { CodeWindow } from './components/CodeWindow'
import { CTASection } from './components/CTASection'
import { Footer } from './components/Footer'

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
	)
}
