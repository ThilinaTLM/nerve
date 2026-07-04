<script lang="ts">
  import Copy from "@lucide/svelte/icons/copy";
  import Pin from "@lucide/svelte/icons/pin";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Square from "@lucide/svelte/icons/square";
  import Terminal from "@lucide/svelte/icons/terminal";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type { TaskRecord } from "$lib/api";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import ContextMenu, { type ContextMenuItem } from "@nervekit/ui/components/ui/context-menu-list";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import * as Tooltip from "@nervekit/ui/components/ui/tooltip";
  import { taskPulse, taskTone } from "$lib/core/utils/status";
  import { dateTimeLabel } from "$lib/core/utils/time";

  type Props = {
    task: TaskRecord;
    selected?: boolean;
    onOpenTaskOutput?: (id: string) => void;
    onCancelTask?: (id: string) => void;
    onRestartTask?: (id: string) => void;
    onRemoveTask?: (id: string) => void;
    onPinTask?: (task: TaskRecord) => void;
    onCopyCommand?: (command: string) => void;
  };

  let {
    task,
    selected = false,
    onOpenTaskOutput,
    onCancelTask,
    onRestartTask,
    onRemoveTask,
    onPinTask,
    onCopyCommand,
  }: Props = $props();

  const ACTIVE = new Set(["starting", "running", "ready", "stopping"]);
  const isActive = $derived(ACTIVE.has(task.status));
  const taskLabel = $derived(task.name ?? task.command);
  const showingTaskName = $derived(Boolean(task.name));
  const envCount = $derived(task.envInfo?.keys.length ?? 0);
  const envSummary = $derived(envCount === 0 ? undefined : `${envCount} redacted ${envCount === 1 ? "var" : "vars"}`);
  const envKeys = $derived(task.envInfo?.keys.join(", "));

  function statusItems(): ContextMenuItem[] {
    if (isActive) {
      return [
        { label: "Restart task", icon: RotateCw, onSelect: () => onRestartTask?.(task.id) },
        { label: "Cancel task", icon: Square, destructive: true, onSelect: () => onCancelTask?.(task.id) },
      ];
    }
    if (task.status === "orphaned") {
      return [
        { label: "Clean up orphan", icon: TriangleAlert, destructive: true, onSelect: () => onCancelTask?.(task.id) },
        { label: "Restart task", icon: RotateCw, onSelect: () => onRestartTask?.(task.id) },
        { label: "Forget record", icon: Trash2, destructive: true, onSelect: () => onRemoveTask?.(task.id) },
      ];
    }
    return [
      { label: "Restart task", icon: RotateCw, onSelect: () => onRestartTask?.(task.id) },
      { label: "Remove task", icon: Trash2, destructive: true, onSelect: () => onRemoveTask?.(task.id) },
    ];
  }

  function taskMenu(): ContextMenuItem[] {
    return [
      ...(isActive
        ? [
            {
              label: "Open output",
              icon: Terminal,
              onSelect: () => onOpenTaskOutput?.(task.id),
            } satisfies ContextMenuItem,
          ]
        : []),
      { label: "Pin command", icon: Pin, onSelect: () => onPinTask?.(task) },
      { label: "Copy command", icon: Copy, onSelect: () => onCopyCommand?.(task.command) },
      { type: "separator" },
      ...statusItems(),
    ];
  }

  function stopPropagation(event: MouseEvent) {
    event.stopPropagation();
  }
</script>

