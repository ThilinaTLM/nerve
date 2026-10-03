<script lang="ts">
import type { StreamingFadeTracker } from "@nervekit/ui-kit/scheduling/streaming-fade";
import { fadeAge } from "../../components/composites/streaming-text/fade-age.js";
import {
  MARK_CODE,
  MARK_DEL,
  MARK_EM,
  MARK_LINK,
  MARK_STRONG,
  type InlineToken,
  tokenizeStreamingTail,
} from "./streaming-inline.js";

type Props = {
  /** Revealed source; the tail is `source.slice(from)`. */
  source: string;
  from: number;
  /** Already updated by the owner with `source` before this renders. */
  tracker: StreamingFadeTracker;
  preserveLineBreaks?: boolean;
  caret?: boolean;
};

let {
  source,
  from,
  tracker,
  preserveLineBreaks = false,
  caret = false,
}: Props = $props();

const SOFT_BREAK = "\n";
const blocks = $derived(tokenizeStreamingTail(source, from));
// Captured per render so every run uses one consistent clock reading.
const now = $derived.by(() => {
  void source;
  return performance.now();
});

function segments(start: number, end: number) {
  return tracker.segments(start, end, now);
}

function lastIndex(items: readonly unknown[]): number {
  return items.length - 1;
}
</script>

{#snippet caretDot()}<span
    class="stream-caret ml-[0.3em] inline-block size-[0.42em] rounded-full bg-primary align-[0.1em]"
    aria-hidden="true"
  ></span>{/snippet}

{#snippet text(
  start: number,
  end: number,
)}{#each segments(start, end) as segment (segment.start)}{#if segment.fresh}<span
        class="stream-fresh"
        use:fadeAge={segment.ageMs}
        >{source.slice(segment.start, segment.end)}</span
      >{:else}{source.slice(segment.start, segment.end)}{/if}{/each}{/snippet}

<!-- Tail links are placeholder anchors: the destination is still streaming
     and the link becomes navigable in the final render. -->
{#snippet marked(
  marks: number,
  start: number,
  end: number,
)}{#if marks & MARK_LINK}<!-- svelte-ignore a11y_missing_attribute --><a
      >{@render marked(marks & ~MARK_LINK, start, end)}</a
    >{:else if marks & MARK_STRONG}<strong
      >{@render marked(marks & ~MARK_STRONG, start, end)}</strong
    >{:else if marks & MARK_EM}<em
      >{@render marked(marks & ~MARK_EM, start, end)}</em
    >{:else if marks & MARK_DEL}<del
      >{@render marked(marks & ~MARK_DEL, start, end)}</del
    >{:else if marks & MARK_CODE}<code
      >{@render marked(marks & ~MARK_CODE, start, end)}</code
    >{:else}{@render text(start, end)}{/if}{/snippet}

{#snippet inline(
  tokens: InlineToken[],
  withCaret: boolean,
)}{#each tokens as token, index (index)}{#if token.kind === "break"}{#if preserveLineBreaks}<br
        />{:else}{SOFT_BREAK}{/if}{:else}{@render marked(
        token.marks,
        token.start,
        token.end,
      )}{/if}{/each}{#if withCaret}{@render caretDot()}{/if}{/snippet}

{#each blocks as block, blockIndex (blockIndex)}
  {@const withCaret = caret && blockIndex === lastIndex(blocks)}
  {#if block.kind === "paragraph"}
    <p>{@render inline(block.inline, withCaret)}</p>
  {:else if block.kind === "heading"}
    <svelte:element this={`h${block.level}`}
      >{@render inline(block.inline, withCaret)}</svelte:element
    >
  {:else if block.kind === "list"}
    {#if block.ordered}
      <ol start={block.start === 1 ? undefined : block.start}>
        {#each block.items as item, itemIndex (itemIndex)}
          <li>
            {@render inline(
              item,
              withCaret && itemIndex === lastIndex(block.items),
            )}
          </li>
        {/each}
      </ol>
    {:else}
      <ul>
        {#each block.items as item, itemIndex (itemIndex)}
          <li>
            {@render inline(
              item,
              withCaret && itemIndex === lastIndex(block.items),
            )}
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <span class="whitespace-pre-wrap break-words"
      >{@render text(
        block.start,
        block.end,
      )}{#if withCaret}{@render caretDot()}{/if}</span
    >
  {/if}
{/each}
{#if caret && blocks.length === 0}{@render caretDot()}{/if}

<style>
.stream-caret {
  animation: stream-caret-breathe 1.1s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .stream-caret {
    animation: none;
    opacity: 0.7;
  }
}
</style>
