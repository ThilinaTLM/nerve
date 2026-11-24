<!--
  Settings › MCP servers › name: one server. An entry waiting for review shows
  what it runs and what it sends, with Approve and Reject; an approved one
  also shows what the agent sees (tested on open while it is on).
-->
<script lang="ts">
import { untrack } from "svelte";
import Ban from "@lucide/svelte/icons/ban";
import Pencil from "@lucide/svelte/icons/pencil";
import Trash2 from "@lucide/svelte/icons/trash-2";
import Unplug from "@lucide/svelte/icons/unplug";
import type { McpReview } from "@nervekit/contracts/mcp";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import {
  FieldRow,
  PageEmptyState,
  PageHeader,
} from "@nervekit/ui-kit/components/composites/page";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
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
import { SettingsSection } from "$lib/presentation/settings";
import McpEntrySections from "./McpEntrySections.svelte";
import McpOffersSection from "./McpOffersSection.svelte";
import McpServerDialog from "./McpServerDialog.svelte";

let {
  itemId,
  projectId,
  projectName,
  onBack,
  onOpenItem,
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
} = $props();

const wanted = $derived(parseMcpItemId(itemId));
const list = new McpServersState();
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void list.load(
    projectId ? mcpTarget("project", projectId) : mcpTarget("user", undefined),
  );
});
$effect(() => list.observe());

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

// The review of the entry as it is now: reloaded when the entry or its decision changes.
let review = $state<McpReview | null>();
let reviewError = $state<string>();
const reviewKey = $derived(
  row
    ? `${row.scope}:${row.name}:${row.review}:${JSON.stringify(row.entry)}`
    : "",
);
$effect(() => {
  const key = reviewKey;
  if (!key || !row) return;
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

// What the agent sees: tested once on open (and after approval) while the server is on.
let testResult = $state<McpTestResult>();
let testError = $state<string>();
let testBusy = $state(false);
let testedKey = "";
$effect(() => {
  if (!row || pending || !row.enabled) return;
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

/** Approves or rejects exactly the entry shown; a changed entry is shown again. */
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

let editOpen = $state(false);
let removeOpen = $state(false);

const project = $derived(
  projectId && projectName ? { id: projectId, name: projectName } : undefined,
);
const description = $derived(
  row?.description ??
    (row?.scope === "project"
      ? "Stored in this project and shared through the repository."
      : row
        ? "Yours, available in every project."
        : undefined),
);
/** Why it is not in use here, when the sections below do not already say. */
const notice = $derived.by(() => {
  if (!row) return undefined;
  if (row.review === "rejected")
    return "You rejected this entry. It stays off until you approve it.";
  if (row.shadowed)
    return "The project's server with the same name replaces this one here.";
  if (!pending && !row.enabled)
    return "Off here. Turn it on in the MCP servers list.";
  return undefined;
});

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
</script>

<PageHeader
  title={wanted?.name ?? itemId}
  {description}
  parent={{ label: "MCP servers", onBack }}
>
  {#snippet actions()}
    {#if row && pending}
      <Button
        size="sm"
        disabled={busy || !review}
        onclick={() => decide("trusted")}>Approve</Button
      >
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
  <div class="flex flex-wrap items-center gap-2">
    {#if !pending}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onclick={() => (editOpen = true)}
        ><Pencil class="size-3.5" />Edit</Button
      >
    {/if}
    {#if row.review === "needs_approval"}
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !review}
        onclick={() => decide("rejected")}
        ><Ban class="size-3.5" />Reject</Button
      >
    {/if}
    {#if row.state === "connected"}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onclick={() =>
          target && void act(() => disconnectMcpServer(target, row.name))}
        ><Unplug class="size-3.5" />Disconnect</Button
      >
    {/if}
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onclick={() => (removeOpen = true)}
      ><Trash2 class="size-3.5" />Remove</Button
    >
  </div>

  {#if actionError}<Callout tone="destructive" text={actionError} />{/if}
  {#if notice}<Callout tone="neutral" text={notice} />{/if}
  {#if reviewError}<Callout tone="destructive" text={reviewError} />{/if}

  {#if !pending && !row.shadowed}
    <McpOffersSection
      result={testResult}
      busy={testBusy}
      error={testError}
      onTest={() => void runTest()}
    />
  {/if}

  {#if review}
    <McpEntrySections {review} />
  {:else if review === undefined && !reviewError}
    <Skeleton class="h-24 w-full" />
  {/if}

  {#if row.secrets.length}
    <SettingsSection
      title="Secrets"
      description="Stored on this computer, never in the file."
      divided
    >
      {#each row.secrets as secret (secret.name)}
        <FieldRow label={secret.name} mono>
          {#snippet control()}
            <Badge variant={secret.set ? "success" : "warning"}
              >{secret.set ? "Set" : "Not set"}</Badge
            >
          {/snippet}
        </FieldRow>
      {/each}
    </SettingsSection>
  {/if}
{/if}

<McpServerDialog
  bind:open={editOpen}
  {row}
  {project}
  onSaved={(name) => {
    // The saved entry is tested again once the list has it.
    testedKey = "";
    void list.reload();
    if (row && name !== row.name) onOpenItem?.(mcpItemId(row.scope, name));
  }}
/>
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
