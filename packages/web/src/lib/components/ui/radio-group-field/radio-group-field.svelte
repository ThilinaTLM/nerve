<script lang="ts" module>
	export type RadioItem = {
		value: string;
		label: string;
		detail?: string;
		disabled?: boolean;
	};
</script>

<script lang="ts">
	import * as RadioGroup from "$lib/components/ui/radio-group/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { cn } from "$lib/utils.js";

	let {
		items = [],
		value = $bindable(""),
		orientation = "vertical",
		ariaLabel,
		disabled = false,
		class: className,
		onValueChange,
	}: {
		items?: RadioItem[];
		value?: string;
		orientation?: "horizontal" | "vertical";
		ariaLabel?: string;
		disabled?: boolean;
		class?: string;
		onValueChange?: (value: string) => void;
	} = $props();
</script>

<RadioGroup.Root
	bind:value
	{orientation}
	{disabled}
	aria-label={ariaLabel}
	{onValueChange}
	class={cn(
		"grid gap-2",
		orientation === "horizontal" && "grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]",
		className
	)}
>
	{#each items as item (item.value)}
		<Label
			class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-input/30 p-3 transition-colors hover:bg-accent/50 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-accent"
		>
			<RadioGroup.Item value={item.value} disabled={item.disabled} class="mt-0.5" />
			<span class="grid min-w-0 gap-0.5">
				<span class="text-sm font-medium leading-tight">{item.label}</span>
				{#if item.detail}
					<span class="text-xs leading-snug text-muted-foreground">{item.detail}</span>
				{/if}
			</span>
		</Label>
	{/each}
</RadioGroup.Root>
