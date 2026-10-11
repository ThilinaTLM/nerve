<script lang="ts">
import { untrack } from "svelte";
import Copy from "@lucide/svelte/icons/copy";
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import Eraser from "@lucide/svelte/icons/eraser";
import History from "@lucide/svelte/icons/history";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Skull from "@lucide/svelte/icons/skull";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import { MobileActionSheet, MobileScreen } from "$lib/presentation/shell";
import {
  cancelSelectedLaunch,
  cleanupLaunchRuns,
  formatLaunchRunTime,
  restartSelectedLaunch,
  siblingLaunchRuns,
  launchSelectors,
  toRunEntry,
} from "$lib/features/launches";
import LaunchLogTerminal from "$lib/features/launches/views/LaunchLogTerminal.svelte";
import { loadEarlierLaunchLogs } from "$lib/features/launches/state/launch-logs.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { launchTitle } from "$lib/app/shell/mobile/mobile-activity";
import { activateMobileRoute } from "$lib/app/shell/mobile/mobile-route-activation.svelte";
import {
  backFromMobileScreen,
  replaceMobileScreen,
} from "$lib/app/shell/mobile/mobile-shell.svelte";
import type { MobileScreenProps } from "./mobile-screen-registry";
import { launchStatusLabel } from "./mobile-launch-rows";

/**
 * One launch run's output as a phone screen. Other runs of the same launch are a
 * sheet away instead of the desktop's floating run switcher.
 */
let { route, visible }: MobileScreenProps<"launch"> = $props();

const launch = $derived(
  launchSelectors.launches.find((candidate) => candidate.id === route.launchId),
);
const entry = $derived(launch ? toRunEntry(launch) : undefined);
const siblings = $derived(
  siblingLaunchRuns(launchSelectors.launches, route.launchId),
);
const staleRuns = $derived(
  siblings.filter(
    (run) => run.id !== route.launchId && toRunEntry(run).isRemovable,
  ),
);
const launchLogs = $derived(
  launchSelectors.launchLogs?.launch.id === route.launchId
    ? launchSelectors.launchLogs
    : undefined,
);

// Route activation shows the run when the screen surfaces; a run that was not
// loaded yet (e.g. after a reload) is shown once it arrives.
let shown = untrack(() => Boolean(launch));
$effect(() => {
  const exists = Boolean(launch);
  if (!visible || !exists || shown) return;
  shown = true;
  untrack(() => void activateMobileRoute(route));
});

let menuOpen = $state(false);
let runsOpen = $state(false);
let cleanupOpen = $state(false);
let forceKillOpen = $state(false);

function failed(action: string) {
  return (error: unknown) =>
    notify.error(
      `Could not ${action}: ${error instanceof Error ? error.message : String(error)}`,
    );
}

function showRun(launchId: string) {
  if (launchId === route.launchId) return;
  replaceMobileScreen({ ...route, launchId });
}

// A restart's new run joins this run's entry once the launch list catches up;
// the screen then follows it.
let followNewerRun = $state(false);
$effect(() => {
  if (!followNewerRun || !launch) return;
  const newest = siblings[0];
  if (!newest || newest.startedAt <= launch.startedAt) return;
  followNewerRun = false;
  untrack(() => showRun(newest.id));
});

async function restart() {
  if (!launch) return;
  try {
    followNewerRun = true;
    await restartSelectedLaunch(launch.id);
  } catch (error) {
    followNewerRun = false;
    failed("restart launch")(error);
  }
}

function stop() {
  if (launch) void cancelSelectedLaunch(launch.id).catch(failed("stop launch"));
}

function forceKill() {
  if (!launch) return;
  void cancelSelectedLaunch(launch.id, {
    signal: "SIGKILL",
    reason: "force_kill",
  }).catch(failed("force kill launch"));
}

async function copyCommand() {
  if (!launch) return;
  try {
    await writeClipboardText(launch.command);
    notify.success("Copied to clipboard");
  } catch {
    notify.error("Could not copy to clipboard");
  }
}

