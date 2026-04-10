import { InstallCommand } from './InstallCommand'

export function CTASection() {
	return (
		<section className="py-24 px-6 text-center">
			<div className="max-w-2xl mx-auto">
				<h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to ship?</h2>
				<p className="text-secondary mb-10">
					Stop writing plans that get thrown away. Let the models argue until the plan is
					airtight, then execute it automatically.
				</p>
				<InstallCommand />
				<a
					href="/docs"
					className="inline-block mt-6 text-accent hover:text-accent-hover transition-colors"
				>
					Read the docs &rarr;
				</a>
			</div>
		</section>
	)
}
