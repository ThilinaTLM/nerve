<script lang="ts">
import BookmarkPlus from "@lucide/svelte/icons/bookmark-plus";
import Copy from "@lucide/svelte/icons/copy";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import History from "@lucide/svelte/icons/history";
import Pencil from "@lucide/svelte/icons/pencil";
import Play from "@lucide/svelte/icons/play";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import Trash2 from "@lucide/svelte/icons/trash-2";
import X from "@lucide/svelte/icons/x";
import type { TaskRecord } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import { taskPulse, taskTone } from "@nervekit/ui-kit/core/utils/status";
import { PanelRow, PanelToolbarButton } from "@nervekit/workbench-ui/panel";
import {
  taskEntryCommand,
  taskEntryCwd,
  taskEntryLabel,
} from "./task-panel-controller.js";
import type { TaskEntryCapabilities, TaskPanelEntry } from "./task-panel-types";

let {
  entry,
  selected = false,
  capabilities,
  onOpen,
  onRun,
  onCancel,
  onRestart,
  onEdit,
  onDelete,
  onCopy,
  onRemoveRun,
  onSaveAsDefinition,
}: {
  entry: TaskPanelEntry;
  selected?: boolean;
  capabilities: TaskEntryCapabilities;
  onOpen?: (taskId: string) => void;
  onRun?: () => void;
  onCancel?: (taskId: string) => void;
  onRestart?: (taskId: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCopy?: (text: string) => void;
  onRemoveRun?: (taskId: string) => void;
  onSaveAsDefinition?: (task: TaskRecord) => void;
} = $props();

const latest = $derived(entry.latestRun);
const status = $derived(latest?.status ?? "saved");
const label = $derived(taskEntryLabel(entry));
const command = $derived(taskEntryCommand(entry));
const cwd = $derived(taskEntryCwd(entry));
const concurrent = $derived(entry.definition?.runPolicy === "concurrent");
const canStart = $derived(
  Boolean(entry.definition) && (concurrent || entry.activeRuns.length === 0),
);
const active = $derived(entry.activeRuns[0]);
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
  concurrent && active ? "Start another run" : "Run task",
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
  if (canStart)
    items.push({
      label: runLabel,
      icon: Play,
      disabled: !capabilities.start,
      onSelect: () => onRun?.(),
    });
  if (active) {
    items.push({
      label: "Restart",
      icon: RotateCw,
      disabled: !capabilities.restart,
      onSelect: () => onRestart?.(active.id),
    });
    items.push({
      label: "Stop",
      icon: Square,
      disabled: !capabilities.cancel,
      onSelect: () => onCancel?.(active.id),
    });
  }

  const definitionItems: ContextMenuItem[] = [];
  if (!entry.definition && latest)
    definitionItems.push({
      label: "Save as task definition",
      icon: BookmarkPlus,
      disabled: !capabilities.manageDefinitions,
      onSelect: () => onSaveAsDefinition?.(latest),
    });
  if (entry.definition) {
    definitionItems.push({
      label: "Edit task",
      icon: Pencil,
      disabled: !capabilities.manageDefinitions,
      onSelect: () => onEdit?.(),
    });
    definitionItems.push({
      label: "Delete task",
      icon: Trash2,
      destructive: true,
      disabled: !capabilities.manageDefinitions,
      onSelect: () => onDelete?.(),
    });
  }
  if (definitionItems.length > 0 && items.length > 0)
    items.push({ type: "separator" });
  items.push(...definitionItems);

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
  if (!entry.definition && latest && !active)
    trailing.push({
      label: "Remove from history",
      icon: X,
      destructive: true,
      disabled: !capabilities.remove,
      onSelect: () => onRemoveRun?.(latest.id),
    });
  if (trailing.length > 0 && items.length > 0)
    items.push({ type: "separator" });
  items.push(...trailing);
  return items;
});
</script>

<PanelRow
  label={label.text}
  title={tooltip}
  mono={label.isCommand}
  tone={label.isCommand ? "muted" : "default"}
  status={entry.needsRecovery
    ? "warn"
    : latest
      ? taskTone(latest.status)
      : "neutral"}
  pulse={latest ? taskPulse(latest.status) : false}
  {selected}
  disabled={!latest}
  indent={1}
  {menuItems}
  onclick={() => latest && onOpen?.(latest.id)}
>
  {#snippet badges()}
    {#if entry.activeRuns.length > 1}
      <Badge tone="accent" size="xs">{entry.activeRuns.length} running</Badge>
    {/if}
    {#if entry.runs.length > 1}
      <Badge tone="neutral" size="xs">
        <History class="mr-1 size-3" />{entry.runs.length}
      </Badge>
    {/if}
    <Badge tone={latest ? taskTone(latest.status) : "neutral"} size="xs"
      >{status}</Badge
    >
  {/snippet}
  {#snippet actions()}
    {#if active}
      <PanelToolbarButton
        icon={Square}
        label="Stop task"
        disabled={!capabilities.cancel}
        onclick={() => onCancel?.(active.id)}
      />
    {:else if canStart}
      <PanelToolbarButton
        icon={Play}
        label={runLabel}
        disabled={!capabilities.start}
        onclick={() => onRun?.()}
      />
    {/if}
  {/snippet}
</PanelRow>
