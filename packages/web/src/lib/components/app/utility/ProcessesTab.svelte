<script lang="ts">
  import Copy from "@lucide/svelte/icons/copy";
  import Pin from "@lucide/svelte/icons/pin";
  import Play from "@lucide/svelte/icons/play";
  import Plus from "@lucide/svelte/icons/plus";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Square from "@lucide/svelte/icons/square";
  import Terminal from "@lucide/svelte/icons/terminal";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import {
    createPinnedCommand,
    deletePinnedCommand,
    getPinnedCommands,
    type PinnedCommand,
    type ProcessRecord,
    type ProjectRecord,
  } from "../../../api";
  import { writeClipboardText } from "$lib/clipboard";
  import { notify } from "$lib/notifications/notify.svelte";
  import { dateTimeLabel } from "../../../utils/time";
  import { processPulse, processTone } from "../../../utils/status";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import ConfirmDialog from "$lib/components/ui/confirm-dialog";
  import ContextMenu, {
    type ContextMenuItem,
  } from "$lib/components/ui/context-menu-list";
  import { Input } from "$lib/components/ui/input";
  import * as Popover from "$lib/components/ui/popover";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import PanelSection from "./PanelSection.svelte";

  type Props = {
    activeProject?: ProjectRecord;
    processes?: ProcessRecord[];
    selectedProcess?: ProcessRecord;
    homeDir?: string;
    onOpenProcessOutput?: (id: string) => void;
    onStopProcess?: (id: string) => void;
    onRestartProcess?: (id: string) => void;
    onRemoveProcess?: (id: string) => void;
    onPruneProcesses?: () => void;
    onRunCommand?: (input: {
      projectId: string;
      cwd: string;
      command: string;
      name?: string;
    }) => void;
  };

  let {
    activeProject,
    processes = [],
    selectedProcess,
    onOpenProcessOutput,
    onStopProcess,
    onRestartProcess,
    onRemoveProcess,
    onPruneProcesses,
    onRunCommand,
  }: Props = $props();

  const ACTIVE = new Set(["starting", "running", "ready", "stopping"]);
  const isActive = (process: ProcessRecord) => ACTIVE.has(process.status);

  const running = $derived(processes.filter(isActive));
  const stopped = $derived(processes.filter((process) => !isActive(process)));

  let pinnedSectionOpen = $state(true);
  let runningSectionOpen = $state(true);
  let stoppedSectionOpen = $state(false);
  let confirmPruneOpen = $state(false);

  let pinned = $state<PinnedCommand[]>([]);
  let loadingPinned = $state(false);
  let addPopoverOpen = $state(false);
  let savingPin = $state(false);
  let newPinCommand = $state("");
  let newPinLabel = $state("");
  let runningPinId = $state<string | undefined>(undefined);

  let lastLoadedProjectId = $state<string | undefined>(undefined);

  $effect(() => {
    const projectId = activeProject?.id;
    if (projectId === lastLoadedProjectId) return;
    lastLoadedProjectId = projectId;
    pinned = [];
    if (!projectId) return;
    loadingPinned = true;
    void getPinnedCommands(projectId)
      .then((commands) => {
        if (activeProject?.id === projectId) pinned = commands;
      })
      .catch((error) => notify.error(`Could not load pinned commands: ${errorMessage(error)}`))
      .finally(() => {
        if (activeProject?.id === projectId) loadingPinned = false;
      });
  });

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await writeClipboardText(text);
      notify.success(`Copied ${label}`);
    } catch {
      notify.error("Could not copy to clipboard");
    }
  }

  async function pinFromProcess(process: ProcessRecord) {
    if (!activeProject) return;
    try {
      const created = await createPinnedCommand(activeProject.id, {
        command: process.command,
        label: process.name,
        cwd: process.cwd === activeProject.dir ? undefined : process.cwd,
      });
      pinned = [...pinned, created];
      pinnedSectionOpen = true;
      notify.success("Command pinned");
    } catch (error) {
      notify.error(`Could not pin command: ${errorMessage(error)}`);
    }
  }

  function processMenu(process: ProcessRecord): ContextMenuItem[] {
    const shared: ContextMenuItem[] = [
      {
        label: "Open output",
        icon: Terminal,
        onSelect: () => onOpenProcessOutput?.(process.id),
      },
      { label: "Pin command", icon: Pin, onSelect: () => void pinFromProcess(process) },
      {
        label: "Copy command",
        icon: Copy,
        onSelect: () => void copyToClipboard(process.command, "command"),
      },
      { type: "separator" },
    ];
    if (isActive(process)) {
      return [
        ...shared,
        {
          label: "Stop process",
          icon: Square,
          destructive: true,
          onSelect: () => onStopProcess?.(process.id),
        },
      ];
    }
    return [
      ...shared,
      {
        label: "Restart process",
        icon: RotateCw,
        onSelect: () => onRestartProcess?.(process.id),
      },
      {
        label: "Remove process",
        icon: Trash2,
        destructive: true,
        onSelect: () => onRemoveProcess?.(process.id),
      },
    ];
  }

  function stopPropagation(event: MouseEvent) {
    event.stopPropagation();
  }

  async function createPin() {
    if (!activeProject) return;
    const command = newPinCommand.trim();
    if (command.length === 0) return;
    const label = newPinLabel.trim();
    savingPin = true;
    try {
      const created = await createPinnedCommand(activeProject.id, {
        command,
        label: label.length > 0 ? label : undefined,
      });
      pinned = [...pinned, created];
      newPinCommand = "";
      newPinLabel = "";
      addPopoverOpen = false;
    } catch (error) {
      notify.error(`Could not pin command: ${errorMessage(error)}`);
    } finally {
      savingPin = false;
    }
  }

  async function removePin(command: PinnedCommand) {
    if (!activeProject) return;
    try {
      await deletePinnedCommand(activeProject.id, command.id);
      pinned = pinned.filter((item) => item.id !== command.id);
    } catch (error) {
      notify.error(`Could not remove pinned command: ${errorMessage(error)}`);
    }
  }

  function runPin(command: PinnedCommand) {
    if (!activeProject) return;
    runningPinId = command.id;
    onRunCommand?.({
      projectId: activeProject.id,
      cwd: command.cwd ?? activeProject.dir,
      command: command.command,
      name: command.label ?? command.command,
    });
    // Brief visual cue; the new process appears under Running.
    window.setTimeout(() => {
      if (runningPinId === command.id) runningPinId = undefined;
    }, 1200);
  }
