<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const badgeVariants = tv({
		base: "h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap transition-colors focus-visible:ring-[3px] [&>svg]:pointer-events-none",
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
				secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
				destructive: "bg-destructive/10 [a]:hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive dark:bg-destructive/20",
				outline: "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
				ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
				link: "text-primary underline-offset-4 hover:underline",
			},
			/* Project status tones (paired with icon/text, never color alone). */
			tone: {
				neutral: "border-border bg-secondary text-muted-foreground",
				accent: "border-border bg-accent text-foreground",
				running: "border-info/40 bg-info/15 text-info",
				good: "border-success/40 bg-success/15 text-success",
				warn: "border-warning/40 bg-warning/15 text-warning",
				danger: "border-destructive/40 bg-destructive/15 text-destructive",
			},
			size: {
				xs: "px-1.5 py-px text-xs",
				sm: "px-2 py-0.5 text-xs",
			},
		},
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
	export type BadgeTone = VariantProps<typeof badgeVariants>["tone"];
	export type BadgeSize = VariantProps<typeof badgeVariants>["size"];
</script>

<script lang="ts">
	import type { HTMLAnchorAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "@nervekit/workbench-ui/core/utils";

	let {
		ref = $bindable(null),
		href,
		class: className,
		variant,
		tone,
		size,
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & {
		variant?: BadgeVariant;
		tone?: BadgeTone;
		size?: BadgeSize;
	} = $props();
</script>

<svelte:element
	this={href ? "a" : "span"}
	bind:this={ref}
	data-slot="badge"
	{href}
	class={cn(badgeVariants({ variant, tone, size }), className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
