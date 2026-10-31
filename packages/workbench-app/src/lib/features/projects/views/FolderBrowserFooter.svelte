<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import type { FilesystemSignal } from "$lib/api";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
import { signalMeta, uniqueSignals } from "./directory-picker-helpers";

type Props = {
  /** Absolute path the primary action acts on. */
  path?: string;
  /** `path` with home collapsed, for display. */
  displayPath?: string;
  signals?: FilesystemSignal[];
  /** The target is already a project: the primary action switches to it. */
  known?: boolean;
  busy?: boolean;
  onCancel?: () => void;
  onOpen?: () => void;
};

let {
  path,
  displayPath,
  signals = [],
  known = false,
  busy = false,
  onCancel,
  onOpen,
}: Props = $props();
</script>

<div class="flex min-w-0 flex-1 items-center gap-2 max-sm:w-full">
  <FolderOpen
    class="size-4 shrink-0 text-muted-foreground"
    aria-hidden="true"
  />
  <span class="min-w-0 truncate font-mono text-xs" title={path}
    >{displayPath ?? "Choose a folder"}</span
  >
  <span class="flex shrink-0 gap-1 max-sm:hidden">
    {#each uniqueSignals(signals) as signal (signal)}
      {@const meta = signalMeta[signal]}
      {@const Icon = meta.icon}
      <Badge variant={meta.tone ?? "neutral"} title={meta.title}>
        <Icon />{meta.label}
      </Badge>
    {/each}
  </span>
</div>
<div class="flex items-center gap-1 max-sm:w-full">
  <span
    class="mr-2 flex items-center gap-1 text-xs text-muted-foreground max-sm:hidden"
  >
    <Kbd>Enter</Kbd> open <Kbd>→</Kbd> enter
  </span>
  <Button variant="ghost" class="max-sm:flex-1" onclick={onCancel}
    >Cancel</Button
  >
  <Button class="max-sm:flex-1" disabled={!path || busy} onclick={onOpen}>
    {#if known}
      <ArrowRight />Switch to project
    {:else}
      <FolderOpen />Open
    {/if}
  </Button>
</div>
