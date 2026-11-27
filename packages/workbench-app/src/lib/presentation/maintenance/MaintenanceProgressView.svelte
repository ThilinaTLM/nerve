<script lang="ts">
import {
  isMaintenanceActive,
  type MaintenanceOperation,
} from "@nervekit/contracts/maintenance";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
import {
  cleanupTargetLabel,
  maintenanceActivity,
  maintenanceCount,
  maintenanceProgress,
  maintenanceTitle,
} from "./maintenance-progress";
let {
  operation,
  onCancel,
}: { operation: MaintenanceOperation; onCancel?: () => void } = $props();
const active = $derived(isMaintenanceActive(operation));
const progress = $derived(maintenanceProgress(operation));
const count = $derived(active ? maintenanceCount(operation) : "");
const removed = $derived(
  [
    operation.removedConversationCount > 0 &&
      `${operation.removedConversationCount.toLocaleString()} conversations removed`,
    operation.removedLaunchCount > 0 &&
      `${operation.removedLaunchCount.toLocaleString()} launch records removed`,
  ]
    .filter(Boolean)
    .join(" · "),
);
</script>

<div class="grid min-w-0 gap-2" aria-live="polite" aria-atomic="true">
  <div class="flex items-start gap-2">
    {#if active}<Spinner class="mt-0.5 size-4 shrink-0" />
    {:else if operation.status === "succeeded" && !operation.warnings.length}<CheckCircle2
        class="mt-0.5 size-4 shrink-0 text-success"
      />
    {:else}<CircleAlert class="mt-0.5 size-4 shrink-0 text-warning" />{/if}
    <div class="grid min-w-0 flex-1 gap-0.5">
      <p class="text-ui">
        {active ? maintenanceTitle(operation) : operation.message}
      </p>
      {#if operation.project}<p
          class="truncate text-caption text-muted-foreground"
          title={operation.project.directory}
        >
          {operation.project.name}
        </p>{/if}
    </div>
    {#if count}<span class="flex-none text-caption text-muted-foreground"
        >{count}</span
      >{/if}
  </div>
  {#if active}
    {#if progress !== undefined}<Progress
        value={progress}
        aria-label="Cleanup progress"
      />{/if}
    <p
      class="truncate text-caption text-muted-foreground"
      title={maintenanceActivity(operation)}
    >
      {maintenanceActivity(operation)}
    </p>
  {/if}
  {#if operation.result?.kind === "storage_cleanup"}
    <ul class="grid gap-0.5 text-caption text-muted-foreground">
      {#each operation.result.targets as target (target.target)}<li>
          {cleanupTargetLabel(target.target)} · {target.outcome === "succeeded"
            ? `${target.removedItems.toLocaleString()} removed`
            : target.outcome}{#if target.note}
            · {target.note}{/if}
        </li>{/each}
    </ul>
  {/if}
  {#if removed}<p class="text-caption text-muted-foreground">{removed}</p>{/if}
  {#if operation.error}<Callout
      tone="destructive"
      text={operation.error}
    />{/if}
  {#if operation.warnings.length}
    <Callout tone="warning">
      {#each operation.warnings as warning, index (index)}<p
          class="break-words"
        >
          {warning}
        </p>{/each}
    </Callout>
  {/if}
  {#if active && operation.cancellable && onCancel}
    <div class="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={operation.cancellationRequested}
        onclick={onCancel}
        >{operation.cancellationRequested
          ? "Stopping"
          : operation.currentItem
            ? "Stop after this conversation"
            : "Stop after this item"}</Button
      >
      <span class="text-caption text-muted-foreground"
        >Removed data stays removed.</span
      >
    </div>
  {/if}
</div>
