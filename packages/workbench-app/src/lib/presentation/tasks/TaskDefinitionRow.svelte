<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import History from "@lucide/svelte/icons/history";
import Pencil from "@lucide/svelte/icons/pencil";
import Play from "@lucide/svelte/icons/play";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Skull from "@lucide/svelte/icons/skull";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import {
  PanelRow,
  PanelRowCard,
  PanelToolbarButton,
} from "$lib/presentation/panel";
import { taskDefinitionLabel } from "./task-panel-controller.js";
import TaskStatusIcon from "./TaskStatusIcon.svelte";
import type {
  TaskDefinitionEntry,
  TaskEntryCapabilities,
} from "./task-panel-types";

let {
  entry,
  capabilities,
  active = false,
  onOpen,
  onRun,
  onCancel,
  onForceKill,
  onRestart,
  onEdit,
  onDelete,
  onCleanupRuns,
  onCopy,
}: {
  entry: TaskDefinitionEntry;
  capabilities: TaskEntryCapabilities;
  active?: boolean;
  onOpen?: (taskId: string) => void;
  onRun?: () => void;
  onCancel?: (taskId: string) => void;
  onForceKill?: (taskId: string) => void;
  onRestart?: (taskId: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCleanupRuns?: (taskIds: readonly string[]) => void;
  onCopy?: (text: string) => void;
} = $props();

const latest = $derived(entry.latestRun);
const status = $derived(latest?.status ?? "saved");
const label = $derived(taskDefinitionLabel(entry));
const command = $derived(entry.definition.command);
const cwd = $derived(entry.definition.cwd);
const concurrent = $derived(entry.definition.runPolicy === "concurrent");
const canStart = $derived(concurrent || entry.activeRuns.length === 0);
const activeRun = $derived(entry.activeRuns[0]);
const cleanableRuns = $derived(
  entry.runs.filter((run) => run.isRemovable && run.run.id !== latest?.id),
);
const recoveryHint = $derived(
  entry.needsRecovery
    ? latest?.status === "recovered"
      ? "Process recovered; live output disconnected."
      : "Process identity needs recovery review."
    : undefined,
);
const tooltip = $derived(
  [command, cwd, recoveryHint].filter(Boolean).join("\n"),
);
const runLabel = $derived(
  concurrent && activeRun ? "Start another run" : "Run task",
);

const menuItems = $derived.by<ContextMenuItem[]>(() => {
  const items: ContextMenuItem[] = [];
  if (latest)
    items.push({
      label: "Open logs",
      icon: Terminal,
      disabled: !capabilities.logs,
      onSelect: () => onOpen?.(latest.id),
    });
  if (cleanableRuns.length > 0)
    items.push({
      label: "Clean up old runs",
      icon: Trash2,
      destructive: true,
      disabled: !capabilities.remove,
      onSelect: () => onCleanupRuns?.(cleanableRuns.map((run) => run.run.id)),
    });
  if (canStart)
    items.push({
      label: runLabel,
      icon: Play,
      disabled: !capabilities.start,
      onSelect: () => onRun?.(),
    });
  if (activeRun) {
    items.push({
      label: "Restart",
      icon: RotateCw,
      disabled: !capabilities.restart,
      onSelect: () => onRestart?.(activeRun.id),
    });
    if (activeRun.status !== "stopping")
      items.push({
        label: "Stop",
        icon: Square,
        disabled: !capabilities.cancel,
        onSelect: () => onCancel?.(activeRun.id),
      });
    if (activeRun.status === "recovered" || activeRun.status === "stopping")
      items.push({
        label: "Force kill",
        icon: Skull,
        destructive: true,
        disabled: !capabilities.cancel,
        onSelect: () => onForceKill?.(activeRun.id),
      });
  }

  if (items.length > 0) items.push({ type: "separator" });
  items.push({
    label: "Edit task",
    icon: Pencil,
    disabled: !capabilities.manageDefinitions,
    onSelect: () => onEdit?.(),
  });
  items.push({
    label: "Delete task",
    icon: Trash2,
    destructive: true,
    disabled: !capabilities.manageDefinitions,
    onSelect: () => onDelete?.(),
  });

  const trailing: ContextMenuItem[] = [];
  if (command)
    trailing.push({
      label: "Copy command",
      icon: Copy,
      disabled: !capabilities.copy,
      onSelect: () => onCopy?.(command),
    });
  if (cwd)
    trailing.push({
      label: "Copy working directory",
      icon: FolderOpen,
      disabled: !capabilities.copy,
      onSelect: () => onCopy?.(cwd),
    });
  if (trailing.length > 0) items.push({ type: "separator" }, ...trailing);
  return items;
});
</script>

<PanelRowCard itemKey={entry.key} {menuItems}>
  <PanelRow
    label={label.text}
    title={tooltip}
    mono={label.isCommand}
    tone={label.isCommand ? "muted" : "default"}
    disabled={!latest}
    indent={0}
    alwaysShowActions
    {active}
    onclick={() => latest && onOpen?.(latest.id)}
  >
    {#snippet leading()}
      <TaskStatusIcon {status} />
    {/snippet}
    {#snippet badges()}
      {#if entry.activeRuns.length > 1}
        <Badge tone="accent" size="xs">{entry.activeRuns.length} running</Badge>
      {/if}
      {#if entry.runs.length > 1}
        <Badge tone="neutral" size="xs">
          <History class="mr-1 size-3" />{entry.runs.length}
        </Badge>
      {/if}
    {/snippet}
    {#snippet actions()}
      {#if activeRun?.status === "stopping"}
        <PanelToolbarButton
          icon={Skull}
          label="Force kill task"
          dense
          disabled={!capabilities.cancel}
          onclick={() => onForceKill?.(activeRun.id)}
        />
      {:else if activeRun}
        <PanelToolbarButton
          icon={RotateCw}
          label="Restart task"
          dense
          disabled={!capabilities.restart}
          onclick={() => onRestart?.(activeRun.id)}
        />
        <PanelToolbarButton
          icon={Square}
          label="Stop task"
          dense
          disabled={!capabilities.cancel}
          onclick={() => onCancel?.(activeRun.id)}
        />
      {:else if canStart}
        <PanelToolbarButton
          icon={Play}
          label={runLabel}
          dense
          disabled={!capabilities.start}
          onclick={() => onRun?.()}
        />
      {/if}
    {/snippet}
  </PanelRow>
</PanelRowCard>
