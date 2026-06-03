<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const statusDotVariants = tv({
		base: "inline-block flex-none rounded-full",
		variants: {
			tone: {
				neutral: "bg-muted-foreground",
				accent: "bg-foreground",
				running: "bg-info",
				good: "bg-success",
				warn: "bg-warning",
				danger: "bg-destructive",
			},
			size: {
				xs: "size-[0.42rem]",
				sm: "size-2",
				md: "size-2.5",
			},
		},
		defaultVariants: {
			tone: "neutral",
			size: "sm",
		},
	});

	export type StatusTone = NonNullable<VariantProps<typeof statusDotVariants>["tone"]>;
	export type StatusDotSize = NonNullable<VariantProps<typeof statusDotVariants>["size"]>;
</script>

<script lang="ts">
	import { cn } from "$lib/utils.js";

	let {
		tone = "neutral",
		size = "sm",
		pulse = false,
		label,
		class: className,
	}: {
		tone?: StatusTone;
		size?: StatusDotSize;
		pulse?: boolean;
		label?: string;
		class?: string;
	} = $props();
</script>

<span
	class={cn(statusDotVariants({ tone, size }), pulse && "status-pulse", className)}
	aria-label={label}
	aria-hidden={label ? undefined : "true"}
></span>

<style>
	.status-pulse {
		animation: status-pulse 1.5s ease-in-out infinite;
	}

	@keyframes status-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 45%, transparent);
		}
		50% {
			box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 0%, transparent);
		}
	}
</style>
