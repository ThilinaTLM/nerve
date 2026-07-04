<script lang="ts">
  import type { SandboxToolCallSummary } from "@nervekit/shared";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import type { StatusTone } from "@nervekit/ui/components/ui/status-dot";

  let { toolCall }: { toolCall: SandboxToolCallSummary } = $props();

  const tone = $derived<StatusTone>(
    toolCall.status === "completed"
      ? "good"
      : toolCall.status === "failed"
        ? "danger"
        : toolCall.status === "cancelled"
          ? "neutral"
          : toolCall.status === "waiting_for_approval"
            ? "warn"
            : "running",
  );

  const argsText = $derived(
    toolCall.displayArgs !== undefined
      ? typeof toolCall.displayArgs === "string"
        ? toolCall.displayArgs
        : JSON.stringify(toolCall.displayArgs)
      : undefined,
  );
</script>

<div class="rounded-md border bg-card p-2.5">
  <div class="flex items-center gap-2">
    <StatusDot
      {tone}
      pulse={toolCall.status === "started" || toolCall.status === "requested"}
    />
    <span class="font-mono text-xs font-medium">{toolCall.toolName}</span>
    <span class="text-xs text-muted-foreground capitalize">
      {toolCall.status.replace(/_/g, " ")}
    </span>
  </div>
  {#if argsText}
    <p class="mt-1 truncate font-mono text-xs text-muted-foreground">{argsText}</p>
  {/if}
  {#if toolCall.summary}
    <p class="mt-1 text-xs text-muted-foreground">{toolCall.summary}</p>
  {/if}
  {#if toolCall.error}
    <p class="mt-1 rounded bg-destructive/10 p-1.5 text-xs text-destructive">
      {toolCall.error.code}: {toolCall.error.message}
    </p>
  {/if}
</div>
