<script lang="ts">
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Square from "@lucide/svelte/icons/square";
  import Terminal from "@lucide/svelte/icons/terminal";
  import type { ProcessLogQueryResponse, ProcessRecord } from "$lib/api";
  import { shortenPath } from "$lib/utils/path";
  import { processPulse, processTone } from "$lib/utils/status";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import ProcessLogTerminal from "./ProcessLogTerminal.svelte";

  type Props = {
    process?: ProcessRecord;
    processLogs?: ProcessLogQueryResponse;
    homeDir?: string;
    onRefresh?: () => void;
    onRestart?: (id: string) => void;
    onStop?: (id: string) => void;
  };

  let {
    process,
    processLogs,
    homeDir,
    onRefresh,
    onRestart,
    onStop,
  }: Props = $props();

  const title = $derived(process?.name ?? process?.command ?? "Process output");
  const readiness = $derived(process?.readiness.matched ?? process?.readiness.outcome);
  const tone = $derived(processTone(process?.status));
  const runtimeMeta = $derived(processRuntimeLabel(process));
  const envMeta = $derived(processEnvLabel(process));

  function processRuntimeLabel(record: ProcessRecord | undefined): string | undefined {
    const parts: string[] = [];
    if (record?.runtime?.childPid) parts.push(`pid ${record.runtime.childPid}`);
    if (record?.runtime?.platform) parts.push(record.runtime.platform);
    return parts.length > 0 ? parts.join(" · ") : undefined;
  }

  function processEnvLabel(record: ProcessRecord | undefined): string | undefined {
    const count = record?.envInfo?.keys.length ?? 0;
    return count > 0 ? `env ${count} redacted` : undefined;
  }
</script>

<section class="process-output-pane">
  {#if process}
    <ProcessLogTerminal {processLogs} />

    <footer class="flex items-center gap-2 border-t bg-card px-3 py-1.5">
      <StatusDot {tone} pulse={processPulse(process.status)} />
      <Terminal class="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.2} />
      <div class="flex min-w-0 flex-1 items-baseline gap-2">
        <strong class="truncate text-sm font-semibold text-foreground" title={process.command}>{title}</strong>
        <span class="truncate font-mono text-xs text-muted-foreground" title={process.cwd}>
          {shortenPath(process.cwd, homeDir)} · {readiness}{#if runtimeMeta} · {runtimeMeta}{/if}{#if envMeta} · {envMeta}{/if}
        </span>
      </div>
      <Badge
        size="xs"
        {tone}
        class={tone === "neutral" ? "border-border bg-muted text-muted-foreground" : ""}
      >
        {process.status}
      </Badge>
      <div class="flex shrink-0 items-center gap-0.5">
        <Button size="sm" variant="ghost" class="h-7" onclick={() => onRefresh?.()}>
          <RefreshCw size={13} strokeWidth={2.3} />Refresh
        </Button>
        <Button size="sm" variant="ghost" class="h-7" onclick={() => onRestart?.(process.id)}>
          <RotateCw size={13} strokeWidth={2.3} />Restart
        </Button>
        <Button size="sm" variant="ghost" class="h-7 text-muted-foreground hover:text-destructive" onclick={() => onStop?.(process.id)}>
          <Square size={13} strokeWidth={2.3} />{process.status === "orphaned" ? "Clean up" : "Stop"}
        </Button>
      </div>
    </footer>
  {:else}
    <div class="empty-center">
      <Terminal size={30} strokeWidth={1.7} />
      <p>Process not found.</p>
      <span>The process may have been removed or is no longer available.</span>
    </div>
  {/if}
</section>

<style>
  .process-output-pane {
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr) auto;
    background: var(--background);
  }

  .process-output-pane :global(.log-terminal) {
    min-height: 0;
  }

  .empty-center {
    display: grid;
    place-content: center;
    min-height: 100%;
    gap: 0.35rem;
    color: var(--muted-foreground);
    text-align: center;
  }

  .empty-center :global(svg) {
    color: var(--primary);
    justify-self: center;
  }

  .empty-center p {
    margin: 0.25rem 0 0;
    color: var(--foreground);
  }
</style>
