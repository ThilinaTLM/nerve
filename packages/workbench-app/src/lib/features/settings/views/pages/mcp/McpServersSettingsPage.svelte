<!--
  Settings › MCP servers. Lists the servers of the user's mcp.json and, with a
  project open, of the project's, with the layered Enabled switches of the
  Skills page. A row opens the server's page, where it is reviewed, edited and
  removed. Adding goes through the daemon; this page never writes the file.
-->
<script lang="ts">
import { untrack } from "svelte";
import Plug from "@lucide/svelte/icons/plug";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { PageEmptyState } from "@nervekit/ui-kit/components/composites/page";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { mcpTarget } from "$lib/application/mcp/mcp-api";
import { configurationAttention } from "$lib/application/configuration-attention/configuration-attention-state.svelte";
import { mcpItemId } from "$lib/application/mcp/mcp-item";
import { McpServersState } from "$lib/application/mcp/mcp-servers-state.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { OriginGroup, SETTINGS_SEARCH_MIN } from "$lib/presentation/settings";
import ProjectCapabilityTrustNotice from "../capabilities/ProjectCapabilityTrustNotice.svelte";
import McpServerDialog from "./McpServerDialog.svelte";
import McpServerItem from "./McpServerItem.svelte";
import { McpEnablementState } from "./mcp-enablement-state.svelte";

let {
  projectId,
  projectName,
  onReviewTrust,
  addOpen = $bindable(false),
  onOpenItem,
}: {
  /** The open project; without one the page has a single (User) column. */
  projectId?: string;
  projectName?: string;
  /** Opens the project's Trust page. */
  onReviewTrust?: () => void;
  /** The Add server dialog, opened from the page header. */
  addOpen?: boolean;
  /** Opens a server's page (`mcpItemId`). */
  onOpenItem?: (id: string) => void;
} = $props();

const list = new McpServersState();
const enablement = new McpEnablementState(() => ({ projectId }));
const layered = $derived(!!projectId && !!projectName);

$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void list.load(
    projectId ? mcpTarget("project", projectId) : mcpTarget("user", undefined),
  );
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void projectId;
  untrack(() => enablement.load());
});
$effect(() => list.observe());
$effect(() => enablement.observe());

// The files change without an event (an edit, a pull). The attention list reads
// them again when it learns of a change, so follow what it knows about MCP, and
// read again when the window regains focus.
const mcpAttention = $derived(
  configurationAttention.resources
    .filter((resource) => resource.kind === "mcp-servers")
    .map((resource) => `${resource.scope}:${resource.id}:${resource.state}`)
    .join("|"),
);
let lastMcpAttention: string | undefined;
$effect(() => {
  const signature = mcpAttention;
  if (lastMcpAttention !== undefined && signature !== lastMcpAttention)
    untrack(() => void list.reload());
  lastMcpAttention = signature;
});
$effect(() => {
  const onFocus = () => {
    void list.reload();
    configurationAttention.refreshSoon();
  };
  window.addEventListener("focus", onFocus);
  return () => window.removeEventListener("focus", onFocus);
});

const ready = $derived(list.loaded && enablement.ready);
const error = $derived(list.error ?? enablement.error);

let query = $state("");
const rows = $derived(list.rows);
const visible = $derived(
  rows.length >= SETTINGS_SEARCH_MIN && query.trim()
    ? rows.filter((row) =>
        `${row.name} ${row.description ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : rows,
);
const groups = $derived([
  {
    origin: { kind: "project" } as const,
    rows: visible.filter((row) => row.scope === "project"),
  },
  {
    origin: { kind: "user" } as const,
    rows: visible.filter((row) => row.scope === "user"),
  },
]);

const project = $derived(
  layered && projectId && projectName
    ? { id: projectId, name: projectName }
    : undefined,
);
const onRetry = () => Promise.all([list.reload(), enablement.reload()]);
</script>

{#if layered}<ProjectCapabilityTrustNotice
    document={enablement.project.document}
    scope={enablement.project.scope}
    onReload={() => enablement.project.reload()}
    {projectName}
    onReview={onReviewTrust}
  />{/if}
{#if error}
  <Callout layout="block" tone="destructive" text={error}>
    {#snippet actions()}
      <Button size="sm" variant="outline" onclick={onRetry}>Retry</Button>
    {/snippet}
  </Callout>
{/if}
{#if list.file?.problems.length}
  <Callout
    layout="block"
    tone="warning"
    icon={TriangleAlert}
    title={`${list.file.path} has problems`}
    text={`${list.file.problems.join(" ")} Fix the file by hand, or add a server and choose Replace with a valid file.`}
  />
{/if}

{#if !ready && !error}
  <Skeleton class="h-8 w-full" />
{:else if ready}
  {#if rows.length >= SETTINGS_SEARCH_MIN}
    <SearchInput
      bind:value={query}
      placeholder="Search MCP servers"
      ariaLabel="Search MCP servers"
      class="max-w-xs"
    />
  {/if}

  {#each groups as group (group.origin.kind)}
    <OriginGroup
      origin={group.origin}
      count={group.rows.length}
      projectName={layered ? projectName : undefined}
      locked={enablement.locked}
    >
      {#each group.rows as row (`${row.scope}:${row.name}`)}
        {@const state = enablement.layers(row)}
        <McpServerItem
          {row}
          projectName={layered ? projectName : undefined}
          user={state.user}
          project={state.project}
          projectSet={state.value.project !== undefined}
          locked={enablement.locked}
          onChange={(layer, next) =>
            void enablement.change(row, layer, next).then(() => list.reload())}
          onOpen={() => onOpenItem?.(mcpItemId(row.scope, row.name))}
        />
      {/each}
    </OriginGroup>
  {/each}

  {#if rows.length === 0}
    <PageEmptyState
      variant="card"
      icon={Plug}
      title="No MCP servers"
      description="MCP servers give the agent more tools, such as GitHub or a database."
    />
  {/if}
{/if}

<McpServerDialog
  bind:open={addOpen}
  {project}
  onSaved={(name, scope) => onOpenItem?.(mcpItemId(scope, name))}
/>
