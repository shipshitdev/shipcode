import * as React from "react"
import { cn } from "../lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			className={cn(
				"flex h-8 w-full rounded-md border border-border bg-bg-tertiary px-3 py-1.5 text-[13px] text-text-primary transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-text-muted focus-visible:outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50",
				className
			)}
			{...props}
		/>
	)
}

export { Input }
