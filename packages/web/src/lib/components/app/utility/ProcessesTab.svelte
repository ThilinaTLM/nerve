<script lang="ts">
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Square from "@lucide/svelte/icons/square";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { ProcessRecord } from "../../../api";
  import { shortenPath } from "../../../utils/path";
  import { processPulse, processTone } from "../../../utils/status";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import ConfirmDialog from "$lib/components/ui/confirm-dialog";
  import { StatusDot } from "$lib/components/ui/status-dot";

  type Props = {
    processes?: ProcessRecord[];
    selectedProcess?: ProcessRecord;
    homeDir?: string;
    onOpenProcessOutput?: (id: string) => void;
    onStopProcess?: (id: string) => void;
    onRestartProcess?: (id: string) => void;
    onRemoveProcess?: (id: string) => void;
    onPruneProcesses?: () => void;
  };

  let {
    processes = [],
    selectedProcess,
    homeDir,
    onOpenProcessOutput,
    onStopProcess,
    onRestartProcess,
    onRemoveProcess,
    onPruneProcesses,
  }: Props = $props();

  const ACTIVE = new Set(["starting", "running", "ready", "stopping"]);
  const isActive = (process: ProcessRecord) => ACTIVE.has(process.status);

  const running = $derived(processes.filter(isActive));
  const stopped = $derived(processes.filter((process) => !isActive(process)));

  let confirmPruneOpen = $state(false);

  function stopPropagation(event: MouseEvent) {
    event.stopPropagation();
  }
</script>

{#snippet statusBadge(status: string)}
  {@const tone = processTone(status)}
  <Badge
    {tone}
    size="xs"
    class={tone === "neutral" ? "border-border bg-muted text-muted-foreground" : ""}
  >
    {status}
  </Badge>
{/snippet}

{#snippet processRow(process: ProcessRecord)}
  <div
    class="group/row flex items-center gap-1 rounded-md border bg-card pr-1.5 transition-colors hover:border-ring/40 data-[active=true]:border-primary/60 data-[active=true]:bg-muted/40"
    data-active={process.id === selectedProcess?.id}
  >
    <button
      class="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left"
      type="button"
      title={process.command}
      onclick={() => onOpenProcessOutput?.(process.id)}
    >
      <StatusDot tone={processTone(process.status)} pulse={processPulse(process.status)} />
      <div class="min-w-0 flex-1">
        <div class="truncate font-mono text-xs text-foreground">{process.command}</div>
        <div class="truncate text-xs text-muted-foreground" title={process.cwd}>
          {process.name ? `${process.name} · ` : ""}{shortenPath(process.cwd, homeDir)}
        </div>
      </div>
      {@render statusBadge(process.status)}
    </button>
    <div class="flex shrink-0 items-center gap-0.5">
      {#if isActive(process)}
        <Button
          size="icon-xs"
          variant="ghost"
          ariaLabel="Stop process"
          title="Stop process"
          class="text-muted-foreground hover:text-destructive"
          onclick={(event) => {
            stopPropagation(event);
            onStopProcess?.(process.id);
          }}
        >
          <Square size={12} strokeWidth={2.3} />
        </Button>
      {:else}
        <Button
          size="icon-xs"
          variant="ghost"
          ariaLabel="Restart process"
          title="Restart process"
          class="text-muted-foreground hover:text-foreground"
          onclick={(event) => {
            stopPropagation(event);
            onRestartProcess?.(process.id);
          }}
        >
          <RotateCw size={12} strokeWidth={2.3} />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          ariaLabel="Remove process"
          title="Remove process"
          class="text-muted-foreground hover:text-destructive"
          onclick={(event) => {
            stopPropagation(event);
            onRemoveProcess?.(process.id);
          }}
        >
          <Trash2 size={12} strokeWidth={2.3} />
        </Button>
      {/if}
    </div>
  </div>
{/snippet}

<div class="flex flex-col gap-3 p-2">
  {#if processes.length === 0}
    <p class="px-1 py-6 text-center text-xs text-muted-foreground">
      No managed processes in this project.
    </p>
  {/if}

  {#if running.length}
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <StatusDot tone="good" pulse />
        <span>Running</span>
        <span class="font-mono">{running.length}</span>
      </div>
      {#each running as process (process.id)}
        {@render processRow(process)}
      {/each}
    </div>
  {/if}

  {#if stopped.length}
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <StatusDot tone="neutral" />
        <span>Stopped</span>
        <span class="font-mono">{stopped.length}</span>
        <Button
          size="xs"
          variant="ghost"
          class="ml-auto h-6 gap-1 text-muted-foreground hover:text-destructive"
          onclick={() => (confirmPruneOpen = true)}
        >
          <Trash2 size={12} strokeWidth={2.3} />Prune
        </Button>
      </div>
      {#each stopped as process (process.id)}
        {@render processRow(process)}
      {/each}
    </div>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmPruneOpen}
  destructive
  title="Prune stopped processes"
  description={`This removes ${stopped.length} stopped ${stopped.length === 1 ? "process" : "processes"} and their captured logs. This can't be undone.`}
  confirmLabel="Prune"
  onConfirm={() => onPruneProcesses?.()}
/>
