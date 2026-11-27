<!--
  The storage page's one cleanup message: a running cleanup with its progress
  and Stop, then its outcome until dismissed.
-->
<script lang="ts">
import {
  isMaintenanceActive,
  type MaintenanceOperation,
} from "@nervekit/contracts/maintenance";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CircleX from "@lucide/svelte/icons/circle-x";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import {
  cleanupTargetLabel,
  maintenanceActivity,
  maintenanceCount,
  maintenanceProgress,
  maintenanceTitle,
} from "$lib/presentation/maintenance/maintenance-progress";
import { formatBytes } from "./storage-format";

let {
  operation,
  onCancel,
  onDismiss,
}: {
  operation: MaintenanceOperation;
  onCancel: () => void;
  onDismiss: () => void;
} = $props();

const active = $derived(isMaintenanceActive(operation));
const progress = $derived(maintenanceProgress(operation));
const targets = $derived(
  operation.result?.kind === "storage_cleanup" ? operation.result.targets : [],
);
const failedTargets = $derived(
  targets.filter((target) => target.outcome === "failed"),
);
const tone = $derived<StatusTone>(
  active
    ? "info"
    : operation.status === "failed"
      ? "destructive"
      : operation.status === "cancelled" ||
          operation.warnings.length > 0 ||
          failedTargets.length > 0
        ? "warning"
        : "success",
);
const freed = $derived(`freed ${formatBytes(operation.freedBytes)}`);
const title = $derived.by(() => {
  if (active) {
    const count = maintenanceCount(operation);
    return count
      ? `${maintenanceTitle(operation)} · ${count}`
      : maintenanceTitle(operation);
  }
  if (operation.status === "failed") return `Cleanup failed · ${freed}`;
  if (operation.status === "cancelled") return `Cleanup stopped · ${freed}`;
  return `Cleanup finished · ${freed}`;
});
const text = $derived.by(() => {
  if (active) return maintenanceActivity(operation);
  const cleaned = targets
    .filter((target) => target.outcome === "succeeded")
    .map((target) => cleanupTargetLabel(target.target));
  return cleaned.length ? `Cleaned ${cleaned.join(", ")}.` : undefined;
});
const problems = $derived([
  ...(operation.error ? [operation.error] : []),
  ...failedTargets.map(
    (target) =>
      `${cleanupTargetLabel(target.target)}: ${target.error ?? "failed"}`,
  ),
  ...operation.warnings,
]);
const icon = $derived(
  active
    ? Spinner
    : tone === "success"
      ? CheckCircle2
      : tone === "destructive"
        ? CircleX
        : CircleAlert,
);
</script>

<Callout {tone} {icon} {title} {text}>
  {#if active && progress !== undefined}
    <Progress class="mt-1.5" value={progress} aria-label="Cleanup progress" />
  {/if}
  {#each problems as problem, index (index)}
    <p class="break-words text-muted-foreground">{problem}</p>
  {/each}
  {#snippet actions()}
    {#if active}
      {#if operation.cancellable}
        <Button
          size="sm"
          variant="outline"
          title="Stops after the current item. Removed data stays removed."
          disabled={operation.cancellationRequested}
          onclick={onCancel}
          >{operation.cancellationRequested ? "Stopping" : "Stop"}</Button
        >
      {/if}
    {:else}
      <Button size="sm" variant="ghost" onclick={onDismiss}>Dismiss</Button>
    {/if}
  {/snippet}
</Callout>
