<script lang="ts">
import Square from "@lucide/svelte/icons/square";
import type { AsyncBash } from "@nervekit/contracts/core";
import {
  FloatingToolbar,
  FloatingToolbarButton,
  FloatingToolbarGroup,
  FloatingToolbarText,
} from "@nervekit/ui-kit/components/composites/floating-toolbar";
import LogStream from "$lib/presentation/logs/LogStream.svelte";
import {
  asyncBashLogLines,
  type LogPage,
} from "../state/async-bash-log-window";
import AsyncBashStatusIcon from "./AsyncBashStatusIcon.svelte";

let {
  bashId,
  bash,
  command,
  page,
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
  page?: LogPage;
  error?: string;
  elapsed?: string;
  /** Paged back far enough that the window no longer holds live output. */
  detached?: boolean;
  stopping?: boolean;
  onLoadEarlier: () => Promise<void>;
  onJumpToLatest: () => Promise<void>;
  onStop: () => void;
} = $props();

const lines = $derived(asyncBashLogLines(page));
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
    hasMoreBefore={(page?.offset ?? 0) > 0}
    {detached}
    loadError={error}
    {onLoadEarlier}
    {onJumpToLatest}
  >
    {#snippet topEnd()}
      <FloatingToolbar label="Command controls">
        <FloatingToolbarGroup>
          <FloatingToolbarText title={bash?.workingDirectory}>
            {#if bash}<AsyncBashStatusIcon status={bash.status} />{/if}
            {#if elapsed}<span>{elapsed}</span>{/if}
            {#if bash?.exitCode != null}<span>exit {bash.exitCode}</span>{/if}
          </FloatingToolbarText>
        </FloatingToolbarGroup>
        {#if bash?.status === "running"}
          <FloatingToolbarGroup>
            <FloatingToolbarButton
              label="Stop command"
              icon={Square}
              tone="destructive"
              disabled={stopping}
              onclick={onStop}
            />
          </FloatingToolbarGroup>
        {/if}
      </FloatingToolbar>
    {/snippet}
  </LogStream>
</section>
