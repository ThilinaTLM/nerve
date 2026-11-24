<!--
  The result of connecting to a server: its name and version, instructions,
  tools and resources, or why it did not connect. Also the detail view of a
  server: what the agent sees.
-->
<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { GroupLabel } from "@nervekit/ui-kit/components/composites/group-label";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { McpTestResult } from "$lib/application/mcp/mcp-api";
import McpToolList from "./McpToolList.svelte";

let {
  open = $bindable(false),
  name,
  result,
  busy = false,
  error,
  onRetest,
}: {
  open?: boolean;
  name: string;
  result?: McpTestResult;
  busy?: boolean;
  /** The request itself failed. */
  error?: string;
  onRetest: () => void;
} = $props();
</script>

<DialogShell
  bind:open
  size="md"
  title={name}
  description={result?.status === "ok" && result.server
    ? `${result.server.name} ${result.server.version}`
    : undefined}
>
  {#if busy}
    <p class="flex items-center gap-2 text-ui text-muted-foreground">
      <Spinner />Connecting. A local command may take a moment to start.
    </p>
  {:else if error}
    <Callout layout="block" tone="destructive" text={error} />
  {:else if result?.status === "failed"}
    <Callout
      layout="block"
      tone="destructive"
      title="Could not connect"
      class="whitespace-pre-wrap break-words"
      text={result.error}
    />
  {:else if result?.status === "refused"}
    <Callout layout="block" tone="warning" text={result.reason} />
  {:else if result?.status === "ok"}
    <div class="grid gap-4">
      {#if result.instructions}
        <section class="grid gap-1.5">
          <GroupLabel label="Instructions" />
          <p class="whitespace-pre-wrap text-ui text-foreground">
            {result.instructions}
          </p>
        </section>
      {/if}
      <section class="grid gap-1.5">
        <GroupLabel label="Tools" count={result.tools.length} />
        {#if result.tools.length}
          <McpToolList tools={result.tools} />
        {:else}
          <p class="text-ui text-muted-foreground">
            This server offers no tools.
          </p>
        {/if}
      </section>
      {#if result.resources.length}
        <section class="grid gap-1.5">
          <GroupLabel label="Resources" count={result.resources.length} />
          <ul
            class="grid divide-y divide-border-subtle rounded-md border bg-card"
          >
            {#each result.resources as resource (resource.uri)}
              <li class="grid gap-0.5 px-3 py-2">
                <span class="text-ui text-foreground">{resource.name}</span>
                <span
                  class="break-all font-mono text-caption text-muted-foreground"
                  >{resource.uri}</span
                >
                {#if resource.description}
                  <span class="text-caption text-muted-foreground"
                    >{resource.description}</span
                  >
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    <Button variant="outline" disabled={busy} onclick={onRetest}
      >Test again</Button
    >
    <Button onclick={() => (open = false)}>Close</Button>
  {/snippet}
</DialogShell>
