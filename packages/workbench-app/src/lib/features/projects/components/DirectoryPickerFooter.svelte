<script lang="ts">
import FolderOpen from "@lucide/svelte/icons/folder-open";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { shortenPath } from "$lib/kernel/utils/path";
import type { FilesystemSignal } from "$lib/api";
import type { SignalMetaByKind } from "./directory-picker-types";

type Props = {
  path: string;
  homeDir?: string;
  signals?: FilesystemSignal[];
  signalMeta: SignalMetaByKind;
  loading?: boolean;
  onOpen?: () => void;
};

let {
  path,
  homeDir,
  signals = [],
  signalMeta,
  loading = false,
  onOpen,
}: Props = $props();
</script>

<div
  class="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground"
  title={path}
>
  <FolderOpen
    size={14}
    strokeWidth={2.1}
    aria-hidden="true"
    class="flex-none text-primary"
  />
  <span
    class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-foreground"
    >{path ? shortenPath(path, homeDir) : "—"}</span
  >
  <span class="flex flex-none items-center gap-1">
    {#each signals as signal (signal)}
      {@const meta = signalMeta[signal]}
      {@const Icon = meta.icon}
      <Badge tone={meta.tone ?? "neutral"} size="xs" title={meta.title}>
        <Icon size={11} strokeWidth={2.2} />{meta.label}
      </Badge>
    {/each}
  </span>
</div>
<div class="flex flex-none items-center gap-2.5">
  <Button
    size="sm"
    disabled={!path || loading}
    title={path ? `Open ${path}` : "Open"}
    onclick={onOpen}
  >
    <FolderOpen size={14} strokeWidth={2.2} />
    Open
  </Button>
</div>
