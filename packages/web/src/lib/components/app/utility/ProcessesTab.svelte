<script lang="ts">
  import Copy from "lucide-svelte/icons/copy";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";
  import RotateCw from "lucide-svelte/icons/rotate-cw";
  import Square from "lucide-svelte/icons/square";
  import Terminal from "lucide-svelte/icons/terminal";
  import { toast } from "svelte-sonner";
  import type { ProcessLogQueryResponse, ProcessRecord } from "../../../api";
  import { pulseForStatus, statusTone } from "../../../utils/status";
  import Badge from "../../ui/Badge.svelte";
  import Button from "../../ui/Button.svelte";
  import ContextMenu, { type ContextMenuItem } from "../../ui/ContextMenu.svelte";
  import StatusDot from "../../ui/StatusDot.svelte";
  import ProcessLogTerminal from "./ProcessLogTerminal.svelte";

  type Props = {
    processes?: ProcessRecord[];
    selectedProcess?: ProcessRecord;
    processLogs?: ProcessLogQueryResponse;
    onSelectProcess?: (id: string) => void;
    onRefreshProcessLogs?: () => void;
    onStopProcess?: (id: string) => void;
    onRestartProcess?: (id: string) => void;
  };

  let {
    processes = [],
    selectedProcess,
    processLogs,
    onSelectProcess,
    onRefreshProcessLogs,
    onStopProcess,
    onRestartProcess,
  }: Props = $props();

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard?.writeText(text);
      toast.success(`Copied ${label}`);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  function processMenu(process: ProcessRecord): ContextMenuItem[] {
    return [
      { label: "Restart", icon: RotateCw, onSelect: () => onRestartProcess?.(process.id) },
      { label: "Stop", icon: Square, destructive: true, onSelect: () => onStopProcess?.(process.id) },
      { type: "separator" },
      {
        label: "Refresh logs",
        icon: RefreshCw,
        onSelect: () => {
          onSelectProcess?.(process.id);
          onRefreshProcessLogs?.();
        },
      },
      { label: "Copy command", icon: Copy, onSelect: () => void copyToClipboard(process.command, "command") },
      { label: "Copy working directory", icon: Copy, onSelect: () => void copyToClipboard(process.cwd, "working directory") },
    ];
  }
</script>

<header class="section-head">
  <div><Terminal size={14} strokeWidth={2.2} /><strong>Processes</strong></div>
  <Button size="sm" variant="ghost" onclick={onRefreshProcessLogs}>
    <RefreshCw size={12} strokeWidth={2.2} />Refresh
  </Button>
</header>

<div class="row-list process-list">
  {#if processes.length === 0}
    <p class="muted">No managed processes.</p>
  {/if}
  {#each processes as process}
    <ContextMenu items={processMenu(process)}>
      <button
        class="utility-row process-row"
        class:active={process.id === selectedProcess?.id}
        type="button"
        onclick={() => onSelectProcess?.(process.id)}
      >
        <StatusDot tone={statusTone(process.status)} pulse={pulseForStatus(process.status)} />
        <div>
          <strong>{process.name ?? process.command}</strong>
          <span>{process.status} · {process.cwd}</span>
        </div>
        <Badge size="xs" tone={statusTone(process.status)}>{process.status}</Badge>
      </button>
    </ContextMenu>
  {/each}
</div>

{#if selectedProcess}
  <section class="process-detail">
    <div class="process-title">
      <StatusDot tone={statusTone(selectedProcess.status)} pulse={pulseForStatus(selectedProcess.status)} />
      <strong>{selectedProcess.name ?? selectedProcess.command}</strong>
    </div>
    <small title={selectedProcess.command}>{selectedProcess.command}</small>
    <small title={selectedProcess.cwd}>{selectedProcess.cwd}</small>
    <div class="row-actions">
      <Button size="sm" variant="secondary" onclick={() => onRestartProcess?.(selectedProcess.id)}>
        <RotateCw size={12} strokeWidth={2.3} />Restart
      </Button>
      <Button size="sm" variant="danger" onclick={() => onStopProcess?.(selectedProcess.id)}>
        <Square size={12} strokeWidth={2.3} />Stop
      </Button>
    </div>
  </section>
  <ProcessLogTerminal {processLogs} />
{/if}
