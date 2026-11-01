<script lang="ts">
import { untrack } from "svelte";
import { useSvelteFlow } from "@xyflow/svelte";

type Props = {
  focus?: { x: number; y: number };
  request: number;
  fit: number;
};

/** Centers the viewport on `focus` whenever `request` changes; fits on `fit`. */
let { focus, request, fit }: Props = $props();
const { setCenter, fitView, getZoom } = useSvelteFlow();

$effect(() => {
  const current = request;
  untrack(() => {
    if (!focus || current === 0) return;
    const zoom = Math.max(getZoom(), 1);
    // Keep the focused column left of centre so labels have room to the right.
    void setCenter(focus.x + 160 / zoom, focus.y, {
      zoom,
      duration: current === 1 ? 0 : 180,
    });
  });
});
$effect(() => {
  if (fit > 0) void fitView({ padding: 0.08, duration: 200 });
});
</script>

<!-- Renders nothing; lives inside SvelteFlow to reach its viewport API. -->
<span hidden></span>
