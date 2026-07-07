<script lang="ts">
  import {
    ChevronDown,
    ChevronRight,
    Circle,
    CircleCheck,
    CircleX,
    Loader2,
    MinusCircle,
    TriangleAlert,
  } from "@lucide/svelte";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { Progress } from "@nervekit/ui/components/ui/progress";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import type { StatusTone } from "@nervekit/ui/components/ui/status-dot";
  import {
    computeSandboxBootProgress,
    type BootPhaseStatus,
    type BootState,
  } from "../state/sandbox-boot-progress";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";

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

  const stateTone: Record<BootState, StatusTone> = {
    provisioning: "running",
    booting: "running",
    ready: "good",
    failed: "danger",
  };

  function phaseIcon(status: BootPhaseStatus) {
    switch (status) {
      case "active":
        return Loader2;
      case "done":
        return CircleCheck;
      case "skipped":
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
        return "text-muted-foreground";
      default:
        return "text-muted-foreground/50";
    }
  }
</script>

<section
  class={variant === "rail"
    ? "flex min-h-0 flex-1 flex-col gap-3 p-4"
    : "flex flex-col gap-3 rounded-md border bg-card p-3"}
>
  <div class="flex items-center gap-2">
    <StatusDot
      tone={stateTone[progress.state]}
      pulse={progress.state === "provisioning" || progress.state === "booting"}
    />
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold">{progress.headline}</p>
    </div>
    <span class="font-mono text-xs text-muted-foreground tabular-nums">
      {progress.completed}/{progress.total}
    </span>
    {#if variant === "rail" && onToggle}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel={expanded ? "Collapse boot details" : "Expand boot details"}
        onclick={onToggle}
      >
        {#if expanded}
          <ChevronDown class="size-4" />
        {:else}
          <ChevronRight class="size-4" />
        {/if}
      </Button>
    {/if}
  </div>

  {#if expanded}
    <Progress value={progress.fraction * 100} />

    <ol class="flex flex-col gap-2.5">
      {#each progress.phases as phase (phase.id)}
        {@const Icon = phaseIcon(phase.status)}
        <li class="flex items-start gap-2.5">
          <Icon
            class={`mt-0.5 size-4 flex-none ${phaseTone(phase.status)} ${phase.status === "active" ? "animate-spin" : ""}`}
          />
          <div class="flex min-w-0 flex-col">
            <span class="text-sm">{phase.label}</span>
            <span class="text-xs text-muted-foreground">{phase.description}</span>
            {#if phase.error}
              <span class="text-xs text-destructive">{phase.error}</span>
            {/if}
            {#if phase.ts}
              <span class="font-mono text-xs text-muted-foreground">{phase.ts}</span>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  {:else if progress.state === "ready"}
    <button
      type="button"
      class="flex items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground"
      onclick={onToggle}
    >
      <CircleCheck class="size-4 flex-none text-success" />
      <span>All systems ready · {progress.total} steps — view details</span>
    </button>
  {/if}
</section>
