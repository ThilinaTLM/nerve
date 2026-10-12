<script lang="ts">
import type {
  AsyncBash,
  AsyncBashLogsResponse,
} from "@nervekit/contracts/core";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import Square from "@lucide/svelte/icons/square";
import TerminalText from "$lib/presentation/tools/tool-call/TerminalText.svelte";
let {
  bash,
  command,
  streams = [],
  error,
  elapsed,
  onRefresh,
  onEarlier,
  onStop,
  stopping = false,
  paused = false,
}: {
  bash?: AsyncBash;
  command?: string;
  streams?: AsyncBashLogsResponse["streams"];
  error?: string;
  elapsed?: string;
  onRefresh: () => void;
  onEarlier: () => void;
  onStop: () => void;
  stopping?: boolean;
  paused?: boolean;
} = $props();
</script>

<section
  class="flex h-full min-h-0 flex-col bg-background"
  aria-label="Background command output"
>
  <header class="flex flex-wrap items-center gap-2 border-b bg-panel p-3">
    <span class="text-sm font-medium">{bash?.status ?? "Loading command"}</span>
    {#if elapsed}<span class="text-xs text-muted-foreground">{elapsed}</span
      >{/if}
    {#if bash?.exitCode != null}<span class="text-xs text-muted-foreground"
        >Exit {bash.exitCode}</span
      >{/if}
    {#if paused}<span class="text-xs text-muted-foreground"
        >Live updates paused</span
      >{/if}
    <div class="ml-auto flex gap-2">
      <Button
        size="sm"
        variant="outline"
        onclick={onEarlier}
        disabled={!streams.some((stream) => stream.offset > 0)}
        ><ArrowUp class="size-3" />Load earlier</Button
      >
      <Button
        size="sm"
        variant="outline"
        onclick={onRefresh}
        title="Return to latest / resume live output"
        ><RefreshCw class="size-3" />Refresh</Button
      >
      {#if bash?.status === "running"}<Button
          size="sm"
          variant="outline"
          onclick={onStop}
          disabled={stopping}><Square class="size-3" />Stop</Button
        >{/if}
    </div>
  </header>
  <div class="space-y-1 border-b p-3">
    <pre
      class="whitespace-pre-wrap break-all font-mono text-xs">{bash?.command ??
        command ??
        "Background command"}</pre>
    {#if bash}<p class="break-all font-mono text-xs text-muted-foreground">
        {bash.workingDirectory}
      </p>{/if}
  </div>
  {#if error}<p class="p-3 text-sm text-destructive" role="alert">
      {error}
    </p>{/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to scroll the output region.) -->
  <div
    class="min-h-0 flex-1 overflow-auto bg-well p-3"
    tabindex="0"
    role="region"
    aria-label="Command logs"
  >
    {#if !streams.some((stream) => stream.text.length > 0)}
      <p class="text-sm text-muted-foreground">
        {bash ? "No output yet" : "Loading output…"}
      </p>
    {:else}
      {#each streams as stream (stream.stream)}
        {#if stream.stream !== "combined"}<h3
            class="mb-2 text-xs text-muted-foreground"
          >
            {stream.stream}
          </h3>{/if}
        {#if stream.offset > 0}<p class="mb-2 text-xs text-muted-foreground">
            Earlier output omitted · byte {stream.offset}
          </p>{/if}
        <pre
          class="whitespace-pre-wrap break-all font-mono text-xs"><TerminalText
            text={stream.text}
          /></pre>
      {/each}
    {/if}
  </div>
</section>
