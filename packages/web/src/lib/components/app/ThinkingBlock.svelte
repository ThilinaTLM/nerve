<script lang="ts">
  import Brain from "@lucide/svelte/icons/brain";
  import Markdown from "../../Markdown.svelte";
  import type { ThinkingBlockItem } from "../../stores/workbench/state.svelte";

  type Props = {
    block: ThinkingBlockItem;
    live?: boolean;
    open?: boolean;
  };

  let { block, live = false, open = true }: Props = $props();
</script>

<details class="thinking-block" {open}>
  <summary>
    <span class="thinking-title">
      <Brain size={13} strokeWidth={2.2} />
      Thinking
      {#if live}<span class="pulse" aria-hidden="true"></span>{/if}
    </span>
    {#if block.redacted}
      <span class="thinking-meta">redacted</span>
    {/if}
  </summary>

  <div class="thinking-body">
    {#if block.redacted && !block.text}
      <p class="redacted">Provider returned redacted thinking.</p>
    {:else}
      <Markdown text={block.text} />
    {/if}
  </div>
</details>

<style>
  .thinking-block {
    margin: 0 0 0.65rem;
    border: 1px solid color-mix(in oklab, var(--border) 72%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--sidebar) 72%, transparent);
    overflow: hidden;
  }

  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.42rem 0.55rem;
    cursor: pointer;
    user-select: none;
    color: var(--muted-foreground);
    font-size: 0.72rem;
    font-weight: 650;
    letter-spacing: 0.02em;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .thinking-title {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .thinking-meta {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--warning);
  }

  .thinking-body {
    border-top: 1px solid color-mix(in oklab, var(--border) 58%, transparent);
    padding: 0.55rem 0.65rem;
    color: color-mix(in oklab, var(--foreground) 82%, var(--muted-foreground));
    font-size: 0.8125rem;
    line-height: 1.55;
  }

  .thinking-body :global(.markdown) {
    font-size: inherit;
  }

  .redacted {
    margin: 0;
    color: var(--muted-foreground);
  }

  .pulse {
    width: 0.42rem;
    height: 0.42rem;
    border-radius: 999px;
    background: var(--warning);
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--warning) 45%, transparent);
    animation: thinking-pulse 1.4s ease-out infinite;
  }

  @keyframes thinking-pulse {
    to {
      box-shadow: 0 0 0 0.45rem transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
    }
  }
</style>
