<!--
  The tools a server offers, by name (a tooltip has each description), from
  connecting to it; or why it did not connect.
-->
<script lang="ts">
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Unplug from "@lucide/svelte/icons/unplug";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { McpTestResult } from "$lib/application/mcp/mcp-api";
import { SettingsSection } from "$lib/presentation/settings";

let {
  result,
  busy = false,
  error,
  onTest,
  onDisconnect,
}: {
  /** Absent until the first test. */
  result?: McpTestResult;
  busy?: boolean;
  /** The request itself failed. */
  error?: string;
  onTest: () => void;
  /** While connected: closes the connection (it reopens on next use). */
  onDisconnect?: () => void;
} = $props();

const ok = $derived(result?.status === "ok" ? result : undefined);
const description = $derived.by(() => {
  if (!ok) return undefined;
  const server = ok.server ? `${ok.server.name} ${ok.server.version}` : "";
  const resources = ok.resources.length
    ? `${ok.resources.length} ${ok.resources.length === 1 ? "resource" : "resources"}`
    : "";
  return [server, resources].filter(Boolean).join(" · ") || undefined;
});
</script>

<SettingsSection id="tools" title="Tools" {description}>
  {#snippet actions()}
    {#if onDisconnect}
      <Button
        size="sm"
        variant="ghost"
        class="text-muted-foreground"
        disabled={busy}
        onclick={onDisconnect}><Unplug class="size-3.5" />Disconnect</Button
      >
    {/if}
    <Button
      size="sm"
      variant="ghost"
      class="text-muted-foreground"
      disabled={busy}
      onclick={onTest}
      ><RefreshCw class="size-3.5" />{result || error
        ? "Test again"
        : "Test"}</Button
    >
  {/snippet}
  {#if busy}
    <p class="flex items-center gap-2 text-ui text-muted-foreground">
      <Spinner />Connecting. A local command may take a moment to start.
    </p>
  {:else if error}
    <Callout tone="destructive" text={error} />
  {:else if result?.status === "failed"}
    <Callout
      tone="destructive"
      title="Could not connect"
      class="whitespace-pre-wrap break-words"
      text={result.error}
    />
  {:else if result?.status === "refused"}
    <Callout tone="warning" text={result.reason} />
  {:else if ok && ok.tools.length}
    <ul class="flex flex-wrap gap-1.5" aria-label="Tools">
      {#each ok.tools as tool (tool.name)}
        <li>
          <Badge variant="neutral" class="font-mono" title={tool.description}
            >{tool.name}</Badge
          >
        </li>
      {/each}
    </ul>
  {:else if ok}
    <p class="text-ui text-muted-foreground">This server offers no tools.</p>
  {:else}
    <p class="text-ui text-muted-foreground">
      Test connects once to list its tools.
    </p>
  {/if}
</SettingsSection>
