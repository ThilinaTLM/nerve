<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const statusDotVariants = tv({
		base: "inline-block flex-none rounded-full",
		variants: {
			tone: {
				neutral: "bg-muted-foreground border-muted-foreground",
				accent: "bg-foreground border-foreground",
				running: "bg-info border-info",
				good: "bg-success border-success",
				warn: "bg-warning border-warning",
				danger: "bg-destructive border-destructive",
			},
			size: {
				xs: "size-[0.42rem]",
				sm: "size-2",
				md: "size-2.5",
			},
			variant: {
				solid: "",
				outline: "border-[1.5px] bg-transparent!",
			},
		},
		defaultVariants: {
			tone: "neutral",
			size: "sm",
			variant: "solid",
		},
	});

	export type StatusTone = NonNullable<VariantProps<typeof statusDotVariants>["tone"]>;
	export type StatusDotSize = NonNullable<VariantProps<typeof statusDotVariants>["size"]>;
	export type StatusDotVariant = NonNullable<VariantProps<typeof statusDotVariants>["variant"]>;
</script>

<script lang="ts">
	import { cn } from "@nervekit/shared-ui/core/utils";

	let {
		tone = "neutral",
		size = "sm",
		variant = "solid",
		pulse = false,
		label,
		class: className,
	}: {
		tone?: StatusTone;
		size?: StatusDotSize;
		variant?: StatusDotVariant;
		pulse?: boolean;
		label?: string;
		class?: string;
	} = $props();
</script>

<span
	class={cn(statusDotVariants({ tone, size, variant }), pulse && "status-pulse", className)}
	aria-label={label}
	aria-hidden={label ? undefined : "true"}
></span>
