<script lang="ts">
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import { notifyCopyResult } from "@nervekit/ui-kit/browser/notifications";
import type { TranscriptItem } from "../state/transcript-types";

type ThinkingGroupItem = Pick<
  TranscriptItem,
  "id" | "text" | "redacted" | "live" | "done"
>;

type Props = {
  /** One or more consecutive thinking blocks rendered as a single group. */
  items: ThinkingGroupItem[];
};

let { items }: Props = $props();
</script>

<div class="thinking-group">
  <div class="thinking-content">
    {#each items as item, index (item.id ?? index)}
      {@const itemLive = Boolean(item.live && !item.done)}
      <div class="thinking-step" class:step-live={itemLive}>
        {#if item.redacted && !item.text}
          <p class="redacted" class:live-caret={itemLive}>
            Provider returned redacted thinking.
          </p>
        {:else}
          <Markdown
            text={item.text}
            streaming={itemLive}
            reveal
            caret={itemLive}
            onCopy={notifyCopyResult}
          />
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
.thinking-group {
  margin: 0;
  color: var(--muted-foreground);
  font-size: var(--text-sm);
  line-height: 1.55;
}

.thinking-content {
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

.redacted.live-caret::after {
  content: "";
  display: inline-block;
  width: 0.42em;
  height: 0.42em;
  margin-left: 0.3em;
  border-radius: 9999px;
  background: var(--primary);
  vertical-align: 0.1em;
  animation: stream-caret-breathe 1.1s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .redacted.live-caret::after {
    animation: none;
    opacity: 0.7;
  }
}

.redacted {
  margin: 0;
  color: var(--muted-foreground);
}
</style>