</script>

{#snippet statusBadge(status: string)}
  {@const tone = processTone(status)}
  <Badge
    {tone}
    size="xs"
    class={tone === "neutral" ? "border-border bg-muted text-muted-foreground" : ""}
  >
    {status}
  </Badge>
{/snippet}

{#snippet processRow(process: ProcessRecord)}
  <ContextMenu items={processMenu(process)} triggerClass="process-context-trigger">
  <div
    class="group/row flex items-center gap-1 rounded-md border bg-card pr-1.5 transition-colors hover:border-ring/40 data-[active=true]:border-primary/60 data-[active=true]:bg-muted/40"
    data-active={process.id === selectedProcess?.id}
  >
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            class="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left"
            type="button"
            onclick={() => onOpenProcessOutput?.(process.id)}
          >
            <StatusDot tone={processTone(process.status)} pulse={processPulse(process.status)} />
            <div class="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
              {process.command}
            </div>
            {@render statusBadge(process.status)}
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="left" sideOffset={6} class="nav-tooltip process-tooltip">
        <span class="tt-title">{process.name ?? process.command}</span>
        <span class="tt-row"><span class="tt-key">command</span>{process.command}</span>
        <span class="tt-row"><span class="tt-key">cwd</span>{process.cwd}</span>
        <span class="tt-row"><span class="tt-key">status</span>{process.status}</span>
        <span class="tt-row"><span class="tt-key">started</span>{dateTimeLabel(process.startedAt)}</span>
        {#if process.exitedAt}
          <span class="tt-row"><span class="tt-key">exited</span>{dateTimeLabel(process.exitedAt)}</span>
        {/if}
        {#if process.exitCode !== undefined && process.exitCode !== null}
          <span class="tt-row"><span class="tt-key">exit</span>{process.exitCode}</span>
        {:else if process.signal}
          <span class="tt-row"><span class="tt-key">signal</span>{process.signal}</span>
        {/if}
        {#if process.error}
          <span class="tt-row"><span class="tt-key">error</span>{process.error}</span>
        {/if}
        <span class="tt-id">{process.id}</span>
      </Tooltip.Content>
    </Tooltip.Root>
    <div class="flex shrink-0 items-center gap-0.5">
      {#if isActive(process)}
        <Button
          size="icon-xs"
          variant="ghost"
          ariaLabel="Stop process"
          title="Stop process"
          class="text-muted-foreground hover:text-destructive"
          onclick={(event) => {
            stopPropagation(event);
            onStopProcess?.(process.id);
          }}
        >
          <Square size={12} strokeWidth={2.3} />
        </Button>
      {:else}
        <Button
          size="icon-xs"
          variant="ghost"
          ariaLabel="Restart process"
          title="Restart process"
          class="text-muted-foreground hover:text-foreground"
          onclick={(event) => {
            stopPropagation(event);
            onRestartProcess?.(process.id);
          }}
        >
          <RotateCw size={12} strokeWidth={2.3} />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          ariaLabel="Remove process"
          title="Remove process"
          class="text-muted-foreground hover:text-destructive"
          onclick={(event) => {
            stopPropagation(event);
            onRemoveProcess?.(process.id);
          }}
        >
          <Trash2 size={12} strokeWidth={2.3} />
        </Button>
      {/if}
    </div>
  </div>
  </ContextMenu>
{/snippet}

{#snippet pinnedRow(command: PinnedCommand)}
  <div
    class="group/row flex items-center gap-1 rounded-md border bg-card pr-1.5 transition-colors hover:border-ring/40"
  >
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            class="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2.5 py-2 text-left"
            type="button"
            onclick={() => runPin(command)}
          >
            {#if command.label}
              <span class="truncate text-xs font-medium text-foreground">{command.label}</span>
            {/if}
            <span class="truncate font-mono text-xs text-muted-foreground">{command.command}</span>
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="left" sideOffset={6} class="nav-tooltip process-tooltip">
        {#if command.label}
          <span class="tt-title">{command.label}</span>
        {/if}
        <span class="tt-row"><span class="tt-key">command</span>{command.command}</span>
        <span class="tt-row"><span class="tt-key">cwd</span>{command.cwd ?? activeProject?.dir ?? ""}</span>
      </Tooltip.Content>
    </Tooltip.Root>
    <div class="flex shrink-0 items-center gap-0.5">
      <Button
        size="icon-xs"
        variant="ghost"
        ariaLabel="Run command"
        title="Run command"
        class="text-muted-foreground hover:text-foreground"
        disabled={runningPinId === command.id}
        onclick={(event) => {
          stopPropagation(event);
          runPin(command);
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
          void removePin(command);
        }}
      >
        <Trash2 size={12} strokeWidth={2.3} />
      </Button>
    </div>
  </div>
{/snippet}

<Tooltip.Provider delayDuration={300} disableHoverableContent>
  <div class="flex flex-col gap-2 p-2">
    {#if !activeProject}
      <p class="px-1 py-6 text-center text-xs text-muted-foreground">
        Select a project to manage its processes.
      </p>
    {:else}
      <PanelSection title="Pinned" icon={Pin} bind:open={pinnedSectionOpen}>
        {#snippet meta()}
          <span class="font-mono">{pinned.length}</span>
        {/snippet}
        {#snippet actions()}
          <Popover.Root bind:open={addPopoverOpen}>
            <Popover.Trigger
              class="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              title="Pin a command"
              aria-label="Pin a command"
            >
              <Plus size={13} strokeWidth={2.3} />
            </Popover.Trigger>
            <Popover.Content align="end" collisionPadding={8} class="w-[min(340px,calc(100vw-2rem))] gap-3 p-3">
              <div class="text-xs font-medium text-foreground">Pin a command</div>
              <div class="flex flex-col gap-1.5">
                <Input bind:value={newPinCommand} placeholder="pnpm dev" class="h-8 font-mono text-xs" />
                <Input bind:value={newPinLabel} placeholder="Label (optional)" class="h-8 text-xs" />
                <div class="flex justify-end">
                  <Button
                    size="sm"
                    disabled={savingPin || newPinCommand.trim().length === 0}
                    onclick={() => void createPin()}
                  >
                    <Pin />
                    Pin
                  </Button>
                </div>
              </div>
            </Popover.Content>
          </Popover.Root>
        {/snippet}
        <div class="flex flex-col gap-1.5">
          {#if loadingPinned && pinned.length === 0}
            <p class="px-1 py-1 text-xs text-muted-foreground">Loading…</p>
          {:else if pinned.length === 0}
            <p class="px-1 py-1 text-xs text-muted-foreground">
              No pinned commands. Add one to run it anytime.
            </p>
          {:else}
            {#each pinned as command (command.id)}
              {@render pinnedRow(command)}
            {/each}
          {/if}
        </div>
      </PanelSection>

      <PanelSection title="Running" icon={Play} bind:open={runningSectionOpen}>
        {#snippet meta()}
          <span class="font-mono">{running.length}</span>
        {/snippet}
        <div class="flex flex-col gap-1.5">
          {#if running.length === 0}
            <p class="px-1 py-1 text-xs text-muted-foreground">No running processes.</p>
          {:else}
            {#each running as process (process.id)}
              {@render processRow(process)}
            {/each}
          {/if}
        </div>
      </PanelSection>

      <PanelSection title="Stopped" icon={Square} bind:open={stoppedSectionOpen}>
        {#snippet meta()}
          <span class="font-mono">{stopped.length}</span>
        {/snippet}
        {#snippet actions()}
          {#if stopped.length > 0}
            <Button
              size="xs"
              variant="ghost"
              class="h-6 gap-1 text-muted-foreground hover:text-destructive"
              onclick={() => (confirmPruneOpen = true)}
            >
              <Trash2 size={12} strokeWidth={2.3} />Prune
            </Button>
          {/if}
        {/snippet}
        <div class="flex flex-col gap-1.5">
          {#if stopped.length === 0}
            <p class="px-1 py-1 text-xs text-muted-foreground">No stopped processes.</p>
          {:else}
            {#each stopped as process (process.id)}
              {@render processRow(process)}
            {/each}
          {/if}
        </div>
      </PanelSection>
    {/if}
  </div>
</Tooltip.Provider>

<ConfirmDialog
  bind:open={confirmPruneOpen}
  destructive
  title="Prune stopped processes"
  description={`This removes ${stopped.length} stopped ${stopped.length === 1 ? "process" : "processes"} and their captured logs. This can't be undone.`}
  confirmLabel="Prune"
  onConfirm={() => onPruneProcesses?.()}
/>

<style>
  /* ContextMenu trigger wrappers must not break the flex/card row layout. */
  :global(.process-context-trigger) {
    display: block;
    width: 100%;
    min-width: 0;
  }

  :global(.nav-tooltip) {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    max-width: 22rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  :global(.process-tooltip) .tt-title {
    margin-bottom: 0.15rem;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  :global(.process-tooltip) .tt-row {
    display: flex;
    gap: 0.4rem;
  }

  :global(.process-tooltip) .tt-key {
    min-width: 3.4rem;
    color: var(--muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  :global(.process-tooltip) .tt-id {
    margin-top: 0.2rem;
    color: var(--muted-foreground);
  }
</style>
