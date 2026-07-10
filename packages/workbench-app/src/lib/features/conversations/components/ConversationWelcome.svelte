<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import { ConversationSignal } from "@nervekit/workbench-ui";
  import { Button } from "@nervekit/workbench-ui/components/ui/button";
  import { Kbd } from "@nervekit/workbench-ui/components/ui/kbd";
  import { getShortcutLabel } from "$lib/core/shortcuts/registry";

  let { onNewChat }: { onNewChat: () => void } = $props();

  const newChatShortcut = getShortcutLabel("conversation.new");
</script>

<ConversationSignal
  title="Where should we start?"
  message="Open a project and begin a conversation to explore, plan, and build."
>
  {#snippet footer()}
    <Button class="shadow-sm" size="lg" onclick={onNewChat}>
      <Plus aria-hidden="true" />
      New chat
    </Button>

    {#if newChatShortcut}
      <div class="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>or press</span>
        <Kbd>{newChatShortcut}</Kbd>
      </div>
    {/if}
  {/snippet}
</ConversationSignal>
