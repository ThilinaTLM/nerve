<script lang="ts">
import { tick, untrack, type Snippet } from "svelte";
import { cubicOut } from "svelte/easing";
import { fade } from "svelte/transition";

let {
  key,
  direction,
  children,
}: {
  key: unknown;
  /** Drill-in views slide toward where they come from: `forward` enters from
   * the end edge, `back` from the start edge. Omit for a plain cross-fade. */
  direction?: "forward" | "back";
  children?: Snippet;
} = $props();
let frame = $state<HTMLDivElement>();
let animation: Animation | undefined;
let previous = 0;
const reduced = () =>
  typeof matchMedia !== "undefined" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;
function duration() {
  if (reduced() || !frame) return 0;
  return (
    parseFloat(
      getComputedStyle(frame).getPropertyValue("--motion-enter-duration"),
    ) || 180
  );
}
const SLIDE_PX = 16;
function offset(): number {
  return direction === "forward"
    ? SLIDE_PX
    : direction === "back"
      ? -SLIDE_PX
      : 0;
}
function incoming(node: HTMLElement) {
  const x = offset();
  return {
    ...fade(node, { duration: duration(), easing: cubicOut }),
    css: (t: number, u: number) =>
      `opacity:${t};${x ? `transform:translateX(${u * x}px);` : ""}`,
  };
}
function outgoing(node: HTMLElement) {
  const x = -offset();
  return {
    ...fade(node, { duration: duration() }),
    css: (t: number, u: number) =>
      `position:absolute;inset:0;opacity:${t};pointer-events:none;${x ? `transform:translateX(${u * x}px);` : ""}`,
  };
}
$effect.pre(() => {
  void key;
  untrack(() => {
    previous = frame?.getBoundingClientRect().height ?? 0;
  });
});
$effect(() => {
  void key;
  let cancelled = false;
  untrack(() => {
    animation?.cancel();
    void tick().then(() => {
      if (cancelled || !frame || !previous || reduced()) return;
      const next = frame.getBoundingClientRect().height;
      if (next === previous) return;
      const styles = getComputedStyle(frame);
      animation = frame.animate(
        [{ height: `${previous}px` }, { height: `${next}px` }],
        {
          duration: duration(),
          easing:
            styles.getPropertyValue("--motion-enter-easing").trim() ||
            "ease-out",
        },
      );
    });
  });
  return () => {
    cancelled = true;
    animation?.cancel();
  };
});
</script>

<div
  bind:this={frame}
  class="relative flex min-h-0 max-h-[inherit] flex-col overflow-hidden"
>
  {#key key}
    <div class="flex min-h-0 max-h-[inherit] flex-col" in:incoming out:outgoing>
      {@render children?.()}
    </div>
  {/key}
</div>
