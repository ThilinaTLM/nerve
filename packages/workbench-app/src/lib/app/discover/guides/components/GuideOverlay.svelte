<script lang="ts">
import { tick } from "svelte";
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import Check from "@lucide/svelte/icons/check";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import type { TourStep } from "../tour-content.js";
import type { SetupGuideStep } from "../setup-content.js";
import { calloutPlacement, type Rect } from "../tour-controller.js";

type Props = {
  step: TourStep | SetupGuideStep;
  variant?: "modal" | "coach";
  index: number;
  count: number;
  preparing?: boolean;
  compact?: boolean;
  onBack: () => void;
  onNext: () => void;
  onComplete: () => void;
  onClose: () => void;
};

let {
  step,
  variant = "modal",
  index,
  count,
  preparing = false,
  compact = false,
  onBack,
  onNext,
  onComplete,
  onClose,
}: Props = $props();

let targetRect = $state<Rect | undefined>();
let calloutElement = $state<HTMLElement | null>(null);
let calloutWidth = $state(384);
let calloutHeight = $state(220);
let viewportWidth = $state(
  typeof window === "undefined" ? 1024 : window.innerWidth,
);
let viewportHeight = $state(
  typeof window === "undefined" ? 768 : window.innerHeight,
);

const modal = $derived(variant === "modal");
const last = $derived(index === count - 1);
const centered = $derived(
  ("introducedIn" in step && step.id === "finish") || (last && !targetRect),
);
const placement = $derived(
  calloutPlacement({
    target: targetRect,
    viewportWidth,
    viewportHeight,
    calloutWidth,
    calloutHeight,
    compact,
    centered,
  }),
);

function findVisibleTarget(): HTMLElement | undefined {
  if (!step.targetId) return undefined;
  return [
    ...document.querySelectorAll<HTMLElement>(
      `[data-tour-id="${step.targetId}"]`,
    ),
  ].find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function measure(): void {
  viewportWidth = window.innerWidth;
  viewportHeight = window.innerHeight;
  const target = findVisibleTarget();
  if (!target) targetRect = undefined;
  else {
    const rect = target.getBoundingClientRect();
    const padding = 6;
    const left = Math.max(0, rect.left - padding);
    const top = Math.max(0, rect.top - padding);
    const right = Math.min(window.innerWidth, rect.right + padding);
    const bottom = Math.min(window.innerHeight, rect.bottom + padding);
    targetRect = {
      top,
      right,
      bottom,
      left,
      width: right - left,
      height: bottom - top,
    };
  }
  if (calloutElement) {
    const rect = calloutElement.getBoundingClientRect();
    calloutWidth = rect.width;
    calloutHeight = rect.height;
  }
}

$effect(() => {
  const targetId = step.targetId;
  const shouldFocus = modal;
  void tick().then(() => {
    measure();
    if (shouldFocus) calloutElement?.focus({ preventScroll: true });
  });
  const target = targetId ? findVisibleTarget() : undefined;
  const observer = new ResizeObserver(measure);
  const mutationObserver = new MutationObserver(measure);
  if (target) observer.observe(target);
  else if (targetId) {
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
  if (calloutElement) observer.observe(calloutElement);
  return () => {
    observer.disconnect();
    mutationObserver.disconnect();
  };
});

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (!modal || event.key !== "Tab" || !calloutElement) return;
  const controls = [
    ...calloutElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ];
  if (controls.length === 0) return;
  const current = controls.indexOf(document.activeElement as HTMLElement);
  if (event.shiftKey && current <= 0) {
    event.preventDefault();
    controls.at(-1)?.focus();
  } else if (!event.shiftKey && current === controls.length - 1) {
    event.preventDefault();
    controls[0]?.focus();
  }
}
</script>

<svelte:window
  onresize={measure}
  onscroll={measure}
  onkeydown={handleKeydown}
/>

<div
  class={`fixed inset-0 z-100 ${modal ? "" : "pointer-events-none"}`}
  role="presentation"
>
  {#if targetRect}
    <div
      class={`fixed left-0 right-0 top-0 ${modal ? "bg-background/60" : "bg-background/30"}`}
      style:height={`${targetRect.top}px`}
    ></div>
    <div
      class={`fixed bottom-0 left-0 right-0 ${modal ? "bg-background/60" : "bg-background/30"}`}
      style:top={`${targetRect.bottom}px`}
    ></div>
    <div
      class={`fixed left-0 ${modal ? "bg-background/60" : "bg-background/30"}`}
      style:top={`${targetRect.top}px`}
      style:width={`${targetRect.left}px`}
      style:height={`${targetRect.height}px`}
    ></div>
    <div
      class={`fixed right-0 ${modal ? "bg-background/60" : "bg-background/30"}`}
      style:top={`${targetRect.top}px`}
      style:left={`${targetRect.right}px`}
      style:height={`${targetRect.height}px`}
    ></div>
    <div
      class="fixed rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background/80"
      style:top={`${targetRect.top}px`}
      style:left={`${targetRect.left}px`}
      style:width={`${targetRect.width}px`}
      style:height={`${targetRect.height}px`}
      aria-hidden="true"
    ></div>
  {:else}
    <div
      class={`fixed inset-0 ${modal ? "bg-background/60" : "bg-background/30"}`}
    ></div>
  {/if}

  <div
    bind:this={calloutElement}
    class={`fixed grid max-w-[calc(100vw-1.5rem)] gap-4 rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-xl outline-none ${modal ? "w-96" : "pointer-events-auto w-80"}`}
    style:top={`${placement.top}px`}
    style:left={`${placement.left}px`}
    role="dialog"
    aria-modal={modal ? "true" : "false"}
    aria-labelledby="guided-tour-title"
    aria-describedby="guided-tour-description"
    tabindex={modal ? -1 : undefined}
  >
    <div class="grid gap-2">
      <div
        class="flex items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <span>{modal ? "Workbench tour" : "Guide"}</span>
        <span>Step {index + 1} of {count}</span>
      </div>
      <Progress
        value={index + 1}
        max={count}
        aria-label={`${modal ? "Workbench tour" : "Guide"} progress`}
      />
    </div>

    <div class="grid gap-2" aria-live="polite">
      <h2
        id="guided-tour-title"
        class="text-base font-semibold text-foreground"
      >
        {step.title}
      </h2>
      <p
        id="guided-tour-description"
        class="text-sm leading-relaxed text-muted-foreground"
      >
        {step.description}
      </p>
      {#if !targetRect && step.fallback}
        <p class="rounded-md bg-muted p-3 text-xs text-muted-foreground">
          {step.fallback}
        </p>
      {:else if preparing}
        <p class="text-xs text-muted-foreground">Opening this feature…</p>
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <Button variant="ghost" size="sm" onclick={onClose}
        >{modal ? "Not now" : "Close guide"}</Button
      >
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={index === 0 || preparing}
          onclick={onBack}
        >
          <ArrowLeft class="size-3.5" aria-hidden="true" />
          Back
        </Button>
        {#if last}
          <Button size="sm" disabled={preparing} onclick={onComplete}>
            <Check class="size-3.5" aria-hidden="true" />
            {modal ? "Finish" : "Finish guide"}
          </Button>
        {:else}
          <Button size="sm" disabled={preparing} onclick={onNext}>
            Next
            <ArrowRight class="size-3.5" aria-hidden="true" />
          </Button>
        {/if}
      </div>
    </div>
  </div>
</div>
