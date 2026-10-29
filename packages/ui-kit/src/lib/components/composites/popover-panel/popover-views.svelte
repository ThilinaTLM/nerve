<script lang="ts">
import { tick, untrack, type Snippet } from "svelte";
import { fade } from "svelte/transition";

let { key, children }: { key: unknown; children?: Snippet } = $props();
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
function outgoing(node: HTMLElement) {
  return {
    ...fade(node, { duration: duration() }),
    css: (t: number) =>
      `position:absolute;inset:0;opacity:${t};pointer-events:none;`,
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
    <div
      class="flex min-h-0 max-h-[inherit] flex-col"
      in:fade={{ duration: duration() }}
      out:outgoing
    >
      {@render children?.()}
    </div>
  {/key}
</div>
