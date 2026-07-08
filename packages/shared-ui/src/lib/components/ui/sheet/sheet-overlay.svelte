<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { cn } from "@nervekit/shared-ui/core/utils";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DialogPrimitive.OverlayProps = $props();
</script>

<DialogPrimitive.Overlay
	bind:ref
	data-slot="sheet-overlay"
	class={cn(
		"data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 bg-sidebar/70 duration-200 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 isolate z-50",
		className
	)}
	{...restProps}
/>
