<script lang="ts">
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import type { Snippet } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";

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
  announcer?: Snippet;
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
  announcer,
}: Props = $props();
</script>

<section class="conversation-pane">
  {#if open}
    <div class="transcript">
      {@render transcript()}
    </div>

    {#if announcer}{@render announcer()}{/if}

    <div
      class="scroll-bottom-button-wrap rounded-full"
      class:is-visible={showScrollButton && composerHeight > 0}
      style={`bottom: ${composerHeight + 8}px;`}
      aria-hidden={!showScrollButton || composerHeight <= 0}
    >
      <Button
        class="rounded-full shadow-sm"
        variant="secondary"
        size="sm"
        ariaLabel="Scroll to latest"
        title="Scroll to latest"
        tabindex={showScrollButton && composerHeight > 0 ? undefined : -1}
        onclick={() => onJumpToBottom?.()}
      >
        <span>Latest</span>
        <ArrowDown size={15} strokeWidth={2.4} aria-hidden="true" />
      </Button>
    </div>

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
  box-shadow: 0 0.35rem 1rem
    color-mix(in oklab, var(--background) 45%, transparent);
  opacity: 0;
  pointer-events: none;
  transform: translateY(0.25rem);
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}

.scroll-bottom-button-wrap.is-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
</style>
