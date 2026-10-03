<script lang="ts">
import type { Snippet } from "svelte";
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

const client: SpringDriverClient = {
  step(dtMs) {
    const done = spring.step(dtMs, responseMs());
    if (done) {
      driver = undefined;
      release();
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
  release();
}

function shouldAnimate(widthChanged: boolean): boolean {
  return (
    active &&
    visible &&
    !widthChanged &&
    !prefersReducedMotion.current &&
    responseMs() > 0
  );
}

function follow(blockSize: number, inlineSize: number): void {
  // Start settled: the first measurement (mount, remount, virtual-row
  // re-entry) never animates from an estimate.
  if (!measured) {
    measured = true;
    lastInlineSize = inlineSize;
    spring.snap(blockSize);
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
    spring.snap(blockSize);
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
