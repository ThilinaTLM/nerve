<script lang="ts">
import type { TaskLogEvent } from "../../../state/tool-types";
import { VirtualScroller } from "@nervekit/ui-kit/components/ui/virtual-list";
import TerminalText from "./TerminalText.svelte";

type LineItem = {
  key: string | number;
  text: string;
  level?: TaskLogEvent["level"];
  stream?: TaskLogEvent["stream"];
};

type Props = {
  events?: TaskLogEvent[];
  lines?: string[];
  maxHeight?: string;
  /** Stick to the bottom as new lines arrive (live tails). */
  followOutput?: boolean;
};
let {
  events,
  lines,
  maxHeight = "16rem",
  followOutput = false,
}: Props = $props();

const items = $derived<LineItem[]>(
  events
    ? events.map((event) => ({
        key: event.seq,
        text: event.line,
        level: event.level,
        stream: event.stream,
      }))
    : (lines ?? []).map((text, index) => ({ key: `line:${index}`, text })),
);
</script>

<div class="log-list-wrap" style:--log-max-height={maxHeight}>
  <VirtualScroller
    {items}
    getKey={(item) => item.key}
    estimateSize={() => 16}
    anchor={followOutput ? "end" : "start"}
    {followOutput}
    viewportClass="max-h-(--log-max-height) rounded-sm border border-border bg-sidebar px-2 py-1.5 font-mono text-xs leading-[1.22] text-sidebar-foreground"
  >
    {#snippet row({ item })}
      <div
        class={`log-line${item.level ? ` level-${item.level}` : ""}${item.stream === "stderr" ? " stderr" : ""}`}
      >
        <TerminalText
          text={item.text || "\u00A0"}
          stream={item.stream}
          level={item.level}
        />
      </div>
    {/snippet}
  </VirtualScroller>
</div>

<style>
.log-list-wrap {
  min-width: 0;
}

.log-line {
  white-space: pre-wrap;
  word-break: break-word;
}

.log-line.stderr {
  color: color-mix(in oklab, var(--muted-foreground) 90%, var(--foreground));
}

.log-line.level-warn {
  color: var(--warning);
}

.log-line.level-error {
  color: var(--destructive);
}
</style>
