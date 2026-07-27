<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import { ConversationSignal } from "@nervekit/workbench-ui";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
import { getShortcutLabel } from "$lib/core/shortcuts/registry";

let {
  onNewChat,
  projectSelected = false,
}: {
  onNewChat: () => void;
  projectSelected?: boolean;
} = $props();

const newChatShortcut = getShortcutLabel("conversation.new");
</script>

<ConversationSignal
  title="Where should we start?"
  message={projectSelected
    ? "Begin a conversation in the selected project to explore, plan, and build."
    : "Select a project from the top header to begin a conversation."}
>
  {#snippet footer()}
    <Button onclick={onNewChat} disabled={!projectSelected}>
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
