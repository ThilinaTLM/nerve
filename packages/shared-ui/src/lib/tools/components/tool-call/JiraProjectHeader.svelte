<script lang="ts">
  import User from "@lucide/svelte/icons/user";
  import type { JiraProjectSummaryPayload } from "@nervekit/shared";
  import { Badge } from "@nervekit/shared-ui/components/ui/badge";

  type Props = { project: JiraProjectSummaryPayload };
  let { project }: Props = $props();
</script>

<div class="grid gap-1.5 rounded-sm border bg-sidebar px-2.5 py-2">
  <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
    <span class="font-mono text-xs font-semibold text-primary">{project.key}</span>
    {#if project.name}
      <span class="min-w-0 break-words text-xs font-medium leading-snug text-sidebar-foreground">{project.name}</span>
    {/if}
  </div>
  {#if project.projectTypeKey || project.lead}
    <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {#if project.projectTypeKey}
        <Badge tone="neutral" size="xs">{project.projectTypeKey}</Badge>
      {/if}
      {#if project.lead}
        <span class="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <User size={12} strokeWidth={2} class="shrink-0" />
          <span class="truncate">{project.lead}</span>
        </span>
      {/if}
    </div>
  {/if}
</div>
