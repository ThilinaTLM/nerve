<script lang="ts">
  import Pin from "@lucide/svelte/icons/pin";
  import Play from "@lucide/svelte/icons/play";
  import Plus from "@lucide/svelte/icons/plus";
  import Square from "@lucide/svelte/icons/square";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import {
    createPinnedCommand,
    deletePinnedCommand,
    getPinnedCommands,
    type PinnedCommand,
    type ProcessRecord,
    type ProjectRecord,
  } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import ConfirmDialog from "$lib/components/ui/confirm-dialog";
  import { Input } from "$lib/components/ui/input";
  import * as Popover from "$lib/components/ui/popover";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import PanelSection from "$lib/app/layout/utility/PanelSection.svelte";
  import { writeClipboardText } from "$lib/core/clipboard";
  import { notify } from "$lib/features/notifications/notify.svelte";
  import PinnedCommandItem from "./PinnedCommandItem.svelte";
  import ProcessListItem from "./ProcessListItem.svelte";

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
  const orphaned = $derived(processes.filter((process) => process.status === "orphaned"));
  const stopped = $derived(
    processes.filter((process) => !isActive(process) && process.status !== "orphaned"),
  );

  let pinnedSectionOpen = $state(true);
  let runningSectionOpen = $state(true);
  let orphanedSectionOpen = $state(true);
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
    window.setTimeout(() => {
      if (runningPinId === command.id) runningPinId = undefined;
    }, 1200);
  }
</script>

<Tooltip.Provider delayDuration={300} disableHoverableContent>
  <div class="flex flex-col gap-2 p-2">
    {#if !activeProject}
      <p class="px-1 py-6 text-center text-xs text-muted-foreground">
        Select a project to manage its processes.
      </p>
    {:else}
      <PanelSection title="Pinned" icon={Pin} bind:open={pinnedSectionOpen}>
        {#snippet meta()}<span class="font-mono">{pinned.length}</span>{/snippet}
        {#snippet actions()}
          <Popover.Root bind:open={addPopoverOpen}>
            <Popover.Trigger class="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" title="Pin a command" aria-label="Pin a command">
              <Plus size={13} strokeWidth={2.3} />
            </Popover.Trigger>
            <Popover.Content align="end" collisionPadding={8} class="w-[min(340px,calc(100vw-2rem))] gap-3 p-3">
              <div class="text-xs font-medium text-foreground">Pin a command</div>
              <div class="flex flex-col gap-1.5">
                <Input bind:value={newPinCommand} placeholder="pnpm dev" class="h-8 font-mono text-xs" />
                <Input bind:value={newPinLabel} placeholder="Label (optional)" class="h-8 text-xs" />
                <div class="flex justify-end">
                  <Button size="sm" disabled={savingPin || newPinCommand.trim().length === 0} onclick={() => void createPin()}>
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
              <PinnedCommandItem command={command} cwd={activeProject.dir} running={runningPinId === command.id} onRun={runPin} onRemove={(item) => void removePin(item)} />
            {/each}
          {/if}
        </div>
      </PanelSection>

      {#if running.length > 0}
        <PanelSection title="Running" icon={Play} bind:open={runningSectionOpen}>
          {#snippet meta()}<span class="font-mono">{running.length}</span>{/snippet}
          <div class="flex flex-col gap-1.5">
            {#each running as process (process.id)}
              <ProcessListItem {process} selected={process.id === selectedProcess?.id} {onOpenProcessOutput} {onStopProcess} {onRestartProcess} {onRemoveProcess} onPinProcess={(item) => void pinFromProcess(item)} onCopyCommand={(command) => void copyToClipboard(command, "command")} />
            {/each}
          </div>
        </PanelSection>
      {/if}

      {#if orphaned.length > 0}
        <PanelSection title="Needs cleanup" icon={TriangleAlert} bind:open={orphanedSectionOpen}>
          {#snippet meta()}<span class="font-mono">{orphaned.length}</span>{/snippet}
          <div class="flex flex-col gap-1.5">
            {#each orphaned as process (process.id)}
              <ProcessListItem {process} selected={process.id === selectedProcess?.id} {onOpenProcessOutput} {onStopProcess} {onRestartProcess} {onRemoveProcess} onPinProcess={(item) => void pinFromProcess(item)} onCopyCommand={(command) => void copyToClipboard(command, "command")} />
            {/each}
          </div>
        </PanelSection>
      {/if}

      {#if stopped.length > 0}
        <PanelSection title="Stopped" icon={Square} bind:open={stoppedSectionOpen}>
          {#snippet meta()}<span class="font-mono">{stopped.length}</span>{/snippet}
          {#snippet actions()}
            <Button size="xs" variant="ghost" class="h-6 gap-1 text-muted-foreground hover:text-destructive" onclick={() => (confirmPruneOpen = true)}>
              <Trash2 size={12} strokeWidth={2.3} />Prune
            </Button>
          {/snippet}
          <div class="flex flex-col gap-1.5">
            {#each stopped as process (process.id)}
              <ProcessListItem {process} selected={process.id === selectedProcess?.id} {onOpenProcessOutput} {onStopProcess} {onRestartProcess} {onRemoveProcess} onPinProcess={(item) => void pinFromProcess(item)} onCopyCommand={(command) => void copyToClipboard(command, "command")} />
            {/each}
          </div>
        </PanelSection>
      {/if}
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
