<script lang="ts">
import type { Snippet } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/utils";

let {
  open = $bindable(false),
  title,
  description,
  size = "sm",
  saveLabel,
  saveTourId,
  busy = false,
  error,
  errorClass,
  bodyClass,
  bodyTourId,
  closeOnInteractOutside = true,
  onSave,
  children,
}: {
  open?: boolean;
  title: string;
  description?: string;
  size?: "sm" | "md";
  saveLabel: string;
  saveTourId?: string;
  busy?: boolean;
  error?: string;
  errorClass?: string;
  bodyClass?: string;
  bodyTourId?: string;
  closeOnInteractOutside?: boolean;
  onSave: () => void;
  children: Snippet;
} = $props();
</script>

<Dialog bind:open {title} {description} {size} {closeOnInteractOutside}>
  <div class={cn("grid gap-3", bodyClass)} data-tour-id={bodyTourId}>
    {@render children()}
    {#if error}
      <p class={cn("text-xs text-destructive", errorClass)}>{error}</p>
    {/if}
  </div>
  {#snippet footer()}
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onclick={() => (open = false)}>Cancel</Button
    >
    <Button
      size="sm"
      disabled={busy}
      data-tour-id={saveTourId}
      onclick={() => onSave()}
    >
      {#if busy}<Spinner class="size-3.5" />{/if}
      {saveLabel}
    </Button>
  {/snippet}
</Dialog>
