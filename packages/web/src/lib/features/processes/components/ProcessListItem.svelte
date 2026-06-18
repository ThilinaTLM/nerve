<script lang="ts">
  import Copy from "@lucide/svelte/icons/copy";
  import Pin from "@lucide/svelte/icons/pin";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Square from "@lucide/svelte/icons/square";
  import Terminal from "@lucide/svelte/icons/terminal";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type { ProcessRecord } from "$lib/api";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { processPulse, processTone } from "$lib/core/utils/status";
  import { dateTimeLabel } from "$lib/core/utils/time";

  type Props = {
    process: ProcessRecord;
    selected?: boolean;
    onOpenProcessOutput?: (id: string) => void;
    onStopProcess?: (id: string) => void;
    onRestartProcess?: (id: string) => void;
    onRemoveProcess?: (id: string) => void;
    onPinProcess?: (process: ProcessRecord) => void;
    onCopyCommand?: (command: string) => void;
  };

  let {
    process,
    selected = false,
    onOpenProcessOutput,
    onStopProcess,
    onRestartProcess,
    onRemoveProcess,
    onPinProcess,
    onCopyCommand,
  }: Props = $props();

  const ACTIVE = new Set(["starting", "running", "ready", "stopping"]);
  const isActive = $derived(ACTIVE.has(process.status));
  const envCount = $derived(process.envInfo?.keys.length ?? 0);
  const envSummary = $derived(envCount === 0 ? undefined : `${envCount} redacted ${envCount === 1 ? "var" : "vars"}`);
  const envKeys = $derived(process.envInfo?.keys.join(", "));

  function statusItems(): ContextMenuItem[] {
    if (isActive) {
      return [
        { label: "Restart process", icon: RotateCw, onSelect: () => onRestartProcess?.(process.id) },
        { label: "Stop process", icon: Square, destructive: true, onSelect: () => onStopProcess?.(process.id) },
      ];
    }
    if (process.status === "orphaned") {
      return [
        { label: "Clean up orphan", icon: TriangleAlert, destructive: true, onSelect: () => onStopProcess?.(process.id) },
        { label: "Restart process", icon: RotateCw, onSelect: () => onRestartProcess?.(process.id) },
        { label: "Forget record", icon: Trash2, destructive: true, onSelect: () => onRemoveProcess?.(process.id) },
      ];
    }
    return [
      { label: "Restart process", icon: RotateCw, onSelect: () => onRestartProcess?.(process.id) },
      { label: "Remove process", icon: Trash2, destructive: true, onSelect: () => onRemoveProcess?.(process.id) },
    ];
  }

  function processMenu(): ContextMenuItem[] {
    return [
      { label: "Open output", icon: Terminal, onSelect: () => onOpenProcessOutput?.(process.id) },
      { label: "Pin command", icon: Pin, onSelect: () => onPinProcess?.(process) },
      { label: "Copy command", icon: Copy, onSelect: () => onCopyCommand?.(process.command) },
      { type: "separator" },
      ...statusItems(),
    ];
  }

  function stopPropagation(event: MouseEvent) {
    event.stopPropagation();
  }
</script>

