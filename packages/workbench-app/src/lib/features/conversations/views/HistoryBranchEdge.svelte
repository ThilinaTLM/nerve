<script lang="ts">
import { BaseEdge, type EdgeProps } from "@xyflow/svelte";

let { id, sourceX, sourceY, targetX, targetY, style }: EdgeProps = $props();

// Same column: a straight line. Fork: drop to the gap between the two label
// rows, run across it, then drop into the branch. Labels sit around each row
// and rows are a fixed gap apart, so the run never crosses text.
const path = $derived.by(() => {
  if (Math.abs(targetX - sourceX) < 1)
    return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  const mid = (sourceY + targetY) / 2;
  const r = Math.min(4, Math.abs(targetX - sourceX) / 2);
  const dir = targetX > sourceX ? 1 : -1;
  return [
    `M ${sourceX} ${sourceY}`,
    `L ${sourceX} ${mid - r}`,
    `Q ${sourceX} ${mid} ${sourceX + dir * r} ${mid}`,
    `L ${targetX - dir * r} ${mid}`,
    `Q ${targetX} ${mid} ${targetX} ${mid + r}`,
    `L ${targetX} ${targetY}`,
  ].join(" ");
});
</script>

<BaseEdge {id} {path} {style} />
