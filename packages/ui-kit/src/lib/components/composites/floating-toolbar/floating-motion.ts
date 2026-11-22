/*
 * Motion of floating chrome, on the shared `--motion-*` tokens; reduced motion
 * turns it off.
 *
 * - `floatIn`/`floatOut`: a bar, panel or notice enters from / leaves toward
 *   the edge of its anchor (top anchors drop, bottom anchors rise, vertical
 *   bars slide in from the side) and scales from the anchored corner.
 * - `itemIn`/`itemOut`: a control or group joins / leaves a bar.
 * - `rowFade`: a row of a panel appears or goes; `autoSize` animates the height.
 * - `autoSize`: a bar or panel animates its own size when its content changes.
 *
 * Transitions return a deferred config: Svelte creates an intro before the node
 * is attached, when neither the tokens nor the anchor resolve yet.
 */
import { cubicIn, cubicOut } from "svelte/easing";

type Phase = "enter" | "exit";

function reducedMotion(): boolean {
  return (
    typeof matchMedia !== "function" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function motionMs(node: Element, phase: Phase, scale = 1): number {
  if (reducedMotion()) return 0;
  const token =
    phase === "enter" ? "--motion-enter-duration" : "--motion-exit-duration";
  const value = parseFloat(getComputedStyle(node).getPropertyValue(token));
  return (Number.isFinite(value) ? value : 0) * scale;
}

function anchorOf(node: Element): {
  vertical: "top" | "bottom";
  horizontal: "start" | "end";
} {
  const anchor =
    node.closest<HTMLElement>("[data-floating-anchor]")?.dataset
      .floatingAnchor ?? "top-end";
  return {
    vertical: anchor.startsWith("bottom") ? "bottom" : "top",
    horizontal: anchor.endsWith("start") ? "start" : "end",
  };
}

function float(node: HTMLElement, phase: Phase) {
  const { vertical, horizontal } = anchorOf(node);
  const sideways = node.dataset.orientation === "vertical";
  const dx = sideways ? (horizontal === "end" ? 6 : -6) : 0;
  const dy = sideways ? 0 : vertical === "top" ? -6 : 6;
  const origin = `${vertical} ${horizontal === "start" ? "left" : "right"}`;
  return {
    duration: motionMs(node, phase),
    easing: phase === "enter" ? cubicOut : cubicIn,
    css: (t: number) =>
      `opacity: ${t}; transform-origin: ${origin}; transform: translate(${(1 - t) * dx}px, ${(1 - t) * dy}px) scale(${0.96 + 0.04 * t});`,
  };
}

export const floatIn = (node: HTMLElement) => () => float(node, "enter");
export const floatOut = (node: HTMLElement) => () => float(node, "exit");

function item(node: HTMLElement, phase: Phase) {
  return {
    duration: motionMs(node, phase, 0.8),
    easing: phase === "enter" ? cubicOut : cubicIn,
    css: (t: number) => `opacity: ${t}; transform: scale(${0.8 + 0.2 * t});`,
  };
}

export const itemIn = (node: HTMLElement) => () => item(node, "enter");
export const itemOut = (node: HTMLElement) => () => item(node, "exit");

function row(node: HTMLElement, phase: Phase) {
  return {
    duration: motionMs(node, phase),
    delay: phase === "enter" ? motionMs(node, "enter", 0.3) : 0,
    easing: phase === "enter" ? cubicOut : cubicIn,
    css: (t: number) =>
      `opacity: ${t}; transform: translateY(${(1 - t) * -4}px);`,
  };
}

export const rowIn = (node: HTMLElement) => () => row(node, "enter");
export const rowOut = (node: HTMLElement) => () => row(node, "exit");

/**
 * Attachment for the outer box of a bar or panel: follows the size of its
 * first child and animates the outer box to it (the first size applies at
 * once). `height` leaves the width to layout (panels fill their width). A bar
 * whose groups all collapsed hides instead of leaving an empty pill.
 */
export function autoSize(axes: "both" | "height" = "both") {
  return (outer: HTMLElement): (() => void) => {
    const inner = outer.firstElementChild as HTMLElement | null;
    if (!inner || typeof ResizeObserver === "undefined") return () => {};
    let first = true;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(outer);
      const borderX =
        parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      const borderY =
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const duration = first ? 0 : motionMs(outer, "enter");
      outer.style.transition = `width ${duration}ms var(--motion-enter-easing), height ${duration}ms var(--motion-enter-easing)`;
      if (axes === "both")
        outer.style.width = `${inner.offsetWidth + borderX}px`;
      outer.style.height = `${inner.offsetHeight + borderY}px`;
      const visible = [...inner.children].some(
        (child) => (child as HTMLElement).offsetWidth > 0,
      );
      outer.style.visibility = visible ? "" : "hidden";
      first = false;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  };
}
