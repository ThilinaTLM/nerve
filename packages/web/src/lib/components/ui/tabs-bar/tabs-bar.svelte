<script lang="ts" module>
	export type TabItem = {
		value: string;
		label: string;
		count?: number;
		disabled?: boolean;
	};
</script>

<script lang="ts">
	import * as Tabs from "$lib/components/ui/tabs/index.js";
	import { cn } from "$lib/utils.js";

	let {
		tabs = [],
		value = $bindable(""),
		ariaLabel,
		class: className,
		onValueChange,
	}: {
		tabs?: TabItem[];
		value?: string;
		ariaLabel?: string;
		class?: string;
		onValueChange?: (value: string) => void;
	} = $props();
</script>

<Tabs.Root bind:value class={cn("min-w-0", className)} {onValueChange}>
	<Tabs.List variant="line" aria-label={ariaLabel} class="w-full justify-start overflow-x-auto">
		{#each tabs as tab (tab.value)}
			<Tabs.Trigger value={tab.value} disabled={tab.disabled}>
				<span>{tab.label}</span>
				{#if tab.count}
					<span
						class="ml-1 inline-flex min-w-4 items-center justify-center rounded-full border border-border px-1 font-mono text-[11px] leading-tight"
					>{tab.count}</span>
				{/if}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>
</Tabs.Root>
