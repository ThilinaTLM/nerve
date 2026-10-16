<script lang="ts">
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Copy from "@lucide/svelte/icons/copy";
import {
  describeLifecycle,
  diagnosticsText,
  discardPlan,
  failureKind,
} from "$lib/application/startup/server-lifecycle";
import { serverLifecycleState } from "$lib/application/startup/server-lifecycle.svelte";
import {
  desktopRuntime,
  quitDesktopApp,
} from "$lib/platform/desktop/desktop-bridge.svelte";
import ServerLifecycleStatus from "./ServerLifecycleStatus.svelte";

let {
  onRetry,
  onDiscardAndRetry,
  onRollback,
}: {
  onRetry: () => void;
  onDiscardAndRetry: (conversationIds: string[]) => void;
  onRollback: () => void;
} = $props();

const lifecycle = $derived(serverLifecycleState.lifecycle);
const failure = $derived(lifecycle?.failure);
const kind = $derived(failureKind(failure));
const discardable = $derived(failure?.discardable ?? []);
const plan = $derived(discardPlan(discardable));
const diagnostics = $derived(
  failure ? diagnosticsText(failure, lifecycle) : "",
);
const retrying = $derived(serverLifecycleState.retrying);
const isDesktop = $derived(desktopRuntime.isDesktop);
let copied = $state(false);
let confirming = $state<"discard" | "rollback" | undefined>();

// Confirmations portal into the full-screen layer: portaled to <body> they
// would stack under it while their modal state blocks all pointer input.
let layer = $state<HTMLElement>();
// The frameless desktop window has no titlebar here: the backdrop moves the
// window, while the card and confirmations stay interactive (escape-hatch
// reason 7).
const dragClass = "[-webkit-app-region:drag]";
const noDragClass = "[-webkit-app-region:no-drag]";

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

{#snippet technicalDetails()}
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
          size="sm"
          variant="outline"
          onclick={copyDiagnostics}
        >
          <Copy />{copied ? "Copied" : "Copy diagnostics"}
        </Button>
      </Collapsible.Content>
    </Collapsible.Root>
  {/if}
{/snippet}

{#snippet quitButton()}
  {#if isDesktop}
    <!-- An escape, not a recovery choice: kept quiet and apart. -->
    <Button
      class="mr-auto"
      variant="ghost"
      onclick={() => void quitDesktopApp()}
    >
      Quit Nerve
    </Button>
  {/if}
{/snippet}

<!-- While the boot splash shows a retry's progress, this view steps aside. -->
{#if serverLifecycleState.phase === "failed" && !serverLifecycleState.splashRetry}
  <div
    bind:this={layer}
    class={[
      "fixed inset-0 z-[1000] grid place-items-center bg-background p-4 text-foreground",
      isDesktop && dragClass,
    ]}
  >
    <div
      class="grid w-full max-w-xl gap-4 rounded-lg border bg-card p-6 shadow-md [-webkit-app-region:no-drag]"
    >
      {#if retrying}
        <ServerLifecycleStatus
          view={describeLifecycle(
            lifecycle?.state === "failed" ? undefined : lifecycle,
          )}
        />
      {:else if kind === "rolled-back"}
        <div class="grid gap-1">
          <h1 class="text-lg font-semibold">Your previous data was restored</h1>
          <p class="text-sm text-muted-foreground">
            Nerve undid the upgrade and your data is back to how it was. Quit
            Nerve and reinstall the previous version to keep using it.
          </p>
        </div>
        {#if !isDesktop}
          <p class="text-sm text-muted-foreground">
            Stop the Nerve server, then start the previous version.
          </p>
        {/if}
        {@render technicalDetails()}
        {#if isDesktop}
          <div class="flex justify-end">
            <Button onclick={() => void quitDesktopApp()}>Quit Nerve</Button>
          </div>
        {/if}
      {:else}
        <div class="grid gap-1">
          <h1 class="text-lg font-semibold">
            {kind === "discardable" ? plan.heading : "Nerve couldn't start"}
          </h1>
          <p class="text-sm text-muted-foreground break-words">
            {#if kind === "discardable"}
              Nerve can continue without {discardable.length === 1
                ? "this item"
                : "these items"}. Review {discardable.length === 1
                ? "it"
                : "them"} below{failure?.rollbackAvailable
                ? ", or restore your previous data"
                : ""}.
            {:else}
              {failure?.message ?? "Nerve reported a startup failure."}
            {/if}
          </p>
        </div>
        {#if kind === "discardable"}
          <ScrollArea class="max-h-48 rounded-md border bg-well">
            {#each [{ label: "Conversations", items: plan.conversations, note: "" }, { label: "Settings files", items: plan.files, note: "Reset to defaults; the original is kept beside it." }] as group (group.label)}
              {#if group.items.length}
                <div
                  class="px-3 pt-2 text-xs font-semibold text-muted-foreground"
                >
                  {group.label}
                </div>
                <ul class="grid divide-y">
                  {#each group.items as item (item.id)}
                    <li class="grid gap-0.5 px-3 py-2 text-sm">
                      <span class="break-words">{item.title || item.id}</span>
                      <span class="text-xs break-words text-muted-foreground">
                        {item.reason}
                      </span>
                    </li>
                  {/each}
                </ul>
              {/if}
            {/each}
          </ScrollArea>
        {/if}
        {@render technicalDetails()}
        {#if kind === "discardable" && failure?.message.startsWith("Rollback failed")}
          <p class="text-xs text-destructive break-words">{failure.message}</p>
        {/if}
        {#if serverLifecycleState.retryError}
          <p class="text-xs text-destructive">
            {serverLifecycleState.retryError}
          </p>
        {/if}
        <!-- One row: quiet escape left, then the alternative, then the
             recommended way forward (its confirmation spells out the cost). -->
        <div class="flex flex-wrap items-center justify-end gap-2">
          {@render quitButton()}
          {#if failure?.rollbackAvailable}
            <Button variant="outline" onclick={() => (confirming = "rollback")}>
              Restore previous version
            </Button>
          {/if}
          {#if kind === "discardable"}
            <Button onclick={() => (confirming = "discard")}>
              {plan.action}
            </Button>
          {:else if failure?.retryable}
            <Button onclick={onRetry}>Try again</Button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <ConfirmDialog
    class={noDragClass}
    portalProps={{ to: layer }}
    open={confirming === "discard"}
    title={plan.conversations.length
      ? "Discard and continue?"
      : "Reset to defaults?"}
    description={`${plan.confirmation} Nerve then continues starting, which can take a few minutes.`}
    confirmLabel={plan.conversations.length
      ? "Discard and continue"
      : "Reset and continue"}
    destructive
    onConfirm={() => onDiscardAndRetry(discardable.map((entry) => entry.id))}
    onOpenChange={(open) => {
      if (!open) confirming = undefined;
    }}
  />
  <ConfirmDialog
    class={noDragClass}
    portalProps={{ to: layer }}
    open={confirming === "rollback"}
    title="Restore previous version?"
    description="This undoes the upgrade and restores your data as it was before. Afterwards you need to quit Nerve and reinstall the previous version."
    confirmLabel="Restore previous version"
    onConfirm={onRollback}
    onOpenChange={(open) => {
      if (!open) confirming = undefined;
    }}
  />
{/if}
