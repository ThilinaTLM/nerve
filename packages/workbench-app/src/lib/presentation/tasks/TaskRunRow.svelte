<script lang="ts">
import BookmarkPlus from "@lucide/svelte/icons/bookmark-plus";
import Copy from "@lucide/svelte/icons/copy";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Skull from "@lucide/svelte/icons/skull";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import X from "@lucide/svelte/icons/x";
import type { TaskRecord } from "@nervekit/contracts";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import { PanelRow, PanelToolbarButton } from "$lib/presentation/panel";
import { formatTaskRunTime, taskRunLabel } from "./task-panel-controller.js";
import TaskStatusIcon from "./TaskStatusIcon.svelte";
import type { TaskEntryCapabilities, TaskRunEntry } from "./task-panel-types";

let {
  entry,
  nested = false,
  capabilities,
  onOpen,
  onCancel,
  onForceKill,
  onRestart,
  onRerunDefinition,
  onRemove,
  onCopy,
  onSaveAsDefinition,
}: {
  entry: TaskRunEntry;
  /** Renders the run as a child of its definition row: time-first label, deeper indent. */
  nested?: boolean;
  capabilities: TaskEntryCapabilities;
  onOpen?: (taskId: string) => void;
  onCancel?: (taskId: string) => void;
  onForceKill?: (taskId: string) => void;
  onRestart?: (taskId: string) => void;
  onRerunDefinition?: () => void;
  onRemove?: (taskId: string) => void;
  onCopy?: (text: string) => void;
  onSaveAsDefinition?: (task: TaskRecord) => void;
} = $props();

const run = $derived(entry.run);
const label = $derived(taskRunLabel(entry));
const startedAt = $derived(formatTaskRunTime(run.startedAt));
const recoveryHint = $derived(
  entry.needsRecovery
    ? run.status === "recovered"
      ? "Process recovered; live output disconnected."
      : "Process identity needs recovery review."
    : undefined,
);
const tooltip = $derived(
  [run.command, run.cwd, recoveryHint].filter(Boolean).join("\n"),
);

const menuItems = $derived.by<ContextMenuItem[]>(() => {
  const items: ContextMenuItem[] = [
    {
      label: "Open logs",
      icon: Terminal,
      disabled: !capabilities.logs,
      onSelect: () => onOpen?.(run.id),
    },
    {
      label: "Restart",
      icon: RotateCw,
      disabled: !capabilities.restart,
      onSelect: () => onRestart?.(run.id),
    },
  ];
  if (entry.definition && entry.isRemovable)
    items.push({
      label: "Run saved task again",
      icon: RotateCw,
      disabled: !capabilities.start,
      onSelect: () => onRerunDefinition?.(),
    });
  if (entry.isActive && run.status !== "stopping")
    items.push({
      label: "Stop",
      icon: Square,
      disabled: !capabilities.cancel,
      onSelect: () => onCancel?.(run.id),
    });
  if (entry.canForceKill)
    items.push({
      label: "Force kill",
      icon: Skull,
      destructive: true,
      disabled: !capabilities.cancel,
      onSelect: () => onForceKill?.(run.id),
    });

  if (!entry.definition)
    items.push(
      { type: "separator" },
      {
        label: "Save as task definition",
        icon: BookmarkPlus,
        disabled: !capabilities.manageDefinitions,
        onSelect: () => onSaveAsDefinition?.(run),
      },
    );

  const trailing: ContextMenuItem[] = [
    {
      label: "Copy command",
      icon: Copy,
      disabled: !capabilities.copy,
      onSelect: () => onCopy?.(run.command),
    },
    {
      label: "Copy working directory",
      icon: FolderOpen,
      disabled: !capabilities.copy,
      onSelect: () => onCopy?.(run.cwd),
    },
  ];
  if (entry.isRemovable)
    trailing.push({
      label: "Remove run",
      icon: X,
      destructive: true,
      disabled: !capabilities.remove,
      onSelect: () => onRemove?.(run.id),
    });
  items.push({ type: "separator" }, ...trailing);
  return items;
});
</script>

<PanelRow
  label={nested ? startedAt : label.text}
  description={nested ? undefined : startedAt}
  title={tooltip}
  mono={!nested && label.isCommand}
  tone={nested || label.isCommand ? "muted" : "default"}
  indent={nested ? 1 : 0}
  alwaysShowActions
  {menuItems}
  onclick={() => onOpen?.(run.id)}
>
  {#snippet leading()}
    <TaskStatusIcon status={run.status} />
  {/snippet}
  {#snippet actions()}
    {#if run.status === "stopping"}
      <PanelToolbarButton
        icon={Skull}
        label={`Force kill ${label.text}`}
        dense
        disabled={!capabilities.cancel}
        onclick={() => onForceKill?.(run.id)}
      />
    {:else if entry.isActive}
      <PanelToolbarButton
        icon={RotateCw}
        label={`Restart ${label.text}`}
        dense
        disabled={!capabilities.restart}
        onclick={() => onRestart?.(run.id)}
      />
      <PanelToolbarButton
        icon={Square}
        label={`Stop ${label.text}`}
        dense
        disabled={!capabilities.cancel}
        onclick={() => onCancel?.(run.id)}
      />
    {:else}
      <PanelToolbarButton
        icon={RotateCw}
        label={`Restart ${label.text}`}
        dense
        disabled={!capabilities.restart}
        onclick={() => onRestart?.(run.id)}
      />
    {/if}
  {/snippet}
</PanelRow>
