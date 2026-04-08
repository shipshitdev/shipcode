'use client'

import { useState } from 'react'

export function InstallCommand() {
	const [copied, setCopied] = useState(false)

	const handleCopy = async () => {
		await navigator.clipboard.writeText('npx shipcode')
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<section className="px-6 pb-16 flex justify-center">
			<div className="bg-bg-secondary border border-border rounded-lg px-6 py-4 flex items-center gap-4 font-mono text-sm">
				<span className="text-text-muted select-none">$</span>
				<span className="text-text-primary">npx shipcode</span>
				<span className="inline-block w-2 h-5 bg-accent animate-[blink_1s_step-end_infinite]" />
				<button
					type="button"
					onClick={handleCopy}
					className="ml-4 px-3 py-1 text-xs rounded bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors border border-border"
				>
					{copied ? 'Copied!' : 'Copy'}
				</button>
			</div>
		</section>
	)
}
