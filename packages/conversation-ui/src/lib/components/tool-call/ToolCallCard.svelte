<script lang="ts">
  import type { ToolCallTranscriptRecord } from "@nervekit/shared";

  let { toolCall }: { toolCall: ToolCallTranscriptRecord } = $props();
</script>

<article class="rounded-lg border bg-card p-3 text-card-foreground shadow-sm">
  <div class="flex items-center justify-between gap-3">
    <div class="font-medium">{toolCall.toolName}</div>
    <div class="text-xs text-muted-foreground">{toolCall.status}</div>
  </div>
  {#if toolCall.error}
    <p class="mt-2 text-sm text-destructive">{toolCall.error}</p>
  {/if}
  {#if toolCall.argsPreview !== undefined}
    <pre class="mt-2 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">{JSON.stringify(toolCall.argsPreview, null, 2)}</pre>
  {/if}
</article>