const menu = $derived.by<ContextMenuItem[]>(() => {
  const items: ContextMenuItem[] = [];
  if (entry?.isActive && entry.canForceKill) {
    items.push({
      label: "Force kill",
      icon: Skull,
      destructive: true,
      onSelect: () => (forceKillOpen = true),
    });
  }
  if (siblings.length > 1) {
    items.push({
      label: `Other runs (${siblings.length - 1})`,
      icon: History,
      onSelect: () => (runsOpen = true),
    });
  }
  if (staleRuns.length) {
    items.push({
      label: "Clean up old runs",
      icon: Eraser,
      onSelect: () => (cleanupOpen = true),
    });
  }
  items.push({ label: "Copy command", icon: Copy, onSelect: copyCommand });
  return items;
});

const runItems = $derived<ContextMenuItem[]>(
  siblings.map((run) => ({
    label: `${launchStatusLabel(run)} · ${formatLaunchRunTime(run.startedAt)}${run.id === route.launchId ? " (shown)" : ""}`,
    icon: Terminal,
    disabled: run.id === route.launchId,
    onSelect: () => showRun(run.id),
  })),
);
</script>

<MobileScreen
  title={launch ? launchTitle(launch) : "Launch"}
  subtitle={launch
    ? `${launchStatusLabel(launch)} · ${relativeTimeLabel(launch.startedAt)}`
    : undefined}
  onBack={backFromMobileScreen}
  scroll={false}
>
  {#snippet actions()}
    {#if entry?.isActive}
      <Button variant="ghost" size="icon-sm" ariaLabel="Stop" onclick={stop}>
        <Square size={17} strokeWidth={1.9} />
      </Button>
    {:else if launch}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Restart"
        onclick={() => void restart()}
      >
        <RotateCcw size={18} strokeWidth={1.9} />
      </Button>
    {/if}
    {#if launch}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Launch output actions"
        onclick={() => (menuOpen = true)}
      >
        <EllipsisVertical size={18} strokeWidth={1.9} />
      </Button>
    {/if}
  {/snippet}

  {#if launch}
    <div class="flex min-h-0 flex-col">
      <div class="relative min-h-0 flex-1">
        {#key launch.id}
          <LaunchLogTerminal
            launchId={launch.id}
            {launchLogs}
            command={launch.command}
            onLoadEarlier={() => loadEarlierLaunchLogs(route.launchId)}
          />
        {/key}
      </div>
    </div>
  {:else}
    <div
      class="grid min-h-full place-content-center gap-1 text-center text-muted-foreground"
    >
      <Terminal class="mx-auto size-7 text-primary" strokeWidth={1.7} />
      <p class="mt-1 text-foreground">Launch not found.</p>
      <span class="text-xs">
        The launch may have been removed or is no longer available.
      </span>
    </div>
  {/if}
</MobileScreen>

<MobileActionSheet
  open={menuOpen}
  title={launch ? launchTitle(launch) : "Launch"}
  items={menu}
  onOpenChange={(open) => (menuOpen = open)}
/>

<MobileActionSheet
  open={runsOpen}
  title="Runs"
  items={runItems}
  onOpenChange={(open) => (runsOpen = open)}
/>

<ConfirmDialog
  bind:open={cleanupOpen}
  destructive
  title="Clean up old runs?"
  description={`Removes ${staleRuns.length === 1 ? "1 finished run" : `${staleRuns.length} finished runs`} of this launch and their output.`}
  confirmLabel="Clean up"
  onConfirm={() =>
    void cleanupLaunchRuns(staleRuns.map((run) => run.id)).catch(
      failed("clean up runs"),
    )}
/>

<ConfirmDialog
  bind:open={forceKillOpen}
  destructive
  title="Force kill launch?"
  description="Immediately terminates the process. Buffered output and process cleanup may be lost."
  confirmLabel="Force kill"
  onConfirm={forceKill}
/>
