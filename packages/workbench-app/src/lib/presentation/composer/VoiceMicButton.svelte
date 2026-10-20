<script lang="ts">
// The one voice-input mic button, shared by the prompt composer and ask_user
// answers so the two cannot drift. Owners keep their own disabled/title logic.
// Recording keeps the mic glyph (tinted, with a pulsing "on air" dot) so it is
// never mistaken for the square run-stop button next to it.
import Mic from "@lucide/svelte/icons/mic";
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
  onToggle,
  onContextMenu,
}: Props = $props();
</script>

<Button
  variant="outline"
  size="icon"
  class={recording
    ? "relative text-destructive hover:text-destructive"
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
  {:else}
    <Mic />
    {#if recording}
      <span
        class="absolute top-1 right-1 size-1.5 rounded-full bg-destructive-solid motion-safe:animate-pulse"
        aria-hidden="true"
      ></span>
    {/if}
  {/if}
</Button>
