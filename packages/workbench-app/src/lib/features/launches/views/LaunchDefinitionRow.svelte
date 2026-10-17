<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import Folder from "@lucide/svelte/icons/folder";
import History from "@lucide/svelte/icons/history";
import Pencil from "@lucide/svelte/icons/pencil";
import Play from "@lucide/svelte/icons/play";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Skull from "@lucide/svelte/icons/skull";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { PanelRow, PanelToolbarButton } from "$lib/presentation/panels";
import { launchDefinitionLabel } from "./launch-panel-controller.js";
import LaunchStatusIcon from "./LaunchStatusIcon.svelte";
import type {
  LaunchDefinitionEntry,
  LaunchEntryCapabilities,
} from "./launch-panel-types";

let {
  entry,
  capabilities,
  active = false,
  depth = 0,
  position,
  setSize,
  tabindex,
  moveItems = [],
  onOpen,
  onRun,
  onCancel,
  onForceKill,
  onRestart,
  onEdit,
  onDuplicate,
  onDelete,
  onCleanupRuns,
  onCopy,
}: {
  entry: LaunchDefinitionEntry;
  capabilities: LaunchEntryCapabilities;
  active?: boolean;
  /** Tree nesting level; 0 is the top level. */
  depth?: number;
  position?: number;
  setSize?: number;
  /** Roving tabindex supplied by the owning tree. */
  tabindex?: number;
  /** Move actions appended to the context menu. */
  moveItems?: ContextMenuItem[];
  onOpen?: (launchId: string) => void;
  onRun?: () => void;
  onCancel?: (launchId: string) => void;
  onForceKill?: (launchId: string) => void;
  onRestart?: (launchId: string) => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onCleanupRuns?: (launchIds: readonly string[]) => void;
  onCopy?: (text: string) => void;
} = $props();

const latest = $derived(entry.latestRun);
const status = $derived(latest?.status ?? "saved");
const label = $derived(launchDefinitionLabel(entry));
const command = $derived(entry.definition.command);
const cwd = $derived(entry.definition.cwd);
const port = $derived(entry.definition.port);
const concurrent = $derived(entry.definition.runPolicy === "concurrent");
const canStart = $derived(concurrent || entry.activeRuns.length === 0);
const activeRun = $derived(entry.activeRuns[0]);
const cleanableRuns = $derived(
  entry.runs.filter((run) => run.isRemovable && run.run.id !== latest?.id),
);
const tooltip = $derived(
  [command, cwd, port ? `TCP port ${port}` : undefined]
    .filter(Boolean)
    .join("\n"),
);
const runLabel = $derived(
  concurrent && activeRun ? "Start another run" : "Run launch",
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
      label: "Clean up runs",
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
    if (activeRun.status === "stopping")
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
    label: "Edit launch",
    icon: Pencil,
    disabled: !capabilities.manageDefinitions,
    onSelect: () => onEdit?.(),
  });
  items.push({
    label: "Duplicate launch",
    icon: Copy,
    disabled: !capabilities.manageDefinitions,
    onSelect: () => onDuplicate?.(),
  });
  items.push({
    label: "Delete launch",
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
      icon: Folder,
      disabled: !capabilities.copy,
      onSelect: () => onCopy?.(cwd),
    });
  if (trailing.length > 0) items.push({ type: "separator" }, ...trailing);
  if (moveItems.length > 0) items.push({ type: "separator" }, ...moveItems);
  return items;
});
</script>

<PanelRow
  label={label.text}
  title={tooltip}
  mono={label.isCommand}
  tone={label.isCommand ? "neutral" : undefined}
  selected={active}
  {menuItems}
  indent={depth}
  role="treeitem"
  ariaLevel={depth + 1}
  ariaPosInSet={position}
  ariaSetSize={setSize}
  {tabindex}
  contentTabindex={tabindex === undefined ? undefined : -1}
  dataId={`definition:${entry.definition.id}`}
  alwaysShowActions
  {active}
  onclick={() => latest && onOpen?.(latest.id)}
>
  {#snippet leading()}
    <LaunchStatusIcon {status} />
  {/snippet}
  {#snippet badges()}
    {#if entry.activeRuns.length > 1}
      <Badge variant="accent">{entry.activeRuns.length} running</Badge>
    {/if}
    {#if entry.runs.length > 1}
      <Badge variant="neutral">
        <History class="mr-1 size-3" />{entry.runs.length}
      </Badge>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if activeRun?.status === "stopping"}
      <PanelToolbarButton
        icon={Skull}
        label="Force kill launch"
        dense
        disabled={!capabilities.cancel}
        onclick={() => onForceKill?.(activeRun.id)}
      />
    {:else if activeRun}
      <PanelToolbarButton
        icon={RotateCw}
        label="Restart launch"
        dense
        disabled={!capabilities.restart}
        onclick={() => onRestart?.(activeRun.id)}
      />
      <PanelToolbarButton
        icon={Square}
        label="Stop launch"
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
