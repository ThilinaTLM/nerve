<script lang="ts">
import type { Snippet } from "svelte";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
let {
  open = $bindable(false),
  conversationId,
  label,
  children,
}: {
  open?: boolean;
  conversationId?: string;
  label: string;
  children?: Snippet;
} = $props();
</script>
<DialogShell
  bind:open
  title={label}
  description="Child conversation transcript"
  class="max-w-4xl"
>
  {#if conversationId && children}<div
      class="h-96 min-h-0"
      data-conversation-id={conversationId}
    >
      {@render children()}
    </div>{/if}
</DialogShell>
