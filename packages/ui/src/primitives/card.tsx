import * as React from "react"
import { cn } from "../lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("rounded-md border border-border bg-bg-secondary", className)}
			{...props}
		/>
	)
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("flex flex-col gap-1.5 p-4", className)}
			{...props}
		/>
	)
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
	return (
		<h3
			className={cn("text-sm font-semibold leading-none", className)}
			{...props}
		/>
	)
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
	return (
		<p
			className={cn("text-xs text-text-secondary", className)}
			{...props}
		/>
	)
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("p-4 pt-0", className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("flex items-center p-4 pt-0", className)}
			{...props}
		/>
	)
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
