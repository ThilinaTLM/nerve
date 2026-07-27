<script lang="ts">
import BookmarkPlus from "@lucide/svelte/icons/bookmark-plus";
import Copy from "@lucide/svelte/icons/copy";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import X from "@lucide/svelte/icons/x";
import type { TaskRecord } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import { taskPulse, taskTone } from "@nervekit/ui-kit/core/utils/status";
import { PanelRow, PanelToolbarButton } from "@nervekit/workbench-ui/panel";
import { formatTaskRunTime, taskRunLabel } from "./task-panel-controller.js";
import type { TaskEntryCapabilities, TaskRunEntry } from "./task-panel-types";

let {
  entry,
  selected = false,
  capabilities,
  onOpen,
  onCancel,
  onRestart,
  onRemove,
  onCopy,
  onSaveAsDefinition,
}: {
  entry: TaskRunEntry;
  selected?: boolean;
  capabilities: TaskEntryCapabilities;
  onOpen?: (taskId: string) => void;
  onCancel?: (taskId: string) => void;
  onRestart?: (taskId: string) => void;
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
  if (entry.isActive)
    items.push({
      label: "Stop",
      icon: Square,
      disabled: !capabilities.cancel,
      onSelect: () => onCancel?.(run.id),
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
  if (!entry.isActive)
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
  label={label.text}
  description={startedAt}
  title={tooltip}
  mono={label.isCommand}
  tone={label.isCommand ? "muted" : "default"}
  status={entry.needsRecovery ? "warn" : taskTone(run.status)}
  pulse={taskPulse(run.status)}
  {selected}
  indent={1}
  {menuItems}
  onclick={() => onOpen?.(run.id)}
>
  {#snippet badges()}
    <Badge tone={taskTone(run.status)} size="xs">{run.status}</Badge>
  {/snippet}
  {#snippet actions()}
    {#if entry.isActive}
      <PanelToolbarButton
        icon={Square}
        label={`Stop ${label.text}`}
        disabled={!capabilities.cancel}
        onclick={() => onCancel?.(run.id)}
      />
    {:else}
      <PanelToolbarButton
        icon={RotateCw}
        label={`Restart ${label.text}`}
        disabled={!capabilities.restart}
        onclick={() => onRestart?.(run.id)}
      />
    {/if}
  {/snippet}
</PanelRow>
