<script lang="ts">
  import { ChevronRight } from "@lucide/svelte";
  import type {
    ManagedSandboxRecord,
    SandboxActivitySummary,
  } from "@nervekit/shared";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import SandboxActionMenu from "./SandboxActionMenu.svelte";
  import SandboxStatusBadge from "./SandboxStatusBadge.svelte";
  import { observedStateTone } from "../state/sandbox-status";

  let {
    record,
    activity,
    onOpen,
  }: {
    record: ManagedSandboxRecord;
    activity?: SandboxActivitySummary;
    onOpen: () => void;
  } = $props();

  const booting = $derived(
    record.observedState === "creating" || record.observedState === "starting",
  );
  const degraded = $derived(
    record.observedState === "failed" ||
      record.observedState === "reconnecting" ||
      Boolean(record.lastError),
  );
  const running = $derived(
    activity?.runStatus === "running" && record.observedState === "running",
  );

  const dotTone = $derived(
    activity?.needsAttention
      ? "warn"
      : running
        ? "good"
        : observedStateTone(record.observedState),
  );

  const taskLine = $derived(
    activity?.title ??
      (booting
        ? "Setting up…"
        : record.lastError
          ? `${record.lastError.code}: ${record.lastError.message}`
          : record.image.reference),
  );
  const taskIsMono = $derived(!activity?.title && !booting && !record.lastError);

  const showContext = $derived(
    typeof activity?.contextUsagePct === "number" &&
      activity.contextUsagePct >= 0,
  );
</script>

<div
  class="group flex flex-col gap-3 rounded-md border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
>
  <div class="flex items-center gap-2">
    <StatusDot tone={dotTone} pulse={running || booting} />
    <button
      type="button"
      class="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-foreground/90"
      onclick={onOpen}
    >
      {record.name ?? record.sandboxId}
    </button>
    <SandboxStatusBadge {record} />
    <SandboxActionMenu {record} compact />
  </div>

  <button
    type="button"
    class="min-h-9 text-left text-xs leading-snug text-muted-foreground"
    onclick={onOpen}
  >
    <span class={taskIsMono ? "font-mono" : ""}>{taskLine}</span>
  </button>

  {#if showContext}
    <div
      class="h-1.5 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label="Context usage"
      aria-valuenow={Math.round(activity?.contextUsagePct ?? 0)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        class={`h-full ${degraded ? "bg-destructive" : "bg-primary"}`}
        style={`width:${Math.min(100, Math.max(0, activity?.contextUsagePct ?? 0))}%`}
      ></div>
    </div>
  {/if}

  <button
    type="button"
    class="flex items-center justify-between gap-2 text-left"
    onclick={onOpen}
  >
    <span class="min-w-0 truncate text-xs text-muted-foreground">
      {#if activity?.model}
        <span class="font-mono text-foreground/80">{activity.model}</span>
      {:else}
        <span class="text-muted-foreground/70">—</span>
      {/if}
    </span>
    <ChevronRight
      class="size-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5"
    />
  </button>
</div>
