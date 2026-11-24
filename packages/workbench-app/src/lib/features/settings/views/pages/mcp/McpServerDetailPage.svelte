<!--
  Settings › MCP servers › name: one server, laid out like an extension's page.
  The header has its Enabled switch (the User and project table with a project
  open). An entry waiting for review shows what it runs and sends, with Approve
  and Reject; an approved one shows its tools (tested on open while it is on)
  and its entry, edited in place. Source has the file, the approval and Remove.
-->
<script lang="ts">
import { untrack } from "svelte";
import Plug from "@lucide/svelte/icons/plug";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { McpReview, McpServerRow } from "@nervekit/contracts/mcp";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import {
  PageEmptyState,
  PageHeader,
} from "@nervekit/ui-kit/components/composites/page";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import {
  decideMcpServer,
  disconnectMcpServer,
  mcpTarget,
  type McpTestResult,
  removeMcpServer,
  reviewMcpServer,
  testMcpServer,
} from "$lib/application/mcp/mcp-api";
import { mcpItemId, parseMcpItemId } from "$lib/application/mcp/mcp-item";
import { McpServersState } from "$lib/application/mcp/mcp-servers-state.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { LayerEnabledTable } from "$lib/presentation/settings";
import McpEntrySections from "./McpEntrySections.svelte";
import McpServerEditor from "./McpServerEditor.svelte";
import McpSourceSection from "./McpSourceSection.svelte";
import McpToolsSection from "./McpToolsSection.svelte";
import { McpEnablementState } from "./mcp-enablement-state.svelte";

let {
  itemId,
  projectId,
  projectName,
  onBack,
  onOpenItem,
  onOpenFile,
}: {
  /** `scope:name` (`mcpItemId`). */
  itemId: string;
  /** The open project; its servers and the user's are listed for it. */
  projectId?: string;
  projectName?: string;
  /** Returns to the MCP servers list. */
  onBack: () => void;
  /** Opens another server (after a rename). */
  onOpenItem?: (id: string) => void;
  /** Opens a file of the open project by absolute path. */
  onOpenFile?: (path: string) => void;
} = $props();

const wanted = $derived(parseMcpItemId(itemId));
const list = new McpServersState();
const enablement = new McpEnablementState(() => ({ projectId }));
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

const row = $derived(
  wanted
    ? list.rows.find(
        (candidate) =>
          candidate.scope === wanted.scope && candidate.name === wanted.name,
      )
    : undefined,
);
const target = $derived(row ? mcpTarget(row.scope, projectId) : undefined);
const pending = $derived(!!row && row.review !== "approved");
const layers = $derived(row ? enablement.layers(row) : undefined);
const layered = $derived(enablement.layered && !!projectName);

// The review of the entry as it is now: what Approve, Reject and Revoke decide on.
let review = $state<McpReview | null>();
let reviewError = $state<string>();
const reviewKey = $derived(
  row
    ? `${row.scope}:${row.name}:${row.review}:${JSON.stringify(row.entry)}`
    : "",
);
$effect(() => {
  if (!reviewKey || !row) return;
  const { scope, name } = row;
  let current = true;
  untrack(() => {
    reviewError = undefined;
    void reviewMcpServer(mcpTarget(scope, projectId), name)
      .then((result) => {
        if (current) review = result;
      })
      .catch((cause) => {
        if (current) reviewError = errorText(cause);
      });
  });
  return () => {
    current = false;
  };
});

// The tools: tested once on open, after approval and after each save, while the server is on.
let testResult = $state<McpTestResult>();
let testError = $state<string>();
let testBusy = $state(false);
let testedKey = $state("");
$effect(() => {
  if (!row || pending || !row.enabled || row.shadowed) return;
  const key = `${row.scope}:${row.name}`;
  if (key === testedKey) return;
  testedKey = key;
  untrack(() => void runTest());
});

async function runTest() {
  if (!row || !target) return;
  testBusy = true;
  testResult = testError = undefined;
  try {
    testResult = await testMcpServer(target, row.name);
  } catch (cause) {
    testError = errorText(cause);
  } finally {
    testBusy = false;
    void list.reload();
  }
}

let busy = $state(false);
let actionError = $state<string>();
async function act(action: () => Promise<unknown>) {
  if (busy) return;
  busy = true;
  actionError = undefined;
  try {
    await action();
    await list.reload();
  } catch (cause) {
    actionError = errorText(cause);
  } finally {
    busy = false;
  }
}

/** Decides on exactly the entry shown; a changed entry is shown again. */
function decide(status: "trusted" | "rejected") {
  const shown = review;
  if (!shown) return;
  void act(async () => {
    try {
      await decideMcpServer(shown, projectId ?? null, status);
    } catch (cause) {
      review = await reviewMcpServer(
        mcpTarget(shown.scope, projectId),
        shown.name,
      ).catch(() => shown);
      throw cause;
    }
  });
}

function saved(next: McpServerRow) {
  void list.reload();
  if (row && next.name !== row.name)
    onOpenItem?.(mcpItemId(next.scope, next.name));
  else testedKey = "";
}

