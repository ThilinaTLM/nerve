<script lang="ts">
import type { ConfigurationBlockedRequest } from "@nervekit/contracts/core";
import { Button } from "@nervekit/ui-kit/components/ui/button";
let {
  request,
  onResolve,
}: {
  request: ConfigurationBlockedRequest;
  onResolve: (decision: "retry" | "cancel") => Promise<void>;
} = $props();
let saving = $state(false);
let error = $state<string>();
async function resolve(decision: "retry" | "cancel") {
  saving = true;
  error = undefined;
  try {
    await onResolve(decision);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving = false;
  }
}
</script>

<div class="flex flex-col gap-2 text-xs" role="status">
  <p class="text-warning">Configuration blocked</p>
  {#each request.diagnostics as diagnostic, index (index)}
    <p>
      {diagnostic.code}:
      <span class="font-mono"
        >{diagnostic.path || diagnostic.document}{diagnostic.pointer}</span
      >
    </p>
  {/each}
  {#if error}<p class="text-destructive">{error}</p>{/if}
  <div class="flex gap-2">
    <Button size="sm" disabled={saving} onclick={() => resolve("retry")}
      >Retry</Button
    >
    <Button
      size="sm"
      variant="outline"
      disabled={saving}
      onclick={() => resolve("cancel")}>Cancel</Button
    >
  </div>
</div>
