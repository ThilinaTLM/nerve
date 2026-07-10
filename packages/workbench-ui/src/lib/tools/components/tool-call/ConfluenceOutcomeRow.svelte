<script lang="ts">
  import type { ConfluencePublishOutcomePayload } from "@nervekit/contracts";
  import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
  import { confluenceOutcomeBadgeTone } from "../../views/confluence-display";

  type Props = {
    outcome: ConfluencePublishOutcomePayload;
    expanded?: boolean;
  };
  let { outcome, expanded = false }: Props = $props();

  const label = $derived(outcome.status ?? outcome.operation ?? "row");
</script>

<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border bg-sidebar px-2.5 py-2">
  <Badge tone={confluenceOutcomeBadgeTone(outcome.status)} size="xs">{label}</Badge>
  {#if outcome.id}
    <code class="font-mono text-xs text-sidebar-foreground">{outcome.id}</code>
  {/if}
  {#if outcome.title}
    <span class={`text-xs text-muted-foreground${expanded ? "" : " min-w-0 truncate"}`}>{outcome.title}</span>
  {/if}
  {#if outcome.message}
    <span class={`text-xs text-muted-foreground${expanded ? "" : " min-w-0 truncate"}`}>{outcome.message}</span>
  {/if}
</div>
