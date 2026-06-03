<script lang="ts">
	import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel = "Confirm",
		cancelLabel = "Cancel",
		destructive = false,
		class: className,
		onConfirm,
		onCancel,
		onOpenChange,
	}: {
		open?: boolean;
		title: string;
		description?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		destructive?: boolean;
		class?: string;
		onConfirm?: () => void;
		onCancel?: () => void;
		onOpenChange?: (open: boolean) => void;
	} = $props();
</script>

<AlertDialog.Root bind:open {onOpenChange}>
	<AlertDialog.Content class={className}>
		<AlertDialog.Header>
			<AlertDialog.Title>{title}</AlertDialog.Title>
			{#if description}
				<AlertDialog.Description>{description}</AlertDialog.Description>
			{/if}
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => onCancel?.()}>{cancelLabel}</AlertDialog.Cancel>
			<AlertDialog.Action
				variant={destructive ? "destructive" : "default"}
				onclick={() => onConfirm?.()}
			>
				{confirmLabel}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
