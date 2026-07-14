<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { untrack } from "svelte";
import Markdown from "@nervekit/ui-kit/core/components/Markdown.svelte";
import { notifyCopyResult } from "@nervekit/ui-kit/core/notify";
import type { TranscriptItem } from "../../state/transcript-types";

type ThinkingGroupItem = Pick<
  TranscriptItem,
  "id" | "text" | "redacted" | "live" | "done"
>;

type Props = {
  /** One or more consecutive thinking blocks rendered as a single group. */
  items: ThinkingGroupItem[];
};

let { items }: Props = $props();

const live = $derived(items.some((item) => item.live && !item.done));
const allRedactedEmpty = $derived(
  items.length > 0 && items.every((item) => item.redacted && !item.text),
);
const label = $derived(
  allRedactedEmpty ? "Reasoning unavailable" : "Reasoning",
);

// Historical groups mount collapsed. Live groups are forced open, then fold
// as soon as generation completes; completed groups remain user-toggleable.
let expanded = $state(
  untrack(() => items.some((item) => item.live && !item.done)),
);
let previousLive = untrack(() => items.some((item) => item.live && !item.done));

$effect(() => {
  const currentLive = live;
  if (currentLive) expanded = true;
  else if (previousLive) expanded = false;
  previousLive = currentLive;
});
</script>

<div class="thinking-group" class:live>
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
    <span>{label}</span>
    {#if items.length > 1}
      <span class="step-count">· {items.length} steps</span>
    {/if}
    {#if live}<span class="live-label">Thinking…</span>{/if}
  </button>

  {#if expanded}
    <div class="thinking-content">
      {#each items as item, index (item.id ?? index)}
        {@const itemLive = Boolean(item.live && !item.done)}
        <div class="thinking-step" class:step-live={itemLive}>
          {#if item.redacted && !item.text}
            <p class="redacted" class:live-caret={itemLive}>
              Provider returned redacted thinking.
            </p>
          {:else}
            <div class="step-markdown" class:live-caret={itemLive}>
              <Markdown
                text={item.text}
                streaming={itemLive}
                onCopy={notifyCopyResult}
              />
              {#if itemLive && !item.text}<span
                  class="stream-caret"
                  aria-hidden="true"
                ></span>{/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
.thinking-group {
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

.step-count {
  color: var(--muted-foreground);
  font-weight: 500;
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

.thinking-step + .thinking-step {
  margin-top: 0.55rem;
  padding-top: 0.55rem;
  border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
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

.step-markdown.live-caret :global(.markdown > :last-child)::after,
.redacted.live-caret::after,
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
