<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Hammer from "@lucide/svelte/icons/hammer";
  import MessageSquareText from "@lucide/svelte/icons/message-square-text";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import Markdown from "../../Markdown.svelte";
  import type { LiveAssistantBlock, LiveRunState } from "../../stores/workbench/state.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";

  type Props = { liveRun?: LiveRunState };
  let { liveRun }: Props = $props();

  const blocks = $derived(liveRun?.blocks ?? []);
  const hasBlocks = $derived(blocks.length > 0);

  function argsPreview(block: Extract<LiveAssistantBlock, { kind: "tool_call_draft" }>): string {
    if (block.args) return JSON.stringify(block.args, null, 2);
    return block.argsText.trim() || "Waiting for arguments…";
  }
</script>

{#if hasBlocks}
  <article class="live-run" aria-label="Live agent activity">
    <div class="live-head">
      <span class="live-dot" aria-hidden="true"></span>
      <span>Agent is working</span>
    </div>

    <div class="activity-list">
      {#each blocks as block (block.contentIndex)}
        {#if block.kind === "thinking"}
          <section class="activity-item thinking-item">
            <ThinkingBlock block={{ text: block.text, redacted: block.redacted }} live={!block.done} open />
          </section>
        {:else if block.kind === "text"}
          <section class="activity-item text-item">
            <div class="activity-label">
              <MessageSquareText size={13} strokeWidth={2.2} />
              <span>Assistant</span>
              {#if !block.done}<span class="mini-caret" aria-hidden="true"></span>{/if}
            </div>
            <div class="assistant-stream">
              <Markdown text={block.text} />
            </div>
          </section>
        {:else}
          <section class="activity-item tool-draft">
            <div class="activity-label">
              <Hammer size={13} strokeWidth={2.2} />
              <span>Preparing tool call</span>
              {#if block.toolName}<code>{block.toolName}</code>{/if}
              {#if block.done}<span class="submitted">submitted</span>{/if}
            </div>
            <pre>{argsPreview(block)}</pre>
          </section>
        {/if}
      {/each}
    </div>
  </article>
{:else if liveRun?.assistantStarted}
  <article class="live-run compact" aria-label="Live agent activity">
    <div class="live-head">
      <span class="live-dot" aria-hidden="true"></span>
      <Sparkles size={14} strokeWidth={2.1} />
      <span>Waiting for first token…</span>
      <ChevronRight size={13} strokeWidth={2.2} />
    </div>
  </article>
{/if}

<style>
  .live-run {
    display: grid;
    gap: 0.65rem;
    width: 100%;
    padding: 0.75rem;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 58%, transparent);
    background:
      linear-gradient(90deg, color-mix(in oklab, var(--primary) 8%, transparent), transparent 42%),
      color-mix(in oklab, var(--background) 94%, var(--sidebar));
  }

  .live-run.compact {
    padding-block: 0.7rem;
  }

  .live-head,
  .activity-label {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    color: var(--muted-foreground);
    font-size: 0.75rem;
    font-weight: 650;
  }

  .live-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: var(--primary);
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--primary) 45%, transparent);
    animation: live-pulse 1.35s ease-out infinite;
  }

  .activity-list {
    display: grid;
    gap: 0.6rem;
    padding-left: 0.55rem;
    border-left: 1px solid color-mix(in oklab, var(--border) 65%, transparent);
  }

  .activity-item {
    min-width: 0;
  }

  .assistant-stream {
    margin-top: 0.4rem;
    padding: 0.65rem 0.7rem;
    border: 1px solid color-mix(in oklab, var(--border) 68%, transparent);
    border-radius: var(--radius-sm);
    background: var(--background);
  }

  .assistant-stream :global(.markdown) {
    font-size: 0.875rem;
  }

  code {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--sidebar);
    color: var(--foreground);
    padding: 0.1rem 0.42rem;
    font-family: var(--font-mono);
    font-size: 0.68rem;
  }

  .submitted {
    color: var(--success, var(--primary));
    font-size: 0.68rem;
  }

  pre {
    margin: 0.4rem 0 0;
    max-height: 10rem;
    overflow: auto;
    border: 1px solid color-mix(in oklab, var(--border) 68%, transparent);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: 0.55rem 0.65rem;
    font-family: var(--font-mono);
    font-size: 0.74rem;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .mini-caret {
    width: 0.4rem;
    height: 0.85rem;
    background: var(--primary);
    opacity: 0.75;
    animation: caret-blink 1s steps(2, start) infinite;
  }

  @keyframes live-pulse {
    to {
      box-shadow: 0 0 0 0.5rem transparent;
    }
  }

  @keyframes caret-blink {
    50% {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .live-dot,
    .mini-caret {
      animation: none;
    }
  }
</style>
