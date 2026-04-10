export function Footer() {
	return (
		<footer className="border-t border-border py-8 px-6">
			<div className="max-w-6xl mx-auto flex flex-col items-center gap-4 text-muted text-sm">
				<div className="flex items-center gap-6">
					<a
						href="https://github.com/shipshitdev/shipcode"
						target="_blank"
						rel="noopener noreferrer"
						className="hover:text-secondary transition-colors"
					>
						GitHub
					</a>
					<a
						href="/docs"
						className="hover:text-secondary transition-colors"
					>
						Docs
					</a>
				</div>
				<p>Built by shipshit.dev</p>
			</div>
		</footer>
	)
}
