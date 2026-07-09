<script lang="ts">
  import { CircleCheck, CircleDot, CircleX, MinusCircle } from "@lucide/svelte";
  import type { ManagedSandboxRecord, StartupSetupStatus } from "@nervekit/shared";
  import { Card, CardContent, CardHeader, CardTitle } from "@nervekit/shared-ui/components/ui/card";
  import { ScrollArea } from "@nervekit/shared-ui/components/ui/scroll-area";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";

  let { record }: { record: ManagedSandboxRecord } = $props();

  const store = useSandboxManagerStore();
  const detail = $derived(store.details[record.sandboxId]);
  const setup = $derived(detail?.status?.setup);

  const setupPhases = $derived<Array<{ phase: string; status: StartupSetupStatus }>>(
    setup
      ? [
          { phase: "git", status: setup.git },
          { phase: "github", status: setup.github },
          { phase: "boot", status: setup.boot },
          { phase: "skills", status: setup.skills },
        ].filter(
          (entry): entry is { phase: string; status: StartupSetupStatus } =>
            Boolean(entry.status),
        )
      : [],
  );

  function iconFor(status: string) {
    if (status === "completed") return CircleCheck;
    if (status === "failed") return CircleX;
    if (status === "skipped") return MinusCircle;
    return CircleDot;
  }

  function toneFor(status: string) {
    if (status === "completed") return "text-success";
    if (status === "failed") return "text-destructive";
    if (status === "skipped") return "text-muted-foreground";
    return "text-info";
  }
</script>

<ScrollArea class="h-full">
  <div class="flex flex-col gap-4 p-4">
    <Card class="rounded-md border">
      <CardHeader><CardTitle class="text-sm">Setup status</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-2 text-sm">
        {#if setupPhases.length === 0}
          <p class="text-muted-foreground">No setup status reported yet.</p>
        {:else}
          {#each setupPhases as entry (entry.phase)}
            {@const Icon = iconFor(entry.status.status)}
            <div class="flex items-start gap-2">
              <Icon class={`mt-0.5 size-4 ${toneFor(entry.status.status)}`} />
              <div class="flex min-w-0 flex-col">
                <span class="capitalize">{entry.phase} — {entry.status.status}</span>
                {#if entry.status.error}
                  <span class="text-xs text-destructive">
                    {entry.status.error.code}: {entry.status.error.message}
                  </span>
                {/if}
                {#if entry.status.limitations?.length}
                  <span class="text-xs text-muted-foreground">
                    {entry.status.limitations.join(", ")}
                  </span>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </CardContent>
    </Card>

    <Card class="rounded-md border">
      <CardHeader><CardTitle class="text-sm">Boot timeline</CardTitle></CardHeader>
      <CardContent>
        {#if !detail || detail.setupTimeline.length === 0}
          <p class="text-sm text-muted-foreground">
            No boot events observed on the live stream yet.
          </p>
        {:else}
          <ol class="flex flex-col gap-2">
            {#each detail.setupTimeline as item (item.key)}
              {@const Icon = iconFor(item.status)}
              <li class="flex items-start gap-2 text-sm">
                <Icon class={`mt-0.5 size-4 ${toneFor(item.status)}`} />
                <div class="flex min-w-0 flex-col">
                  <span class="capitalize">{item.phase} — {item.status}</span>
                  {#if item.detail}
                    <span class="text-xs text-muted-foreground">{item.detail}</span>
                  {/if}
                  <span class="font-mono text-xs text-muted-foreground">{item.ts}</span>
                </div>
              </li>
            {/each}
          </ol>
        {/if}
      </CardContent>
    </Card>
  </div>
</ScrollArea>
