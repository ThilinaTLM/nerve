<!--
  Loads the review of one MCP entry and records the decision. Used by the MCP
  servers page and by the project's Trust page.
-->
<script lang="ts">
import type { McpReview, McpServerRow } from "@nervekit/contracts/mcp";
import {
  decideMcpServer,
  mcpTarget,
  reviewMcpServer,
} from "$lib/application/mcp/mcp-api";
import McpReviewDialog from "./McpReviewDialog.svelte";

let {
  open = $bindable(false),
  row,
  projectId,
  onDecided,
}: {
  open?: boolean;
  row?: Pick<McpServerRow, "name" | "scope">;
  projectId?: string;
  onDecided: () => void;
} = $props();

let review = $state<McpReview | null>();
let loading = $state(false);
let busy = $state(false);
let error = $state<string>();

$effect(() => {
  if (!open || !row) return;
  const { name, scope } = row;
  review = undefined;
  error = undefined;
  loading = true;
  let current = true;
  void reviewMcpServer(mcpTarget(scope, projectId), name)
    .then((result) => {
      if (current) review = result;
    })
    .catch((cause) => {
      if (current)
        error = cause instanceof Error ? cause.message : String(cause);
    })
    .finally(() => {
      if (current) loading = false;
    });
  return () => {
    current = false;
  };
});

async function decide(status: "trusted" | "rejected") {
  if (!review || busy) return;
  busy = true;
  error = undefined;
  try {
    await decideMcpServer(review, projectId ?? null, status);
    open = false;
    onDecided();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    // The entry may have changed since it was shown: show it as it is now.
    const shown = review;
    review = await reviewMcpServer(
      mcpTarget(shown.scope, projectId),
      shown.name,
    ).catch(() => shown);
  } finally {
    busy = false;
  }
}
</script>

<McpReviewDialog
  bind:open
  name={row?.name ?? ""}
  {review}
  {loading}
  {busy}
  {error}
  onDecide={(status) => void decide(status)}
/>
