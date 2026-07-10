<script lang="ts">
import type { JiraUserSummaryPayload } from "@nervekit/contracts";
import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
import { jiraInitials } from "../../views/jira-display";

type Props = { user: JiraUserSummaryPayload };
let { user }: Props = $props();

const initials = $derived(jiraInitials(user));
const name = $derived(user.displayName ?? user.emailAddress ?? user.accountId);
</script>

<div
  class="flex min-w-0 items-center gap-2.5 rounded-sm border bg-sidebar px-2.5 py-2"
>
  <span
    class="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
    aria-hidden="true">{initials}</span
  >
  <div class="grid min-w-0 flex-1 gap-0.5">
    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span class="min-w-0 truncate text-xs font-medium text-sidebar-foreground"
        >{name}</span
      >
      {#if user.emailAddress && user.emailAddress !== name}
        <span class="min-w-0 truncate font-mono text-xs text-muted-foreground"
          >{user.emailAddress}</span
        >
      {/if}
      {#if user.accountType}
        <Badge tone="neutral" size="xs">{user.accountType}</Badge>
      {/if}
      {#if user.active === false}
        <Badge tone="warn" size="xs">inactive</Badge>
      {/if}
    </div>
    <span class="truncate font-mono text-xs text-muted-foreground/80"
      >{user.accountId}</span
    >
  </div>
</div>
