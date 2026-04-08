import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

const badgeVariants = cva(
	"inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors",
	{
		variants: {
			variant: {
				default: "bg-bg-tertiary text-text-secondary",
				success: "bg-success/15 text-success",
				warning: "bg-warning/15 text-warning",
				danger: "bg-danger/15 text-danger",
				accent: "bg-accent/15 text-accent",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	}
)

function Badge({
	className,
	variant,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return (
		<span className={cn(badgeVariants({ variant }), className)} {...props} />
	)
}

export { Badge, badgeVariants }
