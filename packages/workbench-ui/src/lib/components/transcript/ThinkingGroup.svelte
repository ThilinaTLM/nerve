<script lang="ts">
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
