<script lang="ts">
  import Play from "@lucide/svelte/icons/play";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { PinnedCommand } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import * as Tooltip from "$lib/components/ui/tooltip";

  type Props = {
    command: PinnedCommand;
    cwd?: string;
    running?: boolean;
    onRun?: (command: PinnedCommand) => void;
    onRemove?: (command: PinnedCommand) => void;
  };

  let { command, cwd = "", running = false, onRun, onRemove }: Props = $props();

  function stopPropagation(event: MouseEvent) {
    event.stopPropagation();
  }
</script>

<div class="group/row flex items-center gap-1 rounded-md border bg-card pr-1.5 transition-colors hover:border-ring/40">
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <button {...props} class="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2.5 py-2 text-left" type="button" onclick={() => onRun?.(command)}>
          {#if command.label}
            <span class="truncate text-xs font-medium text-foreground">{command.label}</span>
          {/if}
          <span class="truncate font-mono text-xs text-muted-foreground">{command.command}</span>
        </button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="left" sideOffset={6} class="nav-tooltip process-tooltip">
      {#if command.label}<span class="tt-title">{command.label}</span>{/if}
      <span class="tt-row"><span class="tt-key">command</span>{command.command}</span>
      <span class="tt-row"><span class="tt-key">cwd</span>{command.cwd ?? cwd}</span>
    </Tooltip.Content>
  </Tooltip.Root>
  <div class="flex shrink-0 items-center gap-0.5">
    <Button
      size="icon-xs"
      variant="ghost"
      ariaLabel="Run command"
      title="Run command"
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
      ariaLabel="Remove pinned command"
      title="Remove pinned command"
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
