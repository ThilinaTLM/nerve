<script lang="ts">
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Copy from "@lucide/svelte/icons/copy";
import {
  describeLifecycle,
  diagnosticsText,
} from "$lib/application/startup/server-lifecycle";
import { serverLifecycleState } from "$lib/application/startup/server-lifecycle.svelte";
import ServerLifecycleStatus from "./ServerLifecycleStatus.svelte";

let { onRetry }: { onRetry: () => void } = $props();

const lifecycle = $derived(serverLifecycleState.lifecycle);
const failure = $derived(lifecycle?.failure);
const diagnostics = $derived(
  failure ? diagnosticsText(failure, lifecycle) : "",
);
const retrying = $derived(serverLifecycleState.retrying);
let copied = $state(false);

async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(diagnostics);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  } catch {
    // Clipboard can be unavailable on insecure origins; text stays selectable.
  }
}
</script>

{#if serverLifecycleState.phase === "failed"}
  <div
    class="fixed inset-0 z-[1000] grid place-items-center bg-background p-4 text-foreground"
  >
    <div
      class="grid w-full max-w-md gap-4 rounded-lg border bg-card p-6 shadow-md"
    >
      {#if retrying}
        <ServerLifecycleStatus
          view={describeLifecycle(
            lifecycle?.state === "failed" ? undefined : lifecycle,
          )}
        />
      {:else}
        <div class="grid gap-1">
          <h1 class="text-lg font-semibold">Nerve couldn't start</h1>
          <p class="text-sm text-muted-foreground break-words">
            {failure?.message ?? "Nerve reported a startup failure."}
          </p>
        </div>
        {#if failure}
          <Collapsible.Root>
            <Collapsible.Trigger
              class="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronRight
                class="size-3.5 transition-transform group-data-[state=open]:rotate-90"
              />
              Technical details
            </Collapsible.Trigger>
            <Collapsible.Content>
              <pre
                class="mt-2 max-h-48 overflow-auto rounded-md bg-well p-2 font-mono text-xs whitespace-pre-wrap break-all select-text">{diagnostics}</pre>
              <Button
                class="mt-2"
                size="xs"
                variant="outline"
                onclick={copyDiagnostics}
              >
                <Copy />{copied ? "Copied" : "Copy diagnostics"}
              </Button>
            </Collapsible.Content>
          </Collapsible.Root>
        {/if}
        {#if serverLifecycleState.retryError}
          <p class="text-xs text-destructive">
            {serverLifecycleState.retryError}
          </p>
        {/if}
        {#if failure?.retryable}
          <div class="flex justify-end">
            <Button onclick={onRetry}>Try again</Button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}
