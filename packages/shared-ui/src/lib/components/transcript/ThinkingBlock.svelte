<script lang="ts">
  import Markdown from "@nervekit/shared-ui/core/components/Markdown.svelte";
  import { notifyCopyResult } from "@nervekit/shared-ui/core/notify";

  type ThinkingBlockItem = {
    text: string;
    redacted?: boolean;
  };

  type Props = {
    block: ThinkingBlockItem;
    live?: boolean;
  };

  let { block, live = false }: Props = $props();
</script>

<div class={`thinking-block ${live ? "live" : ""}`}>
  {#if block.redacted && !block.text}
    <p class="redacted">Provider returned redacted thinking.</p>
  {:else}
    <Markdown text={block.text} onCopy={notifyCopyResult} />
    {#if live && !block.text}<span class="stream-caret" aria-hidden="true"></span>{/if}
  {/if}
</div>

<style>
  .thinking-block {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
    font-style: italic;
    line-height: 1.55;
  }

  .thinking-block :global(.markdown) {
    color: inherit;
    font-size: inherit;
  }

  .thinking-block :global(code),
  .thinking-block :global(pre),
  .thinking-block :global(.code-block) {
    font-style: normal;
  }

  .thinking-block :global(p > strong:only-child) {
    font-weight: inherit;
  }

  .thinking-block.live :global(.markdown > :last-child)::after,
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
