<script lang="ts" module>
	import type { Component } from "svelte";

	type IconProps = {
		"aria-hidden"?: "true";
		class?: string;
		size?: number;
		strokeWidth?: number;
	};

	export type TabItem = {
		value: string;
		label: string;
		count?: number;
		disabled?: boolean;
		icon?: Component<IconProps>;
		ariaLabel?: string;
		title?: string;
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

	function accessibleLabel(tab: TabItem) {
		const label = tab.ariaLabel ?? tab.label;
		return tab.count ? `${label} (${tab.count})` : label;
	}
</script>

<Tabs.Root bind:value class={cn("tabs-bar-root min-w-0", className)} {onValueChange}>
	<Tabs.List variant="line" aria-label={ariaLabel} class="tabs-bar-list w-full justify-start overflow-x-auto overflow-y-hidden">
		{#each tabs as tab (tab.value)}
			<Tabs.Trigger
				value={tab.value}
				disabled={tab.disabled}
				aria-label={accessibleLabel(tab)}
				title={tab.title ?? accessibleLabel(tab)}
				class={cn("tabs-bar-trigger", tab.icon && "tabs-bar-icon-trigger")}
			>
				{#if tab.icon}
					{@const Icon = tab.icon}
					<Icon size={14} strokeWidth={2.2} aria-hidden="true" />
					<span class="sr-only">{tab.label}</span>
				{:else}
					<span>{tab.label}</span>
				{/if}
				{#if tab.count}
					<span class={cn("tabs-bar-count", tab.icon && "tabs-bar-icon-count")}>{tab.count}</span>
				{/if}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>
</Tabs.Root>