<ContextMenu items={taskMenu()} triggerClass="task-context-trigger">
  <div
    class="group/row flex items-center gap-1 rounded-md border bg-card pr-1.5 transition-colors hover:border-ring/40 data-[active=true]:border-primary/60 data-[active=true]:bg-muted/40"
    data-active={selected}
  >
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            class="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left"
            type="button"
            onclick={() => {
              if (isActive) onOpenTaskOutput?.(task.id);
            }}
          >
            <StatusDot tone={taskTone(task.status)} pulse={taskPulse(task.status)} />
            <div class={showingTaskName ? "min-w-0 flex-1 truncate text-xs font-medium text-foreground" : "min-w-0 flex-1 truncate font-mono text-xs text-foreground"}>{taskLabel}</div>
            {#if envCount > 0}<Badge tone="neutral" size="xs" title={envKeys}>env</Badge>{/if}
            <Badge tone={taskTone(task.status)} size="xs" class={taskTone(task.status) === "neutral" ? "border-border bg-muted text-muted-foreground" : ""}>{task.status}</Badge>
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="left" sideOffset={6} class="nav-tooltip task-tooltip">
        <span class="tt-title">{task.name ?? task.command}</span>
        <span class="tt-row"><span class="tt-key">command</span>{task.command}</span>
        <span class="tt-row"><span class="tt-key">cwd</span>{task.cwd}</span>
        <span class="tt-row"><span class="tt-key">status</span>{task.status}</span>
        {#if envCount > 0}
          <span class="tt-row"><span class="tt-key">env</span>{envSummary}</span>
          <span class="tt-row tt-env-keys"><span class="tt-key">keys</span>{envKeys}</span>
        {/if}
        <span class="tt-row"><span class="tt-key">started</span>{dateTimeLabel(task.startedAt)}</span>
        {#if task.runtime?.childPid}<span class="tt-row"><span class="tt-key">pid</span>{task.runtime.childPid}</span>{/if}
        {#if task.runtime?.processGroupId}<span class="tt-row"><span class="tt-key">pgid</span>{task.runtime.processGroupId}</span>{/if}
        {#if task.status === "orphaned" && !task.runtime?.childPid && !task.runtime?.processGroupId}<span class="tt-row"><span class="tt-key">pid</span>No PID metadata captured</span>{/if}
        {#if task.runtime?.platform}<span class="tt-row"><span class="tt-key">platform</span>{task.runtime.platform}</span>{/if}
        {#if task.runtime?.spawnedAt}<span class="tt-row"><span class="tt-key">spawned</span>{dateTimeLabel(task.runtime.spawnedAt)}</span>{/if}
        {#if task.finishedAt}<span class="tt-row"><span class="tt-key">finished</span>{dateTimeLabel(task.finishedAt)}</span>{/if}
        {#if task.exitCode !== undefined && task.exitCode !== null}
          <span class="tt-row"><span class="tt-key">exit</span>{task.exitCode}</span>
        {:else if task.signal}
          <span class="tt-row"><span class="tt-key">signal</span>{task.signal}</span>
        {/if}
        {#if task.error}<span class="tt-row"><span class="tt-key">error</span>{task.error}</span>{/if}
        <span class="tt-id">{task.id}</span>
      </Tooltip.Content>
    </Tooltip.Root>
    <div class="flex shrink-0 items-center gap-0.5">
      {#if isActive}
        <Button size="icon-xs" variant="ghost" ariaLabel="Restart task" title="Restart task" class="text-muted-foreground hover:text-foreground" onclick={(event) => { stopPropagation(event); onRestartTask?.(task.id); }}><RotateCw size={12} strokeWidth={2.3} /></Button>
        <Button size="icon-xs" variant="ghost" ariaLabel="Cancel task" title="Cancel task" class="text-muted-foreground hover:text-destructive" onclick={(event) => { stopPropagation(event); onCancelTask?.(task.id); }}><Square size={12} strokeWidth={2.3} /></Button>
      {:else if task.status === "orphaned"}
        <Button size="icon-xs" variant="ghost" ariaLabel="Clean up orphaned task" title="Clean up orphan" class="text-muted-foreground hover:text-destructive" onclick={(event) => { stopPropagation(event); onCancelTask?.(task.id); }}><TriangleAlert size={12} strokeWidth={2.3} /></Button>
        <Button size="icon-xs" variant="ghost" ariaLabel="Restart task" title="Restart task" class="text-muted-foreground hover:text-foreground" onclick={(event) => { stopPropagation(event); onRestartTask?.(task.id); }}><RotateCw size={12} strokeWidth={2.3} /></Button>
        <Button size="icon-xs" variant="ghost" ariaLabel="Forget task record" title="Forget record" class="text-muted-foreground hover:text-destructive" onclick={(event) => { stopPropagation(event); onRemoveTask?.(task.id); }}><Trash2 size={12} strokeWidth={2.3} /></Button>
      {:else}
        <Button size="icon-xs" variant="ghost" ariaLabel="Restart task" title="Restart task" class="text-muted-foreground hover:text-foreground" onclick={(event) => { stopPropagation(event); onRestartTask?.(task.id); }}><RotateCw size={12} strokeWidth={2.3} /></Button>
        <Button size="icon-xs" variant="ghost" ariaLabel="Remove task" title="Remove task" class="text-muted-foreground hover:text-destructive" onclick={(event) => { stopPropagation(event); onRemoveTask?.(task.id); }}><Trash2 size={12} strokeWidth={2.3} /></Button>
      {/if}
    </div>
  </div>
</ContextMenu>
