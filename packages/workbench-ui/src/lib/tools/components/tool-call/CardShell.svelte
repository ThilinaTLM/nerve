<script lang="ts">
import type { Snippet } from "svelte";
import type { StatusTone } from "@nervekit/ui-kit/components/ui/status-dot";
import type { MetaItem, PrimaryArg } from "../../views/tool-presentation";
import ToolStatusIcon from "./ToolStatusIcon.svelte";
import ToolFooter from "./ToolFooter.svelte";

type Props = {
  /** Tool-call status; mapped to a `data-state` lifecycle styling hook. */
  status?: string;
  dotTone: StatusTone;
  dotPulse?: boolean;
  badge: string;
  arg?: PrimaryArg;
  error?: string;
  meta?: MetaItem[];
  detailsAction?: { label: string; onClick: () => void };
  /**
   * Render the generic footer (meta chips + show-more). Interactive HIL tools
   * suppress this and render their own footer (chips + action buttons) inside
   * the body so chips and buttons share one line.
   */
  footer?: boolean;
  needsAttention?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
  children?: Snippet;
};
let {
  status,
  dotTone,
  dotPulse = false,
  badge,
  arg,
  error,
  meta = [],
  detailsAction,
  footer = true,
  needsAttention = false,
  onOpenFile,
  children,
}: Props = $props();

// Lightweight lifecycle derived from the (exhaustive) tool-call status enum.
const lifecycle = $derived.by<"running" | "complete" | "error" | "idle">(() => {
  switch (status) {
    case "requested":
    case "pending_approval":
    case "waiting_for_user":
    case "running":
      return "running";
    case "completed":
      return "complete";
    case "error":
    case "denied":
      return "error";
    default:
      return "idle";
  }
});

// Transient settle only on a real running -> terminal change. Initialize the
// tracker to the current value so a card that mounts already terminal does
// not fire a spurious settle.
let settling = $state(false);
let previousLifecycle: "running" | "complete" | "error" | "idle" | undefined;
$effect(() => {
  const current = lifecycle;
  if (previousLifecycle === undefined) {
    previousLifecycle = current;
    return;
  }
  if (
    previousLifecycle === "running" &&
    (current === "complete" || current === "error")
  ) {
    settling = true;
  }
  previousLifecycle = current;
});
</script>

<article
  class="tool-card"
  class:state-settling={settling}
  class:needs-attention={needsAttention}
  data-state={lifecycle}
  onanimationend={(event) => {
    if (event.target === event.currentTarget) settling = false;
  }}
>
  <div class="tool-header">
    <ToolStatusIcon
      tone={dotTone}
      pulse={dotPulse}
      waitingForUser={status === "waiting_for_user" ||
        status === "pending_approval"}
      label={status === "waiting_for_user"
        ? "Waiting for user feedback"
        : status === "pending_approval"
          ? "Approval required"
          : undefined}
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
          onclick={() => onOpenFile?.(arg.openPath!, arg.line)}
          >{arg.text}</button
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
    {#if needsAttention}
      <span class="attention-label">Needs your input</span>
    {/if}
  </div>

  {#if error}
    <pre class="tool-error">{error}</pre>
  {/if}

  {#if children}
    <div class="tool-body">{@render children()}</div>
  {/if}

  {#if footer}
    <ToolFooter {meta} {detailsAction} {onOpenFile} />
  {/if}
</article>

<style>
.tool-card {
  display: grid;
  gap: 0.4rem;
  width: 100%;
  padding: 0.6rem 0;
}

/* Brief opacity/transform settle when a running tool reaches a terminal
   * state. Neutralized by the global prefers-reduced-motion rule in base.css. */
.tool-card.state-settling {
  animation: transcript-state-settle 180ms ease-out;
}

/* Inline flow so a long arg wraps flush to the left edge (no hanging indent). */
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
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted-foreground);
  margin-left: 0.5rem;
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

.attention-label {
  display: inline-flex;
  margin-left: 0.5rem;
  border-radius: var(--radius-sm);
  background: color-mix(in oklab, var(--warning) 14%, transparent);
  color: var(--warning);
  padding: 0.1rem 0.35rem;
  font-size: var(--text-xs);
  font-weight: 600;
  white-space: nowrap;
}

.tool-body {
  min-width: 0;
}

.tool-error {
  margin: 0;
  border: 1px solid color-mix(in oklab, var(--destructive) 40%, var(--border));
  border-radius: var(--radius-sm);
  background: var(--sidebar);
  color: var(--destructive);
  padding: 0.48rem 0.58rem;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
