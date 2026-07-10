<script lang="ts">
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
  import { Button } from "@nervekit/workbench-ui/components/ui/button";
  import { shortenPath } from "$lib/core/utils/path";
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

  let { path, homeDir, signals = [], signalMeta, loading = false, onOpen }: Props = $props();
</script>

<div class="footer-path" title={path}>
  <FolderOpen size={14} strokeWidth={2.1} aria-hidden="true" />
  <span class="footer-path-text">{path ? shortenPath(path, homeDir) : "—"}</span>
  <span class="footer-signals">
    {#each signals as signal}
      {@const meta = signalMeta[signal]}
      {@const Icon = meta.icon}
      <Badge tone={meta.tone ?? "neutral"} size="xs" title={meta.title}>
        <Icon size={11} strokeWidth={2.2} />{meta.label}
      </Badge>
    {/each}
  </span>
</div>
<div class="footer-actions">
  <Button
    class="footer-open-button"
    size="sm"
    disabled={!path || loading}
    title={path ? `Open ${path}` : "Open"}
    onclick={onOpen}
  >
    <FolderOpen size={14} strokeWidth={2.2} />
    Open
  </Button>
</div>
