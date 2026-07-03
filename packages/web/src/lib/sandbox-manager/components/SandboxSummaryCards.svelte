<script lang="ts">
  import { Boxes, CircleAlert, MessageCircleQuestion, Play } from "@lucide/svelte";
  import { Card, CardContent } from "$lib/components/ui/card";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import { fleetSummary } from "../state/sandbox-manager-selectors.svelte";

  const store = useSandboxManagerStore();
  const summary = $derived(fleetSummary(store));

  const cards = $derived([
    { label: "Sandboxes", value: summary.total, icon: Boxes, tone: "text-foreground" },
    { label: "Running", value: summary.running, icon: Play, tone: "text-success" },
    {
      label: "Degraded / failed",
      value: summary.degraded + summary.failed,
      icon: CircleAlert,
      tone: "text-destructive",
    },
    {
      label: "Pending waits",
      value: summary.pendingWaits,
      icon: MessageCircleQuestion,
      tone: "text-warning",
    },
  ]);
</script>

<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
  {#each cards as card (card.label)}
    {@const Icon = card.icon}
    <Card>
      <CardContent class="flex items-center gap-3 p-4">
        <Icon class={`size-5 ${card.tone}`} />
        <div class="flex flex-col">
          <span class="text-2xl font-semibold tabular-nums">{card.value}</span>
          <span class="text-xs text-muted-foreground">{card.label}</span>
        </div>
      </CardContent>
    </Card>
  {/each}
</div>
