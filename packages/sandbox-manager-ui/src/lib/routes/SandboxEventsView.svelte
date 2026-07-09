<script lang="ts">
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Badge } from "@nervekit/shared-ui/components/ui/badge";
  import DialogShell from "@nervekit/shared-ui/components/ui/dialog-shell";
  import { ScrollArea } from "@nervekit/shared-ui/components/ui/scroll-area";
  import TabsBar from "@nervekit/shared-ui/components/ui/tabs-bar";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import type { SandboxUiEvent } from "../state/sandbox-ui-types";

  let { record }: { record: ManagedSandboxRecord } = $props();

  const store = useSandboxManagerStore();
  const detail = $derived(store.details[record.sandboxId]);

  let filter = $state("all");
  let selected = $state<SandboxUiEvent | undefined>(undefined);

  const filterTabs = [
    { value: "all", label: "All" },
    { value: "lifecycle", label: "Lifecycle" },
    { value: "run", label: "Run" },
    { value: "tool", label: "Tool" },
    { value: "setup", label: "Setup" },
  ];

  function category(type: string): string {
    if (type.startsWith("run.")) return "run";
    if (type.startsWith("tool.")) return "tool";
    if (type.startsWith("sandbox.setup") || type.startsWith("sandbox.boot"))
      return "setup";
    return "lifecycle";
  }

  const events = $derived(
    (detail?.events ?? [])
      .filter((event) => filter === "all" || category(event.type) === filter)
      .slice()
      .reverse(),
  );
</script>

<div class="flex h-full flex-col">
  <div class="flex-none border-b px-2 py-1">
    <TabsBar tabs={filterTabs} bind:value={filter} ariaLabel="Event filters" />
  </div>
  <ScrollArea class="min-h-0 flex-1">
    {#if events.length === 0}
      <p class="p-4 text-sm text-muted-foreground">No events captured yet.</p>
    {:else}
      <ul class="flex flex-col divide-y">
        {#each events as event (event.stream + ":" + event.seq)}
          <li>
            <button
              type="button"
              class="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-muted"
              onclick={() => (selected = event)}
            >
              <Badge tone="neutral" size="xs" class="font-mono">#{event.seq}</Badge>
              <span class="min-w-0 flex-1 truncate font-mono text-xs">{event.type}</span>
              {#if event.durability === "transient"}
                <Badge tone="warn" size="xs">transient</Badge>
              {/if}
              <span class="font-mono text-xs text-muted-foreground">{event.ts}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </ScrollArea>
</div>

<DialogShell
  open={selected !== undefined}
  title={selected?.type ?? "Event"}
  description={selected ? `${selected.stream} · seq ${selected.seq}` : undefined}
  onOpenChange={(open) => {
    if (!open) selected = undefined;
  }}
>
  <pre
    class="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap"
  >{selected ? JSON.stringify(selected.data ?? {}, null, 2) : ""}</pre>
</DialogShell>
