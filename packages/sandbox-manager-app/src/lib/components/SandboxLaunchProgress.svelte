<script lang="ts">
import {
  ChevronDown,
  Circle,
  CircleCheck,
  CircleX,
  MinusCircle,
  TriangleAlert,
  WifiOff,
} from "@lucide/svelte";
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import { onMount } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import type { StatusTone } from "@nervekit/ui-kit/components/ui/status-dot";
import { CodeViewer } from "@nervekit/workbench-ui/components/workbench";
import {
  computeSandboxBootProgress,
  sandboxSetupTimeline,
  type BootPhase,
  type BootPhaseGroup,
  type BootPhaseStatus,
  type BootState,
} from "../state/sandbox-boot-progress";
import { sandboxLifecycleView } from "../state/sandbox-lifecycle-view";
import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
import type { SandboxSetupTimelineItem } from "../state/sandbox-ui-types";

let {
  record,
  variant = "banner",
  expanded = true,
  onToggle,
  onOpenLogs,
}: {
  record: ManagedSandboxRecord;
  variant?: "banner" | "rail";
  expanded?: boolean;
  onToggle?: () => void;
  onOpenLogs?: () => void;
} = $props();

const store = useSandboxManagerStore();
const detail = $derived(store.details[record.sandboxId]);
const progress = $derived(computeSandboxBootProgress(record, detail));
const lifecycleView = $derived(sandboxLifecycleView(record, detail));
const starting = $derived(
  progress.state === "provisioning" || progress.state === "booting",
);
const activeGroup = $derived(
  progress.groups.find((group) => group.status === "active"),
);

let openGroups = $state<Record<string, boolean>>({});
let now = $state(Date.now());

$effect(() => {
  for (const group of progress.groups) {
    if (
      (group.status === "active" || group.status === "failed") &&
      openGroups[group.id] === undefined
    )
      openGroups[group.id] = true;
  }
});

onMount(() => {
  const timer = window.setInterval(() => {
    now = Date.now();
  }, 1000);
  return () => window.clearInterval(timer);
});

const stateTone: Record<BootState, StatusTone> = {
  provisioning: "running",
  booting: "running",
  reconnecting: "running",
  ready: "good",
  failed: "danger",
  offline: "neutral",
};

function groupIcon(status: BootPhaseStatus) {
  switch (status) {
    case "done":
      return CircleCheck;
    case "skipped":
    case "stopped":
      return MinusCircle;
    case "failed":
      return CircleX;
    case "degraded":
      return TriangleAlert;
    default:
      return Circle;
  }
}

function statusTone(status: BootPhaseStatus): string {
  switch (status) {
    case "active":
      return "text-info";
    case "done":
      return "text-success";
    case "failed":
      return "text-destructive";
    case "degraded":
      return "text-warning";
    case "skipped":
    case "stopped":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground/50";
  }
}

function headlineFor(state: BootState): string {
  switch (state) {
    case "ready":
      return "Sandbox ready";
    case "failed":
      return "Startup failed";
    case "reconnecting":
      return "Connection recovery";
    case "offline":
      return lifecycleView.state === "stopping"
        ? "Stopping sandbox"
        : "Sandbox offline";
    default:
      return "Starting sandbox";
  }
}

function formatDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatClock(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString(undefined, { hour12: false });
}

function formatMs(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0)
    return undefined;
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000)
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`;
}

function sinceMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const started = Date.parse(value);
  return Number.isFinite(started) ? Math.max(0, now - started) : undefined;
}

const elapsedLabel = $derived(
  starting || progress.state === "reconnecting"
    ? formatMs(sinceMs(progress.startedAt))
    : undefined,
);
const readyDuration = $derived(
  progress.readyAt && progress.startedAt
    ? formatMs(
        Math.max(
          0,
          Date.parse(progress.readyAt) - Date.parse(progress.startedAt),
        ),
      )
    : undefined,
);

function activeDetail(group: BootPhaseGroup): string | undefined {
  const phase = group.activePhase;
  if (!phase) return undefined;
  if (phase.id === "boot") {
    const step = activeBootStep();
    if (step) return bootStepSummary(step);
  }
  const elapsed = formatMs(sinceMs(phase.ts));
  return elapsed ? `${phase.label} · ${elapsed}` : phase.label;
}

function bootSteps(): SandboxSetupTimelineItem[] {
  return sandboxSetupTimeline(detail)
    .map((item, order) => ({ item, order }))
    .filter(({ item }) => item.phase === "boot")
    .sort((a, b) => {
      if (a.item.index !== undefined && b.item.index !== undefined) {
        const byIndex = a.item.index - b.item.index;
        if (byIndex !== 0) return byIndex;
      }
      return a.order - b.order;
    })
    .map(({ item }) => item);
}

function activeBootStep(): SandboxSetupTimelineItem | undefined {
  return bootSteps()
    .filter((item) => item.status === "started")
    .at(-1);
}

function bootStepTitle(item: SandboxSetupTimelineItem): string {
  const prefix = item.index !== undefined ? `#${item.index + 1}` : "Step";
  return `${prefix} ${item.name ?? "boot"}`;
}

