<script lang="ts">
import {
  isMaintenanceActive,
  type MaintenanceOperation,
} from "@nervekit/contracts/maintenance";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
let {
  operation,
  onCancel,
}: { operation: MaintenanceOperation; onCancel?: () => void } = $props();
const active = $derived(isMaintenanceActive(operation));
const title = $derived(
  operation.kind === "delete_project" ? "Removing project" : "Cleaning up",
);
const stages: Record<string, string> = {
  stopping_agents: "checking and stopping agents",
  events: "deleting events",
  leaves: "deleting agent context leaves",
  parent_links: "detaching parent links",
  record_projections: "deleting history projections",
  tool_projections: "deleting tool projections",
  records: "deleting history records",
  snapshots: "deleting snapshots",
  journal_heads: "deleting journal metadata",
  journal_commits: "deleting journal commits",
  metadata: "deleting conversation metadata",
  complete: "finishing history deletion",
  streams: "removing streams",
  payloads: "removing payloads",
};
const progress = $derived.by(() => {
  if (
    !active ||
    ["queued", "preparing", "discovering", "finalizing"].includes(
      operation.phase,
    )
  )
    return undefined;
  const total = operation.totalItems ?? operation.totalTargets;
  const completed =
    operation.totalItems === undefined
      ? operation.completedTargets
      : operation.completedItems;
  return total > 0 && completed < total
    ? Math.min(99, Math.round((completed / total) * 100))
    : undefined;
});
</script>

<div class="grid min-w-0 gap-3" aria-live="polite" aria-atomic="true">
  <div class="flex items-start gap-2">
    {#if active}<Spinner class="mt-0.5 size-4 shrink-0" />
    {:else if operation.status === "succeeded" && !operation.warnings.length}<CheckCircle2
        class="mt-0.5 size-4 shrink-0 text-success"
      />
    {:else}<CircleAlert class="mt-0.5 size-4 shrink-0 text-warning" />{/if}
    <div class="min-w-0">
      <p class="text-sm font-medium">
        {active
          ? title
          : operation.message}{#if active && operation.totalItems !== undefined}
          {operation.completedItems}/{operation.totalItems} conversations{/if}
      </p>
      {#if operation.project}<p
          class="truncate text-xs text-muted-foreground"
          title={operation.project.dir}
        >
          {operation.project.name}
        </p>{/if}
    </div>
  </div>
  {#if active}<p class="text-xs text-muted-foreground">
      {operation.message}
    </p>{/if}
  {#if progress !== undefined}<Progress
      value={progress}
      aria-label="Completed cleanup items"
    />{/if}
  {#if operation.currentItem && active}
    <div class="grid gap-1 text-xs">
      <p
        class="truncate font-medium"
        title={operation.currentItem.conversationId}
      >
        {operation.currentItem.title ?? operation.currentItem.conversationId}
      </p>
      <p class="text-muted-foreground">
        {stages[operation.currentItem.stage] ?? operation.currentItem.stage}: {operation.currentItem.removedRows.toLocaleString()}
        rows removed
      </p>
      {#if operation.currentItem.detachedLinks > 0}<p
          class="text-muted-foreground"
        >
          {operation.currentItem.detachedLinks.toLocaleString()} links detached (not
          deleted rows)
        </p>{/if}
    </div>
  {/if}
  {#if operation.totalTargets > 0}<p class="text-xs text-muted-foreground">
      {operation.completedTargets}/{operation.totalTargets} storage targets completed
    </p>{/if}
  <p class="text-xs text-muted-foreground">
    {operation.removedConversationCount} conversations removed · {operation.removedTaskCount}
    task records removed
  </p>
  {#if operation.error}<p class="break-words text-xs text-destructive">
      {operation.error}
    </p>{/if}
  {#each operation.warnings as warning, index (index)}<p
      class="break-words text-xs text-warning"
    >
      {warning}
    </p>{/each}
  {#if operation.result?.kind === "storage_cleanup"}
    <ul class="grid gap-1 text-xs text-muted-foreground">
      {#each operation.result.targets as target (target.target)}<li>
          {target.target}: {target.outcome} · {target.removedItems} removed{#if target.note}
            · {target.note}{/if}
        </li>{/each}
    </ul>
  {/if}
  {#if active && operation.cancellable && onCancel}
    <Button
      size="xs"
      variant="outline"
      disabled={operation.cancellationRequested}
      onclick={onCancel}
      >{operation.cancellationRequested
        ? "Stop requested"
        : operation.currentItem
          ? "Stop after this conversation"
          : "Stop after this item"}</Button
    >
    <p class="text-xs text-muted-foreground">
      Already removed data will not be restored.
    </p>
  {/if}
</div>
