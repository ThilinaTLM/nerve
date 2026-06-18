<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import { Button } from "$lib/components/ui/button";

  type Props = {
    shortcut?: string;
    shortcutAria?: string;
    onNewConversation?: () => void;
  };

  let { shortcut, shortcutAria, onNewConversation }: Props = $props();
</script>

<Button
  variant="ghost"
  size="icon-sm"
  ariaLabel="New chat"
  aria-keyshortcuts={shortcutAria}
  title={shortcut ? `New chat (${shortcut})` : "New chat"}
  onclick={onNewConversation}
>
  <Plus size={13} strokeWidth={2.25} />
</Button>
