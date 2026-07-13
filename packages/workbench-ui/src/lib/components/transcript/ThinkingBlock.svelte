<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { untrack } from "svelte";
import Markdown from "@nervekit/ui-kit/core/components/Markdown.svelte";
import { notifyCopyResult } from "@nervekit/ui-kit/core/notify";

type ThinkingBlockItem = {
  text: string;
  redacted?: boolean;
};

type Props = {
  block: ThinkingBlockItem;
  live?: boolean;
};

let { block, live = false }: Props = $props();
// Historical blocks mount collapsed. Live blocks are forced open, then fold
// as soon as generation completes; completed blocks remain user-toggleable.
let expanded = $state(untrack(() => live));
let previousLive = untrack(() => live);

$effect(() => {
  const currentLive = live;
  if (currentLive) expanded = true;
  else if (previousLive) expanded = false;
  previousLive = currentLive;
});
</script>

<div class="thinking-block" class:live>
  <button
    class="thinking-toggle"
    type="button"
    aria-expanded={expanded}
    disabled={live}
    onclick={() => (expanded = !expanded)}
  >
    {#if expanded}
      <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
    {:else}
      <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
    {/if}
    <span
      >{block.redacted && !block.text
        ? "Reasoning unavailable"
        : "Reasoning"}</span
    >
    {#if live}<span class="live-label">Thinking…</span>{/if}
  </button>

  {#if expanded}
    <div class="thinking-content">
      {#if block.redacted && !block.text}
        <p class="redacted">Provider returned redacted thinking.</p>
      {:else}
        <Markdown
          text={block.text}
          streaming={live}
          onCopy={notifyCopyResult}
        />
        {#if live && !block.text}<span class="stream-caret" aria-hidden="true"
          ></span>{/if}
      {/if}
    </div>
  {/if}
</div>

<style>
.thinking-block {
  margin: 0;
  color: var(--muted-foreground);
  font-size: var(--text-sm);
  line-height: 1.55;
}

.thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted-foreground);
  padding: 0.2rem 0.3rem;
  font-size: var(--text-xs);
  font-weight: 600;
  cursor: pointer;
}

.thinking-toggle:disabled {
  cursor: default;
}

.thinking-toggle:not(:disabled):hover,
.thinking-toggle:focus-visible {
  background: var(--muted);
  color: var(--foreground);
  outline: none;
}

.thinking-toggle:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--ring) 45%, transparent);
}

.live-label {
  color: var(--primary);
  font-weight: 500;
}

.thinking-content {
  margin-top: 0.35rem;
  padding-left: 0.35rem;
  font-style: italic;
}

.thinking-content :global(.markdown) {
  color: inherit;
  font-size: inherit;
}

.thinking-content :global(code),
.thinking-content :global(pre),
.thinking-content :global(.code-block) {
  font-style: normal;
}

.thinking-content :global(p > strong:only-child) {
  font-weight: inherit;
}

.thinking-block.live .thinking-content :global(.markdown > :last-child)::after,
.thinking-block.live .redacted::after,
.stream-caret {
  content: "";
  display: inline-block;
  width: 0.42rem;
  height: 1em;
  margin-left: 0.3rem;
  margin-top: 0.18rem;
  background: var(--primary);
  vertical-align: text-bottom;
  animation: pulse 1s steps(2, start) infinite;
}

.redacted {
  margin: 0;
  color: var(--muted-foreground);
}
</style>
