<script lang="ts">
import Square from "@lucide/svelte/icons/square";
import type { AsyncBash } from "@nervekit/contracts/core";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { FloatingToolbar } from "@nervekit/ui-kit/components/composites/floating-toolbar";
import LogStream from "$lib/presentation/logs/LogStream.svelte";
import {
  asyncBashLogLines,
  type LogStream as LogWindow,
} from "../state/async-bash-log-window";
import AsyncBashStatusIcon from "./AsyncBashStatusIcon.svelte";

let {
  bashId,
  bash,
  command,
  streams = [],
  error,
  elapsed,
  detached = false,
  stopping = false,
  onLoadEarlier,
  onJumpToLatest,
  onStop,
}: {
  bashId: string;
  bash?: AsyncBash;
  command?: string;
  streams?: LogWindow[];
  error?: string;
  elapsed?: string;
  /** Paged back far enough that the window no longer holds live output. */
  detached?: boolean;
  stopping?: boolean;
  onLoadEarlier: () => Promise<void>;
  onJumpToLatest: () => Promise<void>;
  onStop: () => void;
} = $props();

const lines = $derived(asyncBashLogLines(streams));
</script>

<section
  class="relative h-full min-h-0 bg-background"
  aria-label="Background command output"
>
  <LogStream
    scopeKey={`async-bash:${bashId}`}
    ariaLabel="Command output"
    emptyLabel={bash ? "No output yet." : "Loading output…"}
    {lines}
    command={bash?.command ?? command}
    hasMoreBefore={streams.some((stream) => stream.offset > 0)}
    {detached}
    {onLoadEarlier}
    {onJumpToLatest}
  >
    {#snippet dock()}
      <FloatingToolbar
        label="Command controls"
        class="max-w-[calc(100%-1.5rem)]"
      >
        <span
          class="flex h-6 min-w-0 items-center gap-1.5 px-1.5 text-xs text-muted-foreground tabular-nums"
          title={bash?.workingDirectory}
        >
          {#if bash}<AsyncBashStatusIcon status={bash.status} />{/if}
          {#if elapsed}<span>{elapsed}</span>{/if}
          {#if bash?.exitCode != null}<span>exit {bash.exitCode}</span>{/if}
          {#if error}<span class="truncate text-destructive" role="alert"
              >{error}</span
            >{/if}
        </span>
        {#if bash?.status === "running"}
          <Button
            variant="ghost"
            size="icon-xs"
            ariaLabel="Stop command"
            title="Stop"
            disabled={stopping}
            onclick={onStop}
          >
            <Square aria-hidden="true" />
          </Button>
        {/if}
      </FloatingToolbar>
    {/snippet}
  </LogStream>
</section>
