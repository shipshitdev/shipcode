import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { cn } from "../lib/utils"

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
	return <SelectPrimitive.Root {...props} />
}
function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
	return (
		<SelectPrimitive.Trigger
			className={cn("flex h-8 items-center justify-between rounded-lg border border-border bg-tertiary px-3 py-1.5 text-[13px] text-primary placeholder:text-muted focus:outline-none focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate", className)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<svg className="h-4 w-4 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	)
}
function SelectContent({ className, children, position = "popper", ...props }: React.ComponentProps<typeof SelectPrimitive.Content> & { position?: "popper" | "item-aligned" }) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				className={cn("relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-xl border border-border bg-elevated text-primary shadow-2xl shadow-black/40", position === "popper" && "translate-y-1", className)}
				position={position}
				{...props}
			>
				<SelectPrimitive.Viewport className={cn("p-1", position === "popper" && "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]")}>
					{children}
				</SelectPrimitive.Viewport>
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	)
}
function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
	return (
		<SelectPrimitive.Item
			className={cn("relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-hover focus:text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)}
			{...props}
		>
			<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5"/></svg>
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	)
}
function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
	return <SelectPrimitive.Value {...props} />
}
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
