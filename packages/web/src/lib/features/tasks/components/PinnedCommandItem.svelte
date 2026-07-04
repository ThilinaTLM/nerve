<script lang="ts">
  import Pencil from "@lucide/svelte/icons/pencil";
  import Play from "@lucide/svelte/icons/play";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { PinnedCommand } from "$lib/api";
  import { Button } from "@nervekit/ui/components/ui/button";
  import * as Tooltip from "@nervekit/ui/components/ui/tooltip";

  type Props = {
    command: PinnedCommand;
    cwd?: string;
    running?: boolean;
    onRun?: (command: PinnedCommand) => void;
    onEdit?: (command: PinnedCommand) => void;
    onRemove?: (command: PinnedCommand) => void;
  };

  let {
    command,
    cwd = "",
    running = false,
    onRun,
    onEdit,
    onRemove,
  }: Props = $props();

  const label = $derived(command.label ?? command.command);

  function stopPropagation(event: MouseEvent) {
    event.stopPropagation();
  }
</script>

<div class="group/row flex items-center gap-1 rounded-md border bg-card pr-1.5 transition-colors hover:border-ring/40">
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <button {...props} class="flex min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-left" type="button">
          <span class="truncate text-xs font-medium text-foreground">{label}</span>
        </button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="left" sideOffset={6} class="nav-tooltip task-tooltip">
      <span class="tt-title">{label}</span>
      <span class="tt-row"><span class="tt-key">command</span>{command.command}</span>
      <span class="tt-row"><span class="tt-key">cwd</span>{command.cwd ?? cwd}</span>
    </Tooltip.Content>
  </Tooltip.Root>
  <div class="flex shrink-0 items-center gap-0.5">
    <Button
      size="icon-xs"
      variant="ghost"
      ariaLabel="Run pinned task"
      title="Run pinned task"
      class="text-muted-foreground hover:text-foreground"
      disabled={running}
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
      title="Edit pinned task"
      class="text-muted-foreground hover:text-foreground"
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
      title="Delete pinned task"
      class="text-muted-foreground hover:text-destructive"
      onclick={(event) => {
        stopPropagation(event);
        onRemove?.(command);
      }}
    >
      <Trash2 size={12} strokeWidth={2.3} />
    </Button>
  </div>
</div>
