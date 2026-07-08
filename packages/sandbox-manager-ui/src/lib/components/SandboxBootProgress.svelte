<script lang="ts">
  import {
    ChevronDown,
    Circle,
    CircleCheck,
    CircleX,
    Loader2,
    MinusCircle,
    TriangleAlert,
  } from "@lucide/svelte";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { onMount } from "svelte";
  import { StatusDot } from "@nervekit/shared-ui/components/ui/status-dot";
  import type { StatusTone } from "@nervekit/shared-ui/components/ui/status-dot";
  import {
    computeSandboxBootProgress,
    sandboxSetupTimeline,
    type BootPhase,
    type BootPhaseStatus,
    type BootState,
  } from "../state/sandbox-boot-progress";
  import { sandboxIsReadOnly, sandboxLifecycleMessage } from "../state/sandbox-lifecycle";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import type { SandboxSetupTimelineItem } from "../state/sandbox-ui-types";

  let {
    record,
    variant = "rail",
    expanded = true,
    onToggle,
  }: {
    record: ManagedSandboxRecord;
    variant?: "rail" | "banner";
    expanded?: boolean;
    onToggle?: () => void;
  } = $props();

  const store = useSandboxManagerStore();
  const detail = $derived(store.details[record.sandboxId]);
  const progress = $derived(computeSandboxBootProgress(record, detail));
  const showPhaseStepper = $derived(expanded);
  const container = $derived(detail?.status?.container ?? detail?.snapshot?.container);
  const session = $derived(detail?.latestSession ?? detail?.status?.lastSession ?? detail?.snapshot?.lastSession);
  const staleness = $derived(detail?.status?.staleness ?? detail?.snapshot?.staleness);
  const readOnly = $derived(sandboxIsReadOnly(record, detail));
  const lifecycleMessage = $derived(sandboxLifecycleMessage(record, detail));
  let openPhases = $state<Record<string, boolean>>({});
  let now = $state(Date.now());

  onMount(() => {
    const timer = window.setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => window.clearInterval(timer);
  });

  const stateTone: Record<BootState, StatusTone> = {
    provisioning: "running",
    booting: "running",
    ready: "good",
    failed: "danger",
    offline: "neutral",
  };

  function phaseIcon(status: BootPhaseStatus) {
    switch (status) {
      case "active":
        return Loader2;
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

  function phaseTone(status: BootPhaseStatus): string {
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

  function formatMs(value: number | undefined): string {
    if (value === undefined) return "—";
    if (value < 1000) return `${value} ms`;
    return `${(value / 1000).toFixed(1)} s`;
  }

  function formatCompactMs(value: number | undefined): string | undefined {
    if (value === undefined) return undefined;
    if (value < 1000) return `${value} ms`;
    if (value < 60_000) return `${Math.round(value / 1000)}s`;
    return `${Math.round(value / 60_000)}m`;
  }

  function elapsedMs(item: SandboxSetupTimelineItem): number | undefined {
    const started = Date.parse(item.startedAt ?? item.ts);
    if (!Number.isFinite(started)) return undefined;
    return Math.max(0, now - started);
  }

  function bootTimeline(): SandboxSetupTimelineItem[] {
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

  function activeBootItem(): SandboxSetupTimelineItem | undefined {
    return bootTimeline()
      .filter((item) => item.status === "started")
      .at(-1);
  }

  function bootActiveSummary(item: SandboxSetupTimelineItem): string {
    const timeout = formatCompactMs(item.timeoutMs);
    return [
      `Running ${itemTitle(item)}`,
      item.runAs,
      item.network,
      timeout ? `timeout ${timeout}` : undefined,
      `elapsed ${formatMs(elapsedMs(item))}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function phaseTimeline(phaseId: string): SandboxSetupTimelineItem | undefined {
    return sandboxSetupTimeline(detail)
      .filter((item) => item.phase === phaseId)
      .at(-1);
  }

  function phaseHasDetails(phase: BootPhase): boolean {
    if (phase.id === "container") return Boolean(container);
    if (phase.id === "boot") return bootTimeline().length > 0;
    if (phase.id === "ready") return Boolean(session || staleness || readOnly);
    return Boolean(phaseTimeline(phase.id));
  }

  function togglePhase(phaseId: string): void {
    openPhases[phaseId] = !openPhases[phaseId];
  }

  function itemTitle(item: SandboxSetupTimelineItem): string {
    if (item.phase === "boot") {
      const prefix = item.index !== undefined ? `#${item.index + 1}` : "Boot";
      return `${prefix} ${item.name ?? "phase"}`;
    }
    return item.phase;
  }

  function rowsForItem(item: SandboxSetupTimelineItem) {
    return [
      { label: "Status", value: item.status },
      { label: "Started", value: formatDate(item.startedAt ?? item.ts) },
      { label: "Completed", value: formatDate(item.completedAt) },
      {
        label: item.status === "started" ? "Elapsed" : "Duration",
        value:
          item.status === "started"
            ? formatMs(elapsedMs(item))
            : formatMs(item.durationMs),
      },
      { label: "Run as", value: item.runAs ?? "—" },
      { label: "Network", value: item.network ?? "—" },
      { label: "Timeout", value: item.timeoutMs ? formatMs(item.timeoutMs) : "—" },
      { label: "Exit", value: item.exitCode === undefined ? "—" : String(item.exitCode) },
    ];
  }

  function containerRows() {
    return [
      { label: "Runtime", value: container?.runtime ?? record.backend },
      { label: "State", value: container?.state ?? record.observedState },
      { label: "Health", value: container?.health ?? "—" },
      { label: "Exit", value: container?.exitCode === undefined ? "—" : String(container.exitCode) },
      { label: "Started", value: formatDate(container?.startedAt ?? record.startedAt) },
      { label: "Finished", value: formatDate(container?.finishedAt ?? record.stoppedAt) },
      { label: "Observed", value: formatDate(container?.observedAt) },
    ];
  }
</script>

<section
  class={variant === "rail"
    ? "flex min-h-0 flex-1 flex-col gap-3 p-4"
    : "flex flex-col gap-3 rounded-md border bg-card p-3"}
>
  {#snippet headerContent()}
    <StatusDot
      tone={stateTone[progress.state]}
      pulse={progress.state === "provisioning" || progress.state === "booting"}
    />
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold">{progress.headline}</p>
      {#if readOnly}
        <p class="truncate text-xs text-muted-foreground">{lifecycleMessage}</p>
      {/if}
    </div>
    <span class="font-mono text-xs text-muted-foreground tabular-nums">
      {progress.completed}/{progress.total}
    </span>
  {/snippet}

  {#if onToggle}
    <button
      type="button"
      class="flex w-full items-center gap-2 text-left"
      aria-expanded={showPhaseStepper}
      aria-label={showPhaseStepper ? "Collapse boot details" : "Expand boot details"}
      onclick={onToggle}
    >
      {@render headerContent()}
      <ChevronDown
        class={`size-4 flex-none text-muted-foreground transition-transform ${showPhaseStepper ? "" : "-rotate-90"}`}
      />
    </button>
  {:else}
    <div class="flex w-full items-center gap-2">
      {@render headerContent()}
    </div>
  {/if}

  {#if showPhaseStepper}
    <ol class="flex flex-col gap-2.5">
      {#each progress.phases as phase (phase.id)}
        {@const Icon = phaseIcon(phase.status)}
        {@const hasDetails = phaseHasDetails(phase)}
        {@const activeBoot = phase.id === "boot" ? activeBootItem() : undefined}
        <li class="overflow-hidden rounded-md border bg-background/50">
          <button
            type="button"
            class="flex w-full items-start gap-2.5 p-2 text-left disabled:cursor-default"
            aria-expanded={hasDetails ? openPhases[phase.id] : undefined}
            aria-label={hasDetails
              ? openPhases[phase.id]
                ? `Hide ${phase.label} details`
                : `Show ${phase.label} details`
              : undefined}
            disabled={!hasDetails}
            onclick={() => togglePhase(phase.id)}
          >
            <Icon
              class={`mt-0.5 size-4 flex-none ${phaseTone(phase.status)} ${phase.status === "active" ? "animate-spin" : ""}`}
            />
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <div class="flex items-baseline gap-2">
                {#if phase.ts}
                  <span
                    class="font-mono text-xs text-muted-foreground tabular-nums"
                    title={formatDate(phase.ts)}
                  >{formatClock(phase.ts)}</span>
                {/if}
                <span class="truncate text-sm">{phase.label}</span>
              </div>
              {#if activeBoot}
                <span class="truncate text-xs text-muted-foreground">{bootActiveSummary(activeBoot)}</span>
              {:else}
                <span class="text-xs text-muted-foreground">{phase.description}</span>
              {/if}
              {#if phase.error}
                <span class="text-xs text-destructive">{phase.error}</span>
              {/if}
            </div>
            {#if hasDetails}
              <ChevronDown
                class={`mt-0.5 size-3.5 flex-none text-muted-foreground transition-transform ${openPhases[phase.id] ? "" : "-rotate-90"}`}
              />
            {/if}
          </button>

          {#if hasDetails && openPhases[phase.id]}
            <div class="border-t px-2 py-2 text-xs">
              {#if phase.id === "container"}
                <dl class="grid gap-1 sm:grid-cols-2">
                  {#each containerRows() as row (row.label)}
                    <div class="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
                      <dt class="text-muted-foreground">{row.label}</dt>
                      <dd class="truncate font-mono">{row.value}</dd>
                    </div>
                  {/each}
                </dl>
                {#if container?.lastError}
                  <p class="mt-2 text-destructive">{container.lastError.code}: {container.lastError.message}</p>
                {/if}
                {#if container?.limitations?.length}
                  <ul class="mt-2 list-disc pl-4 text-muted-foreground">
                    {#each container.limitations as limitation}
                      <li>{limitation}</li>
                    {/each}
                  </ul>
                {/if}
              {:else if phase.id === "boot"}
                <div class="flex flex-col gap-2">
                  {#each bootTimeline() as item (item.key)}
                    <article class="rounded-md border bg-card p-2">
                      <div class="flex items-center justify-between gap-2">
                        <p class="truncate text-xs font-medium">{itemTitle(item)}</p>
                        <span class="font-mono text-xs text-muted-foreground">{item.status}</span>
                      </div>
                      <dl class="mt-2 grid gap-1 sm:grid-cols-2">
                        {#each rowsForItem(item) as row (row.label)}
                          <div class="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
                            <dt class="text-muted-foreground">{row.label}</dt>
                            <dd class="truncate font-mono">{row.value}</dd>
                          </div>
                        {/each}
                      </dl>
                      {#if item.error}
                        <p class="mt-2 text-destructive">{item.error}</p>
                      {/if}
                      {#if item.stdout?.text}
                        <div class="mt-2">
                          <p class="mb-1 text-muted-foreground">stdout{item.stdout.truncated ? " (truncated)" : ""}</p>
                          <pre class="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap">{item.stdout.text}</pre>
                        </div>
                      {/if}
                      {#if item.stderr?.text}
                        <div class="mt-2">
                          <p class="mb-1 text-muted-foreground">stderr{item.stderr.truncated ? " (truncated)" : ""}</p>
                          <pre class="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap">{item.stderr.text}</pre>
                        </div>
                      {/if}
                    </article>
                  {/each}
                </div>
              {:else if phase.id === "ready"}
                <dl class="grid gap-1 sm:grid-cols-2">
                  <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
                    <dt class="text-muted-foreground">Controller</dt>
                    <dd>{detail?.status?.connected || detail?.controllerConnected ? "connected" : "disconnected"}</dd>
                  </div>
                  <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
                    <dt class="text-muted-foreground">Session</dt>
                    <dd class="truncate font-mono">{session?.sessionId ?? "—"}</dd>
                  </div>
                  <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
                    <dt class="text-muted-foreground">Stale</dt>
                    <dd>{staleness?.reason ?? "—"}</dd>
                  </div>
                  <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
                    <dt class="text-muted-foreground">Read-only</dt>
                    <dd>{readOnly ? "yes" : "no"}</dd>
                  </div>
                </dl>
                {#if readOnly}
                  <p class="mt-2 text-muted-foreground">{lifecycleMessage}</p>
                {/if}
              {:else if phaseTimeline(phase.id)}
                {@const item = phaseTimeline(phase.id)}
                {#if item}
                  <dl class="grid gap-1 sm:grid-cols-2">
                    {#each rowsForItem(item) as row (row.label)}
                      <div class="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
                        <dt class="text-muted-foreground">{row.label}</dt>
                        <dd class="truncate font-mono">{row.value}</dd>
                      </div>
                    {/each}
                  </dl>
                  {#if item.error}
                    <p class="mt-2 text-destructive">{item.error}</p>
                  {/if}
                  {#if item.limitations?.length}
                    <ul class="mt-2 list-disc pl-4 text-muted-foreground">
                      {#each item.limitations as limitation}
                        <li>{limitation}</li>
                      {/each}
                    </ul>
                  {/if}
                {/if}
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>
