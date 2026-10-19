<script lang="ts">
// The one voice-input mic button, shared by the prompt composer and ask_user
// answers so the two cannot drift. Owners keep their own disabled/title logic.
import Mic from "@lucide/svelte/icons/mic";
import Square from "@lucide/svelte/icons/square";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";

type Props = {
  recording: boolean;
  transcribing: boolean;
  disabled?: boolean;
  title?: string;
  /** Accessible label for the idle state; recording/transcribing are fixed. */
  idleLabel: string;
  shortcutAria?: string;
  /** Toolbar placement: outline button at the small control height. */
  toolbar?: boolean;
  onToggle: () => void;
  /** Right-click while recording or transcribing. */
  onContextMenu: (event: MouseEvent) => void;
};

let {
  recording,
  transcribing,
  disabled = false,
  title,
  idleLabel,
  shortcutAria,
  toolbar = false,
  onToggle,
  onContextMenu,
}: Props = $props();
</script>

<Button
  variant={recording ? "destructive" : "outline"}
  size="icon"
  class={recording && !toolbar
    ? "inset-ring-1 inset-ring-destructive/28"
    : undefined}
  type="button"
  {disabled}
  onclick={onToggle}
  oncontextmenu={onContextMenu}
  aria-label={transcribing
    ? "Cancel transcription"
    : recording
      ? "Stop recording; right-click to cancel"
      : idleLabel}
  aria-keyshortcuts={shortcutAria}
  {title}
>
  {#if transcribing}
    <X />
  {:else if recording}
    <Square />
  {:else}
    <Mic />
  {/if}
</Button>