function bootStepSummary(item: SandboxSetupTimelineItem): string {
  const elapsed =
    item.status === "started"
      ? formatMs(sinceMs(item.startedAt ?? item.ts))
      : formatMs(item.durationMs);
  return [
    bootStepTitle(item),
    item.runAs,
    item.network,
    item.exitCode !== undefined && item.exitCode !== 0
      ? `exit ${item.exitCode}`
      : undefined,
    elapsed,
  ]
    .filter(Boolean)
    .join(" · ");
}

function phaseMeta(phase: BootPhase): string | undefined {
  if (phase.status === "active") return formatMs(sinceMs(phase.ts));
  return phase.ts ? formatClock(phase.ts) : undefined;
}

function groupMeta(group: BootPhaseGroup): string | undefined {
  if (group.status === "active") {
    const started = group.activePhase?.ts ?? group.ts;
    return formatMs(sinceMs(started));
  }
  return group.ts ? formatClock(group.ts) : undefined;
}

function groupExpandable(group: BootPhaseGroup): boolean {
  return group.phases.some((phase) => phase.status !== "pending");
}

function toggleGroup(groupId: string): void {
  openGroups[groupId] = !openGroups[groupId];
}

const showBody = $derived(onToggle ? expanded : true);
const showGroups = $derived(
  showBody && progress.state !== "reconnecting" && progress.state !== "ready",
);
</script>

<section
  class={variant === "rail"
    ? "flex flex-col gap-3"
    : "flex flex-col gap-3 rounded-md border bg-card p-3"}
