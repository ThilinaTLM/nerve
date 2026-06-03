<script lang="ts" module>
	export type SelectItem = {
		value: string;
		label: string;
		detail?: string;
		disabled?: boolean;
	};
</script>

<script lang="ts">
	import * as Select from "$lib/components/ui/select/index.js";
	import { cn } from "$lib/utils.js";

	let {
		items = [],
		value = $bindable(""),
		placeholder = "Select…",
		disabled = false,
		ariaLabel,
		class: className,
		triggerClass,
		contentClass,
		onValueChange,
	}: {
		items?: SelectItem[];
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		ariaLabel?: string;
		class?: string;
		triggerClass?: string;
		contentClass?: string;
		onValueChange?: (value: string) => void;
	} = $props();

	const selectedLabel = $derived(items.find((item) => item.value === value)?.label);
</script>

<Select.Root type="single" bind:value {disabled} {onValueChange}>
	<Select.Trigger
		size="sm"
		aria-label={ariaLabel}
		class={cn("w-full min-w-0", triggerClass, className)}
	>
		<span class="truncate">{selectedLabel ?? placeholder}</span>
	</Select.Trigger>
	<Select.Content class={contentClass}>
		{#each items as item (item.value)}
			<Select.Item value={item.value} label={item.label} disabled={item.disabled}>
				<span class="flex min-w-0 flex-col">
					<span class="truncate">{item.label}</span>
					{#if item.detail}
						<span class="truncate text-xs text-muted-foreground">{item.detail}</span>
					{/if}
				</span>
			</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
