<script lang="ts">
import type { StatusTone } from "@nervekit/ui-kit/components/ui/status-dot";
import type { PrimaryArg } from "../../views/tool-presentation";
import ToolStatusIcon from "./ToolStatusIcon.svelte";

type Props = {
  dotTone: StatusTone;
  dotPulse?: boolean;
  waitingForUser?: boolean;
  statusLabel: string;
  badge: string;
  arg?: PrimaryArg;
  onOpenFile?: (path: string, line?: number) => void;
};

let {
  dotTone,
  dotPulse = false,
  waitingForUser = false,
  statusLabel,
  badge,
  arg,
  onOpenFile,
}: Props = $props();
</script>

<div class="tool-header">
  <ToolStatusIcon
    tone={dotTone}
    pulse={dotPulse}
    {waitingForUser}
    label={statusLabel}
    size={14}
    class="mr-1.5 align-middle"
  />
  <span class="badge">{badge}</span>
  {#if arg}
    {#if arg.openPath}
      <button
        class="arg link"
        class:whitespace-pre-wrap={arg.preserveWhitespace}
        type="button"
        title={arg.text}
        onclick={() => onOpenFile?.(arg.openPath!, arg.line)}>{arg.text}</button
      >
    {:else if arg.href}
      <a
        class="arg link"
        class:whitespace-pre-wrap={arg.preserveWhitespace}
        href={arg.href}
        target="_blank"
        rel="noreferrer noopener"
        title={arg.text}>{arg.text}</a
      >
    {:else}
      <span
        class="arg"
        class:whitespace-pre-wrap={arg.preserveWhitespace}
        title={arg.text}>{arg.text}</span
      >
    {/if}
  {/if}
</div>

<style>
/* Inline flow lets long arguments wrap flush to the left edge. */
.tool-header {
  min-width: 0;
  line-height: 1.5;
}

.badge {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 650;
  color: var(--foreground);
}

.arg {
  margin-left: 0.5rem;
  color: var(--muted-foreground);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.arg.link {
  border: 0;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  padding: 0;
  text-align: left;
  text-decoration: none;
}

.arg.link:hover {
  text-decoration: underline;
}
</style>
