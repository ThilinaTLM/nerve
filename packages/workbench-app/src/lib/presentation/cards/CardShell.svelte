<script lang="ts">
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { Snippet } from "svelte";

import type {
  CardAction,
  CardGlyph,
  MetaItem,
  PrimaryArg,
} from "./card-presentation";
import CardFooter from "./CardFooter.svelte";
import CardHeader from "./CardHeader.svelte";
import LifecycleFrame from "./LifecycleFrame.svelte";

type Props = {
  status?: string;
  draftPhase?: "drafting" | "prepared";
  dotTone: StatusTone;
  dotPulse?: boolean;
  /** Named glyph override (notices, handed-off work). */
  glyph?: CardGlyph;
  /** Accessible description of the card state. */
  statusLabel?: string;
  badge: string;
  arg?: PrimaryArg;
  error?: string;
  meta?: MetaItem[];
  /** Right-aligned footer pills, e.g. "Open task" then "View details". */
  cardActions?: CardAction[];
  /** Recovery-critical action rendered as a primary footer control. */
  primaryAction?: CardAction;
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
  glyph,
  statusLabel: statusLabelOverride,
  badge,
  arg,
  error,
  meta = [],
  cardActions = [],
  primaryAction,
  footer = true,
  bodyVisible = false,
  layoutRevision = "static",
  onOpenFile,
  children,
}: Props = $props();

const lifecycle = $derived.by<"running" | "complete" | "error" | "idle">(() => {
  if (draftPhase) return "running";
  switch (status) {
    case "committed":
    case "waiting":
    case "running":
      return "running";
    case "completed":
      return "complete";
    case "failed":
    case "denied":
      return "error";
    case "cancelled":
      return "idle";
    default:
      return "idle";
  }
});
const toolStatusLabel = $derived.by(() => {
  if (draftPhase) return "Preparing tool call";
  switch (status) {
    case "waiting":
      return "Needs approval";
    case "committed":
    case "running":
      return "Executing tool call";
    case "completed":
      return "Tool call completed";
    case "denied":
      return "Tool call denied";
    case "failed":
      return "Tool call failed";
    case "cancelled":
      return "Tool call cancelled";
    default:
      return "Tool call status";
  }
});
const statusLabel = $derived(statusLabelOverride ?? toolStatusLabel);
const footerVisible = $derived(
  footer &&
    (meta.length > 0 || cardActions.length > 0 || Boolean(primaryAction)),
);
const activityVisible = $derived(
  Boolean(error) || bodyVisible || footerVisible,
);
</script>

<LifecycleFrame revision={layoutRevision}>
  <article class="w-full py-2.5" data-state={draftPhase ?? lifecycle}>
    <CardHeader
      {dotTone}
      {dotPulse}
      waitingForUser={status === "waiting"}
      {statusLabel}
      {glyph}
      {badge}
      {arg}
      {onOpenFile}
    />

    <div class={`grid min-w-0 gap-1.5${activityVisible ? " pt-1.5" : ""}`}>
      {#if error}
        <pre
          class="m-0 whitespace-pre-wrap break-words rounded-sm border border-destructive/40 bg-panel px-2.5 py-2 font-mono text-xs leading-snug text-destructive">{error}</pre>
      {/if}

      {#if bodyVisible && children}
        <div class="grid min-w-0 gap-1.5">{@render children()}</div>
      {/if}

      {#if footerVisible}
        <CardFooter {meta} {cardActions} {primaryAction} {onOpenFile} />
      {/if}
    </div>
  </article>
</LifecycleFrame>
