<script lang="ts">
  import type { ConversationRenderState } from "../../state/types.js";

  let { state }: { state: ConversationRenderState } = $props();
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
  {#each state.entries as entry (entry.id)}
    <article class="rounded-lg border bg-card p-3 text-card-foreground shadow-sm">
      <div class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {entry.role}
      </div>
      <pre class="whitespace-pre-wrap font-sans text-sm leading-relaxed">{entry.text}</pre>
    </article>
  {/each}
  {#if state.activeRun}
    {#each state.activeRun.turns as turn (turn.turnId)}
      {#each turn.messages as message (message.liveMessageId)}
        <article class="rounded-lg border border-info/30 bg-card p-3 text-card-foreground shadow-sm">
          <div class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            streaming
          </div>
          {#each message.blocks as block (block.contentBlockId)}
            {#if block.kind === 'tool_call_draft'}
              <pre class="whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs">{block.toolName ?? 'tool'} {block.argsText}</pre>
            {:else}
              <pre class="whitespace-pre-wrap font-sans text-sm leading-relaxed">{block.redacted ? '[thinking redacted]' : block.text}</pre>
            {/if}
          {/each}
        </article>
      {/each}
    {/each}
  {/if}
</div>
