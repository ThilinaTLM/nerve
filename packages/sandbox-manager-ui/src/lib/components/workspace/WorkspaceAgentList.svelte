<script lang="ts">
  import { PanelLeftClose, Plus } from "@lucide/svelte";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import { activityFor } from "../../state/sandbox-manager-selectors.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import { observedStateTone } from "../../state/sandbox-status";

  let {
    activeSandboxId,
    onSelect,
    onCreate,
    onCollapse,
  }: {
    activeSandboxId: string;
    onSelect: (sandboxId: string) => void;
    onCreate: () => void;
    onCollapse: () => void;
  } = $props();

  const store = useSandboxManagerStore();
</script>

<div class="flex h-full w-full flex-col border-r bg-background">
  <div class="flex flex-none items-center justify-between gap-2 border-b px-3 py-2">
    <span class="text-sm font-semibold">Sandboxes</span>
    <div class="flex items-center gap-0.5">
      <Button variant="ghost" size="icon-sm" ariaLabel="New sandbox" title="New sandbox" onclick={onCreate}>
        <Plus class="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Collapse sandbox list"
        title="Collapse sandbox list"
        onclick={onCollapse}
      >
        <PanelLeftClose class="size-4" />
      </Button>
    </div>
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto p-2">
    <ul class="flex flex-col gap-0.5">
      {#each store.sandboxes as record (record.sandboxId)}
        {@const activity = activityFor(store, record.sandboxId)}
        {@const active = record.sandboxId === activeSandboxId}
        {@const running =
          activity?.runStatus === "running" &&
          record.observedState === "running"}
        <li>
          <button
            type="button"
            class={`flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted ${active ? "bg-muted" : ""}`}
            aria-current={active ? "page" : undefined}
            onclick={() => onSelect(record.sandboxId)}
          >
            <span class="mt-1">
              <StatusDot
                tone={activity?.needsAttention
                  ? "warn"
                  : running
                    ? "good"
                    : observedStateTone(record.observedState)}
                size="xs"
                pulse={running}
              />
            </span>
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-sm font-medium">
                {record.name ?? record.sandboxId}
              </span>
              <span class="truncate text-xs text-muted-foreground">
                {activity?.title ?? record.observedState}
              </span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  </div>
</div>
