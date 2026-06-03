<script lang="ts">
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Square from "@lucide/svelte/icons/square";
  import Terminal from "@lucide/svelte/icons/terminal";
  import type { ProcessRecord } from "../../../api";
  import { shortenPath } from "../../../utils/path";
  import { pulseForStatus, statusTone } from "../../../utils/status";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { StatusDot } from "$lib/components/ui/status-dot";

  type Props = {
    processes?: ProcessRecord[];
    selectedProcess?: ProcessRecord;
    homeDir?: string;
    onOpenProcessOutput?: (id: string) => void;
    onStopProcess?: (id: string) => void;
    onRestartProcess?: (id: string) => void;
  };

  let {
    processes = [],
    selectedProcess,
    homeDir,
    onOpenProcessOutput,
    onStopProcess,
    onRestartProcess,
  }: Props = $props();

  function stopPropagation(event: MouseEvent) {
    event.stopPropagation();
  }
</script>

<header class="section-head">
  <div><Terminal size={14} strokeWidth={2.2} /><strong>Processes</strong></div>
</header>

<div class="row-list process-list">
  {#if processes.length === 0}
    <p class="muted">No managed processes in this project.</p>
  {/if}
  {#each processes as process}
    <div
      class="utility-row process-row"
      class:active={process.id === selectedProcess?.id}
    >
      <button
        class="process-main"
        type="button"
        title={`Open output for ${process.name ?? process.command}`}
        onclick={() => onOpenProcessOutput?.(process.id)}
      >
        <StatusDot tone={statusTone(process.status)} pulse={pulseForStatus(process.status)} />
        <div>
          <strong>{process.name ?? process.command}</strong>
          <span title={process.cwd}>{process.status} · {shortenPath(process.cwd, homeDir)}</span>
        </div>
        <Badge size="xs" tone={statusTone(process.status)}>{process.status}</Badge>
      </button>
      <div class="process-actions" aria-label={`Actions for ${process.name ?? process.command}`}>
        <Button
          size="icon-xs"
          variant="secondary"
          ariaLabel="Restart process"
          title="Restart process"
          onclick={(event) => {
            stopPropagation(event);
            onRestartProcess?.(process.id);
          }}
        >
          <RotateCw size={12} strokeWidth={2.3} />
        </Button>
        <Button
          size="icon-xs"
          variant="destructive"
          ariaLabel="Stop process"
          title="Stop process"
          onclick={(event) => {
            stopPropagation(event);
            onStopProcess?.(process.id);
          }}
        >
          <Square size={12} strokeWidth={2.3} />
        </Button>
      </div>
    </div>
  {/each}
</div>