let removeOpen = $state(false);

/** The file of the target's own scope; a user entry listed for a project lives elsewhere. */
const path = $derived(
  row && (row.scope === "project") === !!projectId
    ? list.file?.path
    : undefined,
);
const openFile = $derived(
  onOpenFile && row?.scope === "project" && path
    ? () => onOpenFile(path)
    : undefined,
);
const description = $derived(
  row?.description ??
    (row?.scope === "project"
      ? "Stored in this project and shared through the repository."
      : row
        ? "Yours, available in every project."
        : undefined),
);

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
</script>

<PageHeader
  title={wanted?.name ?? itemId}
  {description}
  parent={{ label: "MCP servers", onBack }}
  class="mb-1"
>
  {#snippet leading()}
    <Plug
      class={row?.enabled === false
        ? "size-4.5 text-muted-foreground"
        : "size-4.5 text-foreground"}
      aria-hidden="true"
    />
  {/snippet}
  {#snippet actions()}
    {#if row && layers && !layered && !pending}
      <Switch
        checked={layers.user}
        disabled={busy}
        aria-label={`Enable ${row.name}`}
        onCheckedChange={(next) =>
          void act(() => enablement.change(row, "user", next))}
      />
    {/if}
  {/snippet}
  {#snippet below()}
    {#if row && layers && layered && !pending}
      <div class="pt-2">
        <LayerEnabledTable
          name={row.name}
          description={row.scope === "project"
            ? "Off keeps the agent from using it here."
            : "On for every project, or only here."}
          {projectName}
          user={layers.user}
          project={layers.project}
          projectSet={layers.value.project !== undefined}
          projectOnly={row.scope === "project"}
          locked={enablement.locked}
          inapplicable={row.shadowed}
          onChange={(layer, next) =>
            void act(() => enablement.change(row, layer, next))}
        />
      </div>
    {/if}
  {/snippet}
</PageHeader>

{#if list.error}
  <Callout layout="block" tone="destructive" text={list.error}>
    {#snippet actions()}
      <Button size="sm" variant="outline" onclick={() => void list.reload()}
        >Retry</Button
      >
    {/snippet}
  </Callout>
{:else if !list.loaded}
  <Skeleton class="h-24 w-full" />
{:else if !row}
  <PageEmptyState
    variant="card"
    title="Server not found"
    description={`There is no MCP server "${wanted?.name ?? itemId}" here any more. It may have been renamed or removed.`}
  >
    {#snippet actions()}
      <Button size="sm" variant="outline" onclick={onBack}
        >Back to MCP servers</Button
      >
    {/snippet}
  </PageEmptyState>
{:else}
  <div class="grid gap-5">
    {#if actionError}<Callout tone="destructive" text={actionError} />{/if}
    {#if reviewError}<Callout tone="destructive" text={reviewError} />{/if}

    {#if pending}
      <Callout
        layout="block"
        tone="warning"
        icon={TriangleAlert}
        title={row.review === "rejected"
          ? "You rejected this entry"
          : "Waiting for your review"}
        text={row.review === "rejected"
          ? "It stays off until you approve it."
          : "It does not run until you approve it. Approval covers exactly this entry; any change asks again."}
      >
        {#snippet actions()}
          {#if row.review === "needs_approval"}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !review}
              onclick={() => decide("rejected")}>Reject</Button
            >
          {/if}
          <Button
            size="sm"
            disabled={busy || !review}
            onclick={() => decide("trusted")}>Approve</Button
          >
        {/snippet}
      </Callout>
      {#if review}
        <McpEntrySections {review} />
      {:else if !reviewError}
        <Skeleton class="h-24 w-full" />
      {/if}
    {:else}
      {#if row.shadowed}
        <Callout
          tone="neutral"
          text="The project's server with the same name replaces this one here."
        />
      {:else if row.enabled}
        <McpToolsSection
          result={testResult}
          busy={testBusy}
          error={testError}
          onTest={() => void runTest()}
          onDisconnect={row.state === "connected" && target
            ? () => void act(() => disconnectMcpServer(target, row.name))
            : undefined}
        />
      {/if}
      {#if target}
        {#key `${row.scope}:${row.name}`}
          <McpServerEditor {row} {target} onSaved={saved} />
        {/key}
      {/if}
    {/if}

    <McpSourceSection
      {row}
      {path}
      {busy}
      onOpenFile={openFile}
      onRevoke={review ? () => decide("rejected") : undefined}
      onRemove={() => (removeOpen = true)}
    />
  </div>
{/if}

<ConfirmDialog
  bind:open={removeOpen}
  title={`Remove ${row?.name ?? "server"}?`}
  description="The entry, its approval and its stored secrets are deleted. This cannot be undone."
  confirmLabel="Remove"
  destructive
  onConfirm={() => {
    const removing = row;
    if (!removing || !target) return;
    void act(async () => {
      await removeMcpServer(target, removing.name);
      onBack();
    });
  }}
/>
