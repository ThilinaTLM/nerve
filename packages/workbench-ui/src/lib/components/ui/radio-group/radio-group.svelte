<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
	import { cn } from "@nervekit/workbench-ui/core/utils";

	let {
		ref = $bindable(null),
		class: className,
		value = $bindable(""),
		...restProps
	}: RadioGroupPrimitive.RootProps = $props();
</script>

<RadioGroupPrimitive.Root
	bind:ref
	bind:value
	data-slot="radio-group"
	class={cn("grid gap-3 w-full", className)}
	{...restProps}
/>
