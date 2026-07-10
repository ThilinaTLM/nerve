<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import type { JiraTransitionSummaryPayload } from "@nervekit/contracts";
  import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
  import { jiraStatusTone } from "../../views/jira-display";

  type Props = { transition: JiraTransitionSummaryPayload };
  let { transition }: Props = $props();

  const name = $derived(transition.name ?? "(unnamed)");
  const toTone = $derived(
    jiraStatusTone(transition.to, transition.toStatusCategory),
  );
  // Only show the "→ target" when it adds information beyond the name.
  const showTarget = $derived(
    Boolean(transition.to && transition.to !== transition.name),
  );
</script>

<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border bg-sidebar px-2.5 py-2">
  <span class="rounded-sm border bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{transition.id}</span>
  <span class="text-xs font-medium text-sidebar-foreground">{name}</span>
  {#if showTarget}
    <ArrowRight size={13} strokeWidth={2} class="text-muted-foreground" />
    <Badge tone={toTone} size="xs">{transition.to}</Badge>
  {:else if transition.to}
    <Badge tone={toTone} size="xs">{transition.to}</Badge>
  {/if}
</div>
