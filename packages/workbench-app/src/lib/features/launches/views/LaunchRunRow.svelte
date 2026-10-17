<script lang="ts">
import Save from "@lucide/svelte/icons/save";
import Copy from "@lucide/svelte/icons/copy";
import Folder from "@lucide/svelte/icons/folder";
import Play from "@lucide/svelte/icons/play";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Skull from "@lucide/svelte/icons/skull";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import {
  PanelRow,
  PanelRowCard,
  PanelToolbarButton,
} from "$lib/presentation/panels";
import {
  formatLaunchRunTime,
  launchRunLabel,
} from "./launch-panel-controller.js";
import LaunchStatusIcon from "./LaunchStatusIcon.svelte";
import type {
  LaunchEntryCapabilities,
  LaunchRunEntry,
} from "./launch-panel-types";

let {
  entry,
  nested = false,
  capabilities,
  active = false,
  onOpen,
  onCancel,
  onForceKill,
  onRestart,
  onRerunDefinition,
  onRemove,
  onCopy,
  onSaveAsDefinition,
}: {
  entry: LaunchRunEntry;
  /** Renders the run as a child of its definition row: time-first label, deeper indent. */
  nested?: boolean;
  capabilities: LaunchEntryCapabilities;
  active?: boolean;
  onOpen?: (launchId: string) => void;
  onCancel?: (launchId: string) => void;
  onForceKill?: (launchId: string) => void;
  onRestart?: (launchId: string) => void;
  onRerunDefinition?: () => void;
  onRemove?: (launchId: string) => void;
  onCopy?: (text: string) => void;
  onSaveAsDefinition?: (launch: LaunchRecord) => void;
} = $props();

const run = $derived(entry.run);
const label = $derived(launchRunLabel(entry));
const startedAt = $derived(formatLaunchRunTime(run.startedAt));
const unavailable = $derived(entry.definitionUnavailable === true);
const description = $derived(
  unavailable ? `${startedAt} · Definition unavailable` : startedAt,
);
const tooltip = $derived(
  [
    run.command,
    run.cwd,
    unavailable ? "Definition unavailable while the catalog is unreadable" : "",
  ]
    .filter(Boolean)
    .join("\n"),
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
      label: "Run again",
      icon: Play,
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
        label: "Save as launch",
        icon: Save,
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
      icon: Folder,
      disabled: !capabilities.copy,
      onSelect: () => onCopy?.(run.cwd),
    },
  ];
  if (entry.isRemovable)
    trailing.push({
      label: "Remove run",
      icon: Trash2,
      destructive: true,
      disabled: !capabilities.remove,
      onSelect: () => onRemove?.(run.id),
    });
  items.push({ type: "separator" }, ...trailing);
  return items;
});
</script>

<PanelRowCard selected={active} {menuItems}>
  <PanelRow
    label={nested ? startedAt : label.text}
    description={nested ? (unavailable ? description : undefined) : description}
    title={tooltip}
    mono={!nested && label.isCommand}
    tone={nested || label.isCommand ? "neutral" : undefined}
    indent={nested ? 1 : 0}
    alwaysShowActions
    {active}
    onclick={() => onOpen?.(run.id)}
  >
    {#snippet leading()}
      <LaunchStatusIcon status={run.status} />
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
</PanelRowCard>
