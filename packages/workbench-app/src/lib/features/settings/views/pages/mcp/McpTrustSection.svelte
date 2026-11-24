<!-- The project's MCP servers on its Trust page: each entry waits for, or records, the user's decision, made on the server's page. -->
<script lang="ts">
import Plug from "@lucide/svelte/icons/plug";
import {
  PageEmptyState,
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { mcpTarget } from "$lib/application/mcp/mcp-api";
import { McpServersState } from "$lib/application/mcp/mcp-servers-state.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { SettingsSection, TipBadge } from "$lib/presentation/settings";
import { mcpItemId } from "$lib/application/mcp/mcp-item";
import { mcpCommandLine } from "./mcp-view";

let {
  projectId,
  onOpen,
}: {
  projectId: string;
  /** Opens a server's page on Settings › MCP servers (`mcpItemId`). */
  onOpen?: (item: string) => void;
} = $props();

const list = new McpServersState();
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void list.load(mcpTarget("project", projectId));
});
$effect(() => list.observe());

const servers = $derived(list.rows.filter((row) => row.scope === "project"));
const status = {
  approved: {
    label: "Trusted",
    variant: "success",
    tip: "Reviewed by you. It applies only while its entry is unchanged.",
  },
  needs_approval: {
    label: "Needs review",
    variant: "warning",
    tip: "Not used until you review it. Any change asks again.",
  },
  rejected: {
    label: "Rejected",
    variant: "destructive",
    tip: "You rejected this entry. It stays off until you approve it.",
  },
} as const;
</script>

<SettingsSection id="mcp-servers" title="MCP servers" surface={false}>
  {#if servers.length === 0}
    <PageEmptyState variant="card" icon={Plug} title="None." />
  {:else}
    <PageList ariaLabel="Project MCP servers">
      {#each servers as row (row.name)}
        {@const tone = status[row.review]}
        <PageItem
          title={row.name}
          icon={Plug}
          summary={mcpCommandLine(row)}
          mono
        >
          {#snippet badges()}
            <TipBadge text={tone.label} tip={tone.tip} variant={tone.variant} />
          {/snippet}
          {#snippet actions()}
            <Button
              size="sm"
              variant="outline"
              disabled={!onOpen}
              onclick={() => onOpen?.(mcpItemId(row.scope, row.name))}
              >{row.review === "approved"
                ? "Review"
                : "Review and trust"}</Button
            >
          {/snippet}
        </PageItem>
      {/each}
    </PageList>
  {/if}
</SettingsSection>
