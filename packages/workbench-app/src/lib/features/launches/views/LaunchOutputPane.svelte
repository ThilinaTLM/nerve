<script lang="ts">
import Terminal from "@lucide/svelte/icons/terminal";
import type {
  LaunchLogQueryResponse,
  LaunchRecord,
} from "@nervekit/contracts/launches";
import LogStream from "$lib/presentation/logs/LogStream.svelte";
import { launchLogLines } from "./launch-log-window.js";
import LaunchRunDock from "./LaunchRunDock.svelte";

type Props = {
  launch?: Pick<LaunchRecord, "id" | "command" | "status" | "startedAt">;
  launchLogs?: LaunchLogQueryResponse;
  siblingRuns?: readonly LaunchRecord[];
  canRestart?: boolean;
  canCancel?: boolean;
  onLoadEarlier?: () => void | Promise<void>;
  onJumpToLatest?: () => void | Promise<void>;
  onSelectRun?: (launchId: string) => void | Promise<void>;
  onRestartRun?: (launchId: string) => void | Promise<void>;
  onCancelRun?: (launchId: string) => void | Promise<void>;
  onForceKillRun?: (launchId: string) => void | Promise<void>;
  onCleanupRuns?: (launchIds: readonly string[]) => void | Promise<void>;
};

let {
  launch,
  launchLogs,
  siblingRuns = [],
  canRestart = true,
  canCancel = true,
  onLoadEarlier,
  onJumpToLatest,
  onSelectRun,
  onRestartRun,
  onCancelRun,
  onForceKillRun,
  onCleanupRuns,
}: Props = $props();

const lines = $derived(launchLogLines(launchLogs?.events ?? []));
</script>

<section class="flex h-full min-h-0 flex-col bg-background">
  {#if launch}
    <div class="relative min-h-0 flex-1">
      {#key launch.id}
        <LogStream
          scopeKey={`launch:${launch.id}`}
          ariaLabel="Launch output"
          emptyLabel="No logs captured."
          {lines}
          command={launch.command}
          hasMoreBefore={launchLogs?.hasMoreBefore}
          truncated={launchLogs?.truncated}
          detached={launchLogs?.hasMoreAfter}
          {onLoadEarlier}
          {onJumpToLatest}
        >
          {#snippet dock()}
            <LaunchRunDock
              {launch}
              runs={siblingRuns}
              {canRestart}
              {canCancel}
              {onSelectRun}
              {onRestartRun}
              {onCancelRun}
              {onForceKillRun}
              {onCleanupRuns}
            />
          {/snippet}
        </LogStream>
      {/key}
    </div>
  {:else}
    <div
      class="grid min-h-full place-content-center gap-1 text-center text-muted-foreground"
    >
      <Terminal class="mx-auto size-7 text-primary" strokeWidth={1.7} />
      <p class="mt-1 text-foreground">Launch not found.</p>
      <span class="text-ui">
        The launch may have been removed or is no longer available.
      </span>
    </div>
  {/if}
</section>
