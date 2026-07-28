<script lang="ts">
import type { Snippet } from "svelte";
import type { StatusTone } from "@nervekit/ui-kit/components/ui/status-dot";
import type { MetaItem, PrimaryArg } from "../../views/tool-presentation";
import ToolFooter from "./ToolFooter.svelte";
import ToolCardHeader from "./ToolCardHeader.svelte";
import ToolLifecycleFrame from "./ToolLifecycleFrame.svelte";

type Props = {
  status?: string;
  draftPhase?: "drafting" | "prepared";
  dotTone: StatusTone;
  dotPulse?: boolean;
  badge: string;
  arg?: PrimaryArg;
  error?: string;
  meta?: MetaItem[];
  detailsAction?: { label: string; onClick: () => void };
  footer?: boolean;
  bodyVisible?: boolean;
  layoutRevision?: string;
  onOpenFile?: (path: string, line?: number) => void;
  children?: Snippet;
};
let {
  status,
  draftPhase,
  dotTone,
  dotPulse = false,
  badge,
  arg,
  error,
  meta = [],
  detailsAction,
  footer = true,
  bodyVisible = false,
  layoutRevision = "static",
  onOpenFile,
  children,
}: Props = $props();

const lifecycle = $derived.by<"running" | "complete" | "error" | "idle">(() => {
  if (draftPhase) return "running";
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
const statusLabel = $derived(
  draftPhase
    ? "Preparing tool call"
    : status === "pending_approval"
      ? "Needs approval"
      : status === "waiting_for_user"
        ? "Waiting for user feedback"
        : status === "requested" || status === "running"
          ? "Executing tool call"
          : status === "completed"
            ? "Tool call completed"
            : status === "denied"
              ? "Tool call denied"
              : status === "error"
                ? "Tool call failed"
                : "Tool call status",
);
const footerVisible = $derived(
  footer && (meta.length > 0 || Boolean(detailsAction)),
);
const activityVisible = $derived(
  Boolean(error) || bodyVisible || footerVisible,
);
</script>

<ToolLifecycleFrame revision={layoutRevision}>
  <article class="tool-card" data-state={draftPhase ?? lifecycle}>
    <ToolCardHeader
      {dotTone}
      {dotPulse}
      waitingForUser={status === "waiting_for_user" ||
        status === "pending_approval"}
      {statusLabel}
      {badge}
      {arg}
      {onOpenFile}
    />

    <div class={`grid min-w-0 gap-1.5${activityVisible ? " pt-1.5" : ""}`}>
      {#if error}
        <pre class="tool-error">{error}</pre>
      {/if}

      {#if bodyVisible && children}
        <div class="tool-body grid gap-1.5">{@render children()}</div>
      {/if}

      {#if footerVisible}
        <ToolFooter {meta} {detailsAction} {onOpenFile} />
      {/if}
    </div>
  </article>
</ToolLifecycleFrame>

<style>
.tool-card {
  width: 100%;
  padding: 0.6rem 0;
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
