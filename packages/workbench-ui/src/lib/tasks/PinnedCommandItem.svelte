<script lang="ts">
import Pencil from "@lucide/svelte/icons/pencil";
import Play from "@lucide/svelte/icons/play";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { FeatureCapability } from "../git/git-panel-types";
import type { NormalizedPinnedCommand } from "./task-panel-types";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";

type Props = {
  command: NormalizedPinnedCommand;
  cwd?: string;
  running?: boolean;
  runCapability: FeatureCapability;
  manageCapability: FeatureCapability;
  onRun?: (command: NormalizedPinnedCommand) => void;
  onEdit?: (command: NormalizedPinnedCommand) => void;
  onRemove?: (command: NormalizedPinnedCommand) => void;
};

let {
  command,
  cwd = "",
  running = false,
  runCapability,
  manageCapability,
  onRun,
  onEdit,
  onRemove,
}: Props = $props();

const label = $derived(command.label ?? command.command);

function stopPropagation(event: MouseEvent) {
  event.stopPropagation();
}
</script>

<div
  class="group/row flex items-center gap-1 rounded-md border bg-card pr-1.5 transition-colors hover:border-ring/40"
>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          class="flex min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-left"
          type="button"
        >
          <span class="truncate text-xs font-medium text-foreground"
            >{label}</span
          >
        </button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content
      side="left"
      sideOffset={6}
      class="nav-tooltip task-tooltip"
    >
      <span class="tt-title">{label}</span>
      <span class="tt-row"
        ><span class="tt-key">command</span>{command.command}</span
      >
      <span class="tt-row"
        ><span class="tt-key">cwd</span>{command.cwd ?? cwd}</span
      >
    </Tooltip.Content>
  </Tooltip.Root>
  <div class="flex shrink-0 items-center gap-0.5">
    <Button
      size="icon-xs"
      variant="ghost"
      ariaLabel="Run pinned task"
      title={runCapability.enabled ? "Run pinned task" : runCapability.reason}
      class="text-muted-foreground hover:text-foreground"
      disabled={running || !runCapability.enabled}
      onclick={(event) => {
        stopPropagation(event);
        onRun?.(command);
      }}
    >
      <Play size={12} strokeWidth={2.3} />
    </Button>
    <Button
      size="icon-xs"
      variant="ghost"
      ariaLabel="Edit pinned task"
      title={manageCapability.enabled
        ? "Edit pinned task"
        : manageCapability.reason}
      class="text-muted-foreground hover:text-foreground"
      disabled={!manageCapability.enabled}
      onclick={(event) => {
        stopPropagation(event);
        onEdit?.(command);
      }}
    >
      <Pencil size={12} strokeWidth={2.3} />
    </Button>
    <Button
      size="icon-xs"
      variant="ghost"
      ariaLabel="Delete pinned task"
      title={manageCapability.enabled
        ? "Delete pinned task"
        : manageCapability.reason}
      class="text-muted-foreground hover:text-destructive"
      disabled={!manageCapability.enabled}
      onclick={(event) => {
        stopPropagation(event);
        onRemove?.(command);
      }}
    >
      <Trash2 size={12} strokeWidth={2.3} />
    </Button>
  </div>
</div>