>
  {#snippet headerContent()}
    {#if starting}
      <Spinner class="size-4 flex-none text-info" />
    {:else}
      <StatusDot
        tone={stateTone[progress.state]}
        pulse={progress.state === "reconnecting"}
      />
    {/if}
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold">
        {headlineFor(progress.state)}
        {#if progress.state === "ready" && readyDuration}
          <span class="font-normal text-muted-foreground">
            in {readyDuration}</span
          >
        {/if}
      </p>
      <p class="truncate text-xs text-muted-foreground">
        {#if starting && activeGroup}
          {activeDetail(activeGroup) ?? lifecycleView.description}
        {:else}
          {lifecycleView.description}
        {/if}
      </p>
    </div>
    {#if progress.state === "reconnecting"}
      <span class="flex-none text-xs text-muted-foreground tabular-nums">
        {lifecycleView.reconnectAttempts
          ? `Retry ${lifecycleView.reconnectAttempts}`
          : "Retrying"}
      </span>
    {:else if starting || progress.state === "failed"}
      <span class="flex-none text-xs text-muted-foreground tabular-nums">
        {progress.completed}/{progress.total}{elapsedLabel
          ? ` · ${elapsedLabel}`
          : ""}
      </span>
    {/if}
  {/snippet}

  {#if onToggle}
    <button
      type="button"
      class="flex w-full items-center gap-2.5 text-left"
      aria-expanded={showBody}
      aria-label={showBody
        ? "Collapse launch details"
        : "Expand launch details"}
      onclick={onToggle}
    >
      {@render headerContent()}
      <ChevronDown
        class={`size-4 flex-none text-muted-foreground transition-transform ${showBody ? "" : "-rotate-90"}`}
      />
    </button>
  {:else}
    <div class="flex w-full items-center gap-2.5">
      {@render headerContent()}
    </div>
  {/if}

  {#if showBody && starting}
    <Progress value={progress.fraction * 100} />
  {/if}

  {#if showBody && progress.state === "reconnecting"}
    <div class="flex items-start gap-2.5 rounded-md border bg-muted/30 p-3">
      <WifiOff class="mt-0.5 size-4 flex-none text-info" />
      <div class="min-w-0">
        <p class="text-sm font-medium">Controller connection interrupted</p>
        <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {lifecycleView.description}
        </p>
        {#if detail?.status?.connectivity?.disconnectedAt}
          <p class="mt-1 font-mono text-xs text-muted-foreground">
            Disconnected {formatDate(detail.status.connectivity.disconnectedAt)}
          </p>
        {/if}
      </div>
    </div>
  {/if}

  {#if showGroups}
    <ol class="divide-y overflow-hidden rounded-md border bg-background/50">
      {#each progress.groups as group (group.id)}
        {@const expandable = groupExpandable(group)}
        {@const open = expandable && (openGroups[group.id] ?? false)}
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-2.5 px-2.5 py-2 text-left disabled:cursor-default"
            aria-expanded={expandable ? open : undefined}
            aria-label={expandable
              ? open
                ? `Hide ${group.label} details`
                : `Show ${group.label} details`
              : undefined}
            disabled={!expandable}
            onclick={() => toggleGroup(group.id)}
          >
            {#if group.status === "active"}
              <Spinner class="size-4 flex-none text-info" />
            {:else}
              {@const Icon = groupIcon(group.status)}
              <Icon class={`size-4 flex-none ${statusTone(group.status)}`} />
            {/if}
            <div class="flex min-w-0 flex-1 flex-col">
              <span
                class={`truncate text-sm ${group.status === "pending" ? "text-muted-foreground" : ""}`}
              >
                {group.label}
              </span>
              {#if group.status === "active" && activeDetail(group)}
                <span class="truncate text-xs text-muted-foreground">
                  {activeDetail(group)}
                </span>
              {:else if group.error}
                <span class="truncate text-xs text-destructive">
                  {group.error}
                </span>
              {/if}
            </div>
            {#if groupMeta(group)}
              <span
                class="flex-none font-mono text-xs text-muted-foreground tabular-nums"
              >
                {groupMeta(group)}
              </span>
            {/if}
            {#if expandable}
              <ChevronDown
                class={`size-3.5 flex-none text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
              />
            {/if}
          </button>

          {#if open}
            <div class="flex flex-col gap-1.5 border-t bg-muted/20 px-2.5 py-2">
              {#each group.phases as phase (phase.id)}
                <div class="flex items-start gap-2 text-xs">
                  <span
                    class={`mt-0.5 size-1.5 flex-none rounded-full ${
                      phase.status === "active"
                        ? "bg-info"
                        : phase.status === "done"
                          ? "bg-success"
                          : phase.status === "failed"
                            ? "bg-destructive"
                            : phase.status === "degraded"
                              ? "bg-warning"
                              : "bg-muted-foreground/40"
                    }`}
                  ></span>
                  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div class="flex items-baseline justify-between gap-2">
                      <span
                        class={phase.status === "pending"
                          ? "text-muted-foreground"
                          : ""}>{phase.label}</span
                      >
                      {#if phaseMeta(phase)}
                        <span
                          class="flex-none font-mono text-muted-foreground tabular-nums"
                          >{phaseMeta(phase)}</span
                        >
                      {/if}
                    </div>
                    {#if phase.error}
                      <span class="text-destructive">{phase.error}</span>
                    {/if}
                    {#if phase.id === "boot"}
                      {#each bootSteps() as step (step.key)}
                        <div class="flex flex-col gap-1">
                          <span
                            class={`truncate ${
                              step.status === "failed" ||
                              step.status === "timeout"
                                ? "text-destructive"
                                : "text-muted-foreground"
                            }`}
                          >
                            {bootStepSummary(step)}
                          </span>
                          {#if step.error && step.error !== phase.error}
                            <span class="text-destructive">{step.error}</span>
                          {/if}
                          {#if variant === "banner" && (step.status === "failed" || step.status === "timeout")}
                            {#if step.stderr?.text}
                              <CodeViewer
                                text={step.stderr.text}
                                wrap
                                class="max-h-40 overflow-auto rounded-md border"
                              />
                            {:else if step.stdout?.text}
                              <CodeViewer
                                text={step.stdout.text}
                                wrap
                                class="max-h-40 overflow-auto rounded-md border"
                              />
                            {/if}
                          {/if}
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>
              {/each}
              {#if group.status === "failed" && onOpenLogs}
                <div class="mt-1">
                  <Button size="xs" variant="outline" onclick={onOpenLogs}>
                    Open logs
                  </Button>
                </div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>
