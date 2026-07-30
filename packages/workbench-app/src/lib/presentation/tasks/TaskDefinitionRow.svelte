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
import { taskPulse, taskTone } from "@nervekit/ui-kit/core/utils/status";
import { PanelRow, PanelToolbarButton } from "$lib/presentation/panel";
import { taskDefinitionLabel } from "./task-panel-controller.js";
import type {
  TaskDefinitionEntry,
  TaskEntryCapabilities,
} from "./task-panel-types";

let {
  entry,
  expanded = false,
  capabilities,
  onToggleExpanded,
  onOpen,
  onRun,
  onCancel,
  onForceKill,
  onRestart,
  onEdit,
  onDelete,
  onCopy,
}: {
  entry: TaskDefinitionEntry;
  /** Whether the definition's run rows are listed underneath it. */
  expanded?: boolean;
  capabilities: TaskEntryCapabilities;
  onToggleExpanded?: () => void;
  onOpen?: (taskId: string) => void;
  onRun?: () => void;
  onCancel?: (taskId: string) => void;
  onForceKill?: (taskId: string) => void;
  onRestart?: (taskId: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCopy?: (text: string) => void;
} = $props();

const latest = $derived(entry.latestRun);
const expandable = $derived(entry.runs.length > 0);
const status = $derived(latest?.status ?? "saved");
const label = $derived(taskDefinitionLabel(entry));
const command = $derived(entry.definition.command);
const cwd = $derived(entry.definition.cwd);
const concurrent = $derived(entry.definition.runPolicy === "concurrent");
const canStart = $derived(concurrent || entry.activeRuns.length === 0);
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
  if (expandable)
    items.push({
      label: expanded ? "Hide runs" : "Show runs",
      icon: History,
      onSelect: () => onToggleExpanded?.(),
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
    if (active.status !== "stopping")
      items.push({
        label: "Stop",
        icon: Square,
        disabled: !capabilities.cancel,
        onSelect: () => onCancel?.(active.id),
      });
    if (active.status === "recovered" || active.status === "stopping")
      items.push({
        label: "Force kill",
        icon: Skull,
        destructive: true,
        disabled: !capabilities.cancel,
        onSelect: () => onForceKill?.(active.id),
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
  statusVariant={expanded ? "outline" : "solid"}
  pulse={latest ? taskPulse(latest.status) : false}
  disabled={!expandable}
  ariaExpanded={expandable ? expanded : undefined}
  indent={0}
  alwaysShowActions
  {menuItems}
  onclick={() => expandable && onToggleExpanded?.()}
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
    {#if active?.status === "stopping"}
      <PanelToolbarButton
        icon={Skull}
        label="Force kill task"
        disabled={!capabilities.cancel}
        onclick={() => onForceKill?.(active.id)}
      />
    {:else if active}
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
