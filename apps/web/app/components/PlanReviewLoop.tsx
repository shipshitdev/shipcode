'use client'

import { useEffect, useRef, useState } from 'react'

const steps = [
	{ label: 'Opus generates plan', agent: 'opus' as const },
	{ label: 'Codex reviews and critiques', agent: 'codex' as const },
	{ label: 'Opus revises based on feedback', agent: 'opus' as const },
	{ label: 'Codex approves', agent: 'codex' as const },
	{ label: 'Execute', agent: 'opus' as const },
]

export function PlanReviewLoop() {
	const containerRef = useRef<HTMLDivElement>(null)
	const [visibleSteps, setVisibleSteps] = useState<Set<number>>(new Set())

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const index = Number(
							(entry.target as HTMLElement).dataset.index,
						)
						setVisibleSteps((prev) => new Set([...prev, index]))
					}
				}
			},
			{ threshold: 0.3 },
		)

		const items = container.querySelectorAll('[data-index]')
		for (const item of items) observer.observe(item)

		return () => observer.disconnect()
	}, [])

	return (
		<section className="py-24 px-6">
			<div className="max-w-3xl mx-auto">
				<h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
					The Adversarial Review Loop
				</h2>
				<div ref={containerRef} className="relative">
					{steps.map((step, i) => (
						<div
							key={step.label}
							data-index={i}
							className="relative pl-12 pb-10 last:pb-0"
							style={{
								opacity: visibleSteps.has(i) ? 1 : 0,
								transform: visibleSteps.has(i)
									? 'translateY(0)'
									: 'translateY(20px)',
								transition: `opacity 0.5s ease ${i * 0.15}s, transform 0.5s ease ${i * 0.15}s`,
							}}
						>
							{/* Vertical line */}
							{i < steps.length - 1 && (
								<div className="absolute left-[19px] top-8 bottom-0 w-px bg-border" />
							)}
							{/* Dot */}
							<div
								className={`absolute left-2.5 top-1.5 w-5 h-5 rounded-full border-2 ${
									step.agent === 'opus'
										? 'border-accent bg-accent/20'
										: 'border-success bg-success/20'
								}`}
							/>
							{/* Content */}
							<div className="flex items-center gap-3">
								<span
									className={`text-xs font-mono px-2 py-0.5 rounded ${
										step.agent === 'opus'
											? 'bg-accent/10 text-accent'
											: 'bg-success/10 text-success'
									}`}
								>
									{step.agent === 'opus' ? 'Opus' : 'Codex'}
								</span>
								<span className="text-lg text-text-primary">
									{step.label}
								</span>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	)
}
