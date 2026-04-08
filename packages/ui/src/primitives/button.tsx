import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-accent text-bg-primary hover:bg-accent-hover",
				secondary: "bg-bg-tertiary text-text-primary border border-border hover:bg-bg-hover",
				ghost: "bg-transparent text-text-secondary hover:text-text-primary",
				destructive: "bg-danger text-text-primary hover:bg-danger/90",
				link: "text-accent underline-offset-4 hover:underline",
			},
			size: {
				default: "h-8 px-3.5 py-1.5",
				sm: "h-7 px-2.5 text-xs",
				lg: "h-10 px-6 py-2.5 text-[15px]",
				icon: "h-8 w-8",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	}
)

function Button({
	className,
	variant,
	size,
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean
	}) {
	const Comp = asChild ? Slot : "button"
	return (
		<Comp
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	)
}

export { Button, buttonVariants }
