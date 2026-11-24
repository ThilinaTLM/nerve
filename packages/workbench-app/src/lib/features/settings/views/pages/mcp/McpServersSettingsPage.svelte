<!--
  Settings › MCP servers. Lists the servers of the user's mcp.json and, with a
  project open, of the project's, with the layered Enabled switches of the
  Skills page. A row opens the server's page (review, what the agent sees).
  Adding, editing and removing go through the daemon; this page never writes
  the file.
-->
<script lang="ts">
import { untrack } from "svelte";
import Plug from "@lucide/svelte/icons/plug";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { McpServerRow } from "@nervekit/contracts/mcp";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { PageEmptyState } from "@nervekit/ui-kit/components/composites/page";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import {
  disconnectMcpServer,
  mcpTarget,
  removeMcpServer,
} from "$lib/application/mcp/mcp-api";
import { configurationAttention } from "$lib/application/configuration-attention/configuration-attention-state.svelte";
import { mcpItemId } from "$lib/application/mcp/mcp-item";
import { McpServersState } from "$lib/application/mcp/mcp-servers-state.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import {
  OriginGroup,
  SETTINGS_SEARCH_MIN,
  type SettingsLayer,
} from "$lib/presentation/settings";
import { applyLayerChange } from "../../shared/layer-change";
import ProjectCapabilityTrustNotice from "../capabilities/ProjectCapabilityTrustNotice.svelte";
import McpServerDialog from "./McpServerDialog.svelte";
import McpServerItem from "./McpServerItem.svelte";
import { mcpEnablementLayers, mcpEnabledPointer } from "./mcp-enablement";

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
const userEditor = new ScopedAgentState();
const projectEditor = new ScopedAgentState();
const layered = $derived(!!projectId && !!projectName);

$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void list.load(
    projectId ? mcpTarget("project", projectId) : mcpTarget("user", undefined),
  );
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void userEditor.load({ scope: "user" });
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive || !projectId) return;
  void projectEditor.load({ scope: "project", projectId });
});
$effect(() => list.observe());
$effect(() => userEditor.observe());
$effect(() => projectEditor.observe());

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

const ready = $derived(
  list.loaded &&
    !!userEditor.resolution &&
    (!layered || !!projectEditor.resolution),
);
const error = $derived(
  list.error ?? userEditor.error ?? (layered ? projectEditor.error : undefined),
);
/** The project's settings file is not trusted: its column is locked. */
const locked = $derived(
  layered &&
    projectEditor.document?.status === "available" &&
    projectEditor.document.trusted === false,
);

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

function layers(row: McpServerRow) {
  return mcpEnablementLayers({
    entry: row.entry,
    name: row.name,
    user: userEditor.overrides,
    project: layered ? projectEditor.overrides : undefined,
    projectOwned: row.scope === "project",
  });
}

async function write(
  editor: ScopedAgentState,
  name: string,
  choice: boolean | undefined,
) {
  if (choice === undefined) await editor.save({}, [mcpEnabledPointer(name)]);
  else await editor.save({ mcpServers: { servers: { [name]: choice } } });
}

async function change(row: McpServerRow, layer: SettingsLayer, next: boolean) {
  await applyLayerChange({
    value: layers(row).value,
    layer,
    next,
    writeUser: (choice) => write(userEditor, row.name, choice),
    writeProject: (choice) => write(projectEditor, row.name, choice),
  });
  await list.reload();
}

const project = $derived(
  layered && projectId && projectName
    ? { id: projectId, name: projectName }
    : undefined,
);
const targetOf = (row: McpServerRow) => mcpTarget(row.scope, projectId);

let removeRow = $state<McpServerRow>();
let removeOpen = $state(false);
let actionError = $state<string>();

async function run(action: () => Promise<unknown>) {
  actionError = undefined;
  try {
    await action();
    await list.reload();
  } catch (cause) {
    actionError = cause instanceof Error ? cause.message : String(cause);
  }
}

let editRow = $state<McpServerRow>();
let editOpen = $state(false);
const open = (row: McpServerRow) =>
  onOpenItem?.(mcpItemId(row.scope, row.name));
const onRetry = () =>
  Promise.all([
    list.reload(),
    userEditor.reload(),
    layered ? projectEditor.reload() : undefined,
  ]);
</script>

{#if layered}<ProjectCapabilityTrustNotice
    document={projectEditor.document}
    scope={projectEditor.scope}
    onReload={() => projectEditor.reload()}
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
{#if actionError}
  <Callout tone="destructive" text={actionError} />
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
      {locked}
    >
      {#each group.rows as row (`${row.scope}:${row.name}`)}
        {@const state = layers(row)}
        <McpServerItem
          {row}
          projectName={layered ? projectName : undefined}
          user={state.user}
          project={state.project}
          projectSet={state.value.project !== undefined}
          {locked}
          onChange={(layer, next) => void change(row, layer, next)}
          onOpen={() => open(row)}
          onEdit={() => {
            editRow = row;
            editOpen = true;
          }}
          onDisconnect={() =>
            void run(() => disconnectMcpServer(targetOf(row), row.name))}
          onRemove={() => {
            removeRow = row;
            removeOpen = true;
          }}
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
  onSaved={() => void list.reload()}
/>
<McpServerDialog
  bind:open={editOpen}
  row={editRow}
  {project}
  onSaved={() => void list.reload()}
/>
<ConfirmDialog
  bind:open={removeOpen}
  title={`Remove ${removeRow?.name ?? "server"}?`}
  description="The entry, its approval and its stored secrets are deleted. This cannot be undone."
  confirmLabel="Remove"
  destructive
  onConfirm={() => {
    const row = removeRow;
    if (row) void run(() => removeMcpServer(targetOf(row), row.name));
  }}
/>
