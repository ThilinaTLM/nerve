<script lang="ts">
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import type { Snippet } from "svelte";
import { Button } from "@nervekit/workbench-ui/components/ui/button";

type Props = {
  /** When true, render transcript + composer; otherwise render the empty state. */
  open: boolean;
  showScrollButton?: boolean;
  composerHeight?: number;
  onJumpToBottom?: () => void;
  composerWrapRef?: HTMLElement | null;
  transcript: Snippet;
  composer: Snippet;
  empty: Snippet;
  transcriptLabel?: string;
};

let {
  open,
  showScrollButton = false,
  composerHeight = 0,
  onJumpToBottom,
  composerWrapRef = $bindable(),
  transcript,
  composer,
  empty,
  transcriptLabel = "Conversation transcript",
}: Props = $props();
</script>

<section class="conversation-pane">
  {#if open}
    <div
      class="transcript"
      role="log"
      aria-label={transcriptLabel}
      aria-live="polite"
    >
      {@render transcript()}
    </div>

    {#if showScrollButton && composerHeight > 0}
      <div
        class="scroll-bottom-button-wrap"
        style={`bottom: ${composerHeight + 8}px;`}
      >
        <Button
          class="rounded-full"
          variant="secondary"
          size="icon-sm"
          ariaLabel="Scroll to latest"
          title="Scroll to latest"
          onclick={() => onJumpToBottom?.()}
        >
          <ArrowDown size={16} strokeWidth={2.4} />
        </Button>
      </div>
    {/if}

    <div bind:this={composerWrapRef} class="composer-wrap">
      {@render composer()}
    </div>
  {:else}
    {@render empty()}
  {/if}
</section>

<style>
.conversation-pane {
  position: relative;
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
  background: var(--background);
}

.transcript {
  display: grid;
  min-height: 0;
  min-width: 0;
}

.composer-wrap {
  min-width: 0;
}

.scroll-bottom-button-wrap {
  position: absolute;
  right: 1.15rem;
  z-index: 4;
  border-radius: 999px;
  box-shadow: 0 0.35rem 1rem
    color-mix(in oklab, var(--background) 45%, transparent);
}
</style>
