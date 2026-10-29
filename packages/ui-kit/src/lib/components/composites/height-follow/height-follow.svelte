<script lang="ts">
import type { Snippet } from "svelte";
import { untrack } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import {
  HEIGHT_RESPONSE_MS,
  HeightSpring,
  sharedSpringDriver,
  type HeightMotionProfile,
  type SpringDriver,
  type SpringDriverClient,
} from "@nervekit/ui-kit/scheduling/height-spring";

type Props = {
  /** Height changes animate only while active; otherwise they apply instantly. */
  active?: boolean;
  /** Off-screen followers never animate. */
  visible?: boolean;
  /** Burst-aware motion profile, read whenever motion starts or retargets. */
  profile?: () => HeightMotionProfile;
  class?: string;
  children?: Snippet;
};

let {
  active = false,
  visible = true,
  profile,
  class: className,
  children,
}: Props = $props();

let outer: HTMLDivElement | undefined = $state();
let inner: HTMLDivElement | undefined = $state();

const spring = new HeightSpring(0);
let measured = false;
let lastInlineSize: number | undefined;
let driver: SpringDriver | undefined;

function responseMs(): number {
  return HEIGHT_RESPONSE_MS[profile?.() ?? "standard"];
}

function release(): void {
  outer?.style.removeProperty("height");
  outer?.style.removeProperty("overflow");
}

/**
 * While active, the outer box keeps an explicit height even between motions.
 * Growth is then only ever applied by the spring step (in a frame callback,
 * before layout), so ancestors measuring this row never observe the natural
 * height for a frame before the pin catches up. Without this, the first
 * growth after a settled motion reached a virtualized list one frame early
 * and the scroll-follow overshot and bounced back on every new line.
 */
function holding(): boolean {
  return active && visible && !prefersReducedMotion.current && responseMs() > 0;
}

/** Hold the settled height; content fits, so nothing needs clipping. */
function hold(height: number): void {
  if (!outer) return;
  outer.style.removeProperty("overflow");
  outer.style.height = `${height}px`;
}

function settle(): void {
  if (holding()) hold(spring.height);
  else release();
}

const client: SpringDriverClient = {
  step(dtMs) {
    const done = spring.step(dtMs, responseMs());
    if (done) {
      driver = undefined;
      settle();
    } else if (outer) {
      outer.style.height = `${spring.height}px`;
    }
    return done;
  },
};

function snap(height: number): void {
  spring.snap(height);
  if (driver) {
    driver.remove(client);
    driver = undefined;
  }
  settle();
}

function shouldAnimate(widthChanged: boolean): boolean {
  return holding() && !widthChanged;
}

function follow(blockSize: number, inlineSize: number): void {
  // Start settled: the first measurement (mount, remount, virtual-row
  // re-entry) never animates from an estimate.
  if (!measured) {
    measured = true;
    lastInlineSize = inlineSize;
    snap(blockSize);
    return;
  }
  const widthChanged =
    lastInlineSize !== undefined && Math.abs(inlineSize - lastInlineSize) > 0.5;
  lastInlineSize = inlineSize;
  if (!shouldAnimate(widthChanged)) {
    snap(blockSize);
    return;
  }
  if (!driver && Math.abs(blockSize - spring.height) < 0.5) {
    snap(blockSize);
    return;
  }
  spring.retarget(blockSize);
  if (driver) return;
  const shared = sharedSpringDriver();
  if (!shared || !shared.add(client)) {
    snap(blockSize);
    return;
  }
  driver = shared;
  // Called from ResizeObserver (after layout, before paint): pin the previous
  // height so the new natural height never paints for a frame.
  if (outer) {
    outer.style.overflow = "hidden";
    outer.style.height = `${spring.height}px`;
  }
}

// Pin when following starts and release once it stops; a running motion
// settles through `step`, which re-checks `holding()`.
$effect(() => {
  const shouldHold = holding();
  untrack(() => {
    if (driver || !measured) return;
    if (shouldHold) hold(spring.height);
    else release();
  });
});

$effect(() => {
  const node = inner;
  if (!node || typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver((entries) => {
    const entry = entries.at(-1);
    const box = entry?.borderBoxSize?.[0];
    if (!entry || !box) return;
    follow(box.blockSize, box.inlineSize);
  });
  observer.observe(node);
  return () => {
    observer.disconnect();
    driver?.remove(client);
    driver = undefined;
  };
});
</script>

<div bind:this={outer} class={className}>
  <div bind:this={inner} class="flow-root">
    {#if children}{@render children()}{/if}
  </div>
</div>