<ContextMenu items={processMenu()} triggerClass="process-context-trigger">
  <div
    class="group/row flex items-center gap-1 rounded-md border bg-card pr-1.5 transition-colors hover:border-ring/40 data-[active=true]:border-primary/60 data-[active=true]:bg-muted/40"
    data-active={selected}
  >
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button {...props} class="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left" type="button" onclick={() => onOpenProcessOutput?.(process.id)}>
            <StatusDot tone={processTone(process.status)} pulse={processPulse(process.status)} />
            <div class="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{process.command}</div>
            {#if envCount > 0}<Badge tone="neutral" size="xs" title={envKeys}>env</Badge>{/if}
            <Badge tone={processTone(process.status)} size="xs" class={processTone(process.status) === "neutral" ? "border-border bg-muted text-muted-foreground" : ""}>{process.status}</Badge>
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="left" sideOffset={6} class="nav-tooltip process-tooltip">
        <span class="tt-title">{process.name ?? process.command}</span>
        <span class="tt-row"><span class="tt-key">command</span>{process.command}</span>
        <span class="tt-row"><span class="tt-key">cwd</span>{process.cwd}</span>
        <span class="tt-row"><span class="tt-key">status</span>{process.status}</span>
        {#if envCount > 0}
          <span class="tt-row"><span class="tt-key">env</span>{envSummary}</span>
          <span class="tt-row tt-env-keys"><span class="tt-key">keys</span>{envKeys}</span>
        {/if}
        <span class="tt-row"><span class="tt-key">started</span>{dateTimeLabel(process.startedAt)}</span>
        {#if process.runtime?.childPid}<span class="tt-row"><span class="tt-key">pid</span>{process.runtime.childPid}</span>{/if}
        {#if process.runtime?.processGroupId}<span class="tt-row"><span class="tt-key">pgid</span>{process.runtime.processGroupId}</span>{/if}
        {#if process.status === "orphaned" && !process.runtime?.childPid && !process.runtime?.processGroupId}<span class="tt-row"><span class="tt-key">pid</span>No PID metadata captured</span>{/if}
        {#if process.runtime?.platform}<span class="tt-row"><span class="tt-key">platform</span>{process.runtime.platform}</span>{/if}
        {#if process.runtime?.spawnedAt}<span class="tt-row"><span class="tt-key">spawned</span>{dateTimeLabel(process.runtime.spawnedAt)}</span>{/if}
        {#if process.exitedAt}<span class="tt-row"><span class="tt-key">exited</span>{dateTimeLabel(process.exitedAt)}</span>{/if}
        {#if process.exitCode !== undefined && process.exitCode !== null}
          <span class="tt-row"><span class="tt-key">exit</span>{process.exitCode}</span>
        {:else if process.signal}
          <span class="tt-row"><span class="tt-key">signal</span>{process.signal}</span>
        {/if}
        {#if process.error}<span class="tt-row"><span class="tt-key">error</span>{process.error}</span>{/if}
        <span class="tt-id">{process.id}</span>
      </Tooltip.Content>
    </Tooltip.Root>
    <div class="flex shrink-0 items-center gap-0.5">
      {#if isActive}
        <Button size="icon-xs" variant="ghost" ariaLabel="Restart process" title="Restart process" class="text-muted-foreground hover:text-foreground" onclick={(event) => { stopPropagation(event); onRestartProcess?.(process.id); }}><RotateCw size={12} strokeWidth={2.3} /></Button>
        <Button size="icon-xs" variant="ghost" ariaLabel="Stop process" title="Stop process" class="text-muted-foreground hover:text-destructive" onclick={(event) => { stopPropagation(event); onStopProcess?.(process.id); }}><Square size={12} strokeWidth={2.3} /></Button>
      {:else if process.status === "orphaned"}
        <Button size="icon-xs" variant="ghost" ariaLabel="Clean up orphaned process" title="Clean up orphan" class="text-muted-foreground hover:text-destructive" onclick={(event) => { stopPropagation(event); onStopProcess?.(process.id); }}><TriangleAlert size={12} strokeWidth={2.3} /></Button>
        <Button size="icon-xs" variant="ghost" ariaLabel="Restart process" title="Restart process" class="text-muted-foreground hover:text-foreground" onclick={(event) => { stopPropagation(event); onRestartProcess?.(process.id); }}><RotateCw size={12} strokeWidth={2.3} /></Button>
        <Button size="icon-xs" variant="ghost" ariaLabel="Forget process record" title="Forget record" class="text-muted-foreground hover:text-destructive" onclick={(event) => { stopPropagation(event); onRemoveProcess?.(process.id); }}><Trash2 size={12} strokeWidth={2.3} /></Button>
      {:else}
        <Button size="icon-xs" variant="ghost" ariaLabel="Restart process" title="Restart process" class="text-muted-foreground hover:text-foreground" onclick={(event) => { stopPropagation(event); onRestartProcess?.(process.id); }}><RotateCw size={12} strokeWidth={2.3} /></Button>
        <Button size="icon-xs" variant="ghost" ariaLabel="Remove process" title="Remove process" class="text-muted-foreground hover:text-destructive" onclick={(event) => { stopPropagation(event); onRemoveProcess?.(process.id); }}><Trash2 size={12} strokeWidth={2.3} /></Button>
      {/if}
    </div>
  </div>
</ContextMenu>
