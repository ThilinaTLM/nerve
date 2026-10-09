<script lang="ts">
import FoldVertical from "@lucide/svelte/icons/fold-vertical";
import LocateFixed from "@lucide/svelte/icons/locate-fixed";
import Scan from "@lucide/svelte/icons/scan";
import UnfoldVertical from "@lucide/svelte/icons/unfold-vertical";
import ZoomIn from "@lucide/svelte/icons/zoom-in";
import ZoomOut from "@lucide/svelte/icons/zoom-out";
import { Panel, useSvelteFlow } from "@xyflow/svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { HistoryFlowEdge, HistoryFlowNode } from "./history-flow";

type Props = {
  activeNodeId: string;
  hasSegments: boolean;
  allExpanded: boolean;
  onToggleAll: () => void;
  fitRequest: number;
  centerRequest?: { id: string; serial: number };
};

let {
  activeNodeId,
  hasSegments,
  allExpanded,
  onToggleAll,
  fitRequest,
  centerRequest,
}: Props = $props();

const { fitView, getNode, getZoom, setCenter, zoomIn, zoomOut } = useSvelteFlow<
  HistoryFlowNode,
  HistoryFlowEdge
>();

let lastFitRequest = 0;
let lastCenterSerial = 0;

function fitAll() {
  void fitView({ padding: 0.12, minZoom: 0.12, maxZoom: 1, duration: 200 });
}

function focusActive() {
  const node = getNode(activeNodeId);
  if (!node) return;
  void fitView({ nodes: [node], padding: 0.8, maxZoom: 1, duration: 200 });
}

$effect(() => {
  if (fitRequest <= lastFitRequest) return;
  lastFitRequest = fitRequest;
  queueMicrotask(fitAll);
});

$effect(() => {
  if (!centerRequest || centerRequest.serial <= lastCenterSerial) return;
  lastCenterSerial = centerRequest.serial;
  queueMicrotask(() => {
    const node = getNode(centerRequest.id);
    if (!node) return;
    const width = node.measured?.width ?? node.initialWidth ?? 0;
    const height = node.measured?.height ?? node.initialHeight ?? 0;
    void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: getZoom(),
      duration: 180,
    });
  });
});
</script>

<Panel position="top-left">
  <div
    class="nopan flex items-center gap-1 rounded-md border bg-card p-1 shadow-sm"
    aria-label="Conversation graph controls"
  >
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Zoom in"
      title="Zoom in"
      onclick={() => void zoomIn({ duration: 120 })}
    >
      <ZoomIn class="size-4" strokeWidth={2} />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Zoom out"
      title="Zoom out"
      onclick={() => void zoomOut({ duration: 120 })}
    >
      <ZoomOut class="size-4" strokeWidth={2} />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Fit entire graph"
      title="Fit entire graph"
      onclick={fitAll}
    >
      <Scan class="size-4" strokeWidth={2} />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Focus active entry"
      title="Focus active entry"
      onclick={focusActive}
    >
      <LocateFixed class="size-4" strokeWidth={2} />
    </Button>
    {#if hasSegments}
      <span class="mx-0.5 h-5 w-px bg-border" aria-hidden="true"></span>
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel={allExpanded
          ? "Collapse all tool runs"
          : "Expand all tool runs"}
        title={allExpanded ? "Collapse all tool runs" : "Expand all tool runs"}
        onclick={onToggleAll}
      >
        {#if allExpanded}
          <FoldVertical class="size-4" strokeWidth={2} />
        {:else}
          <UnfoldVertical class="size-4" strokeWidth={2} />
        {/if}
      </Button>
    {/if}
  </div>
</Panel>
