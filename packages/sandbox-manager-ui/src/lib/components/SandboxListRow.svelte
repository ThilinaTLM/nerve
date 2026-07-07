<script lang="ts">
  import { ChevronRight } from "@lucide/svelte";
  import type {
    ManagedSandboxRecord,
    SandboxActivitySummary,
  } from "@nervekit/shared";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import SandboxActionMenu from "./SandboxActionMenu.svelte";
  import SandboxStatusBadge from "./SandboxStatusBadge.svelte";

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
</script>

<li
  class="group flex items-center gap-3 rounded-md border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
>
  <button
    type="button"
    class="flex min-w-0 flex-1 items-center gap-3 text-left"
    onclick={onOpen}
  >
    <div class="flex min-w-0 flex-col">
      <span class="truncate text-sm font-medium">
        {record.name ?? record.sandboxId}
      </span>
      {#if activity?.title}
        <span class="truncate text-xs text-muted-foreground">{activity.title}</span>
      {:else if booting}
        <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot tone="running" pulse size="xs" />
          Setting up…
        </span>
      {:else}
        <span class="truncate font-mono text-xs text-muted-foreground">
          {record.image.reference}
        </span>
      {/if}
    </div>
  </button>
  <div class="flex items-center gap-2">
    {#if activity?.model}
      <span class="hidden font-mono text-xs text-muted-foreground sm:inline">
        {activity.model}
      </span>
    {/if}
    <SandboxStatusBadge {record} />
    <SandboxActionMenu {record} compact />
    <ChevronRight
      class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
    />
  </div>
</li>
