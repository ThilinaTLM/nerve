<script lang="ts">
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Square from "@lucide/svelte/icons/square";
  import Terminal from "@lucide/svelte/icons/terminal";
  import type { ProcessLogQueryResponse, ProcessRecord } from "../../api";
  import { shortenPath } from "../../utils/path";
  import { pulseForStatus, statusTone } from "../../utils/status";
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
</script>

<section class="process-output-pane">
  {#if process}
    <div class="process-output-main">
      <ProcessLogTerminal {processLogs} />
    </div>

    <footer class="process-dock">
      <div class="process-summary">
        <span class="process-icon">
          <StatusDot tone={statusTone(process.status)} pulse={pulseForStatus(process.status)} />
          <Terminal size={14} strokeWidth={2.2} />
        </span>
        <div>
          <strong title={process.command}>{title}</strong>
          <span title={process.cwd}>{shortenPath(process.cwd, homeDir)} · {readiness}</span>
        </div>
        <Badge size="xs" tone={statusTone(process.status)}>{process.status}</Badge>
      </div>

      <div class="process-actions">
        <Button size="sm" variant="ghost" onclick={() => onRefresh?.()}>
          <RefreshCw size={13} strokeWidth={2.3} />Refresh
        </Button>
        <Button size="sm" variant="secondary" onclick={() => onRestart?.(process.id)}>
          <RotateCw size={13} strokeWidth={2.3} />Restart
        </Button>
        <Button size="sm" variant="destructive" onclick={() => onStop?.(process.id)}>
          <Square size={13} strokeWidth={2.3} />Stop
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

  .process-output-main {
    display: grid;
    min-height: 0;
    overflow: hidden;
    padding: 0.75rem;
  }

  .process-dock {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.85rem;
    border-top: 1px solid var(--border);
    background: var(--card);
    padding: 0.62rem 0.75rem;
  }

  .process-summary {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
  }

  .process-icon {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    color: var(--muted-foreground);
  }

  .process-summary div {
    display: grid;
    min-width: 0;
    gap: 0.08rem;
  }

  .process-summary strong,
  .process-summary span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .process-summary strong {
    color: var(--foreground);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .process-summary span {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.71875rem;
  }

  .process-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
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

  @media (max-width: 780px) {
    .process-dock {
      grid-template-columns: minmax(0, 1fr);
    }

    .process-actions {
      justify-content: flex-end;
    }
  }
</style>
