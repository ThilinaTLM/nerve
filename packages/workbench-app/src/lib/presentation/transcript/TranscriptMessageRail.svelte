<script lang="ts">
import type { TranscriptMessageMark } from "./transcript-row-model";

/**
 * One tick per user message along the transcript's right edge, placed by row
 * position. Hover previews a message, click jumps to it. `step` moves to the
 * previous or next message relative to the viewport (Alt+↑/↓).
 */
let {
  marks,
  rowCount,
  viewport,
  onReveal,
}: {
  marks: TranscriptMessageMark[];
  rowCount: number;
  viewport: HTMLElement | null | undefined;
  onReveal: (index: number) => void;
} = $props();

type Range = { first: number; firstStart: number; last: number };
let range = $state<Range>({ first: 0, firstStart: 0, last: -1 });
let hovered = $state<TranscriptMessageMark>();

function measure(element: HTMLElement): Range {
  const bounds = element.getBoundingClientRect();
  let first = Infinity;
  let firstStart = Infinity;
  let last = -1;
  for (const row of element.querySelectorAll<HTMLElement>(
    ":scope > * > .virtual-scroller-row",
  )) {
    const index = Number(row.dataset.index);
    if (!Number.isFinite(index)) continue;
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= bounds.top + 4 || rect.top >= bounds.bottom - 4)
      continue;
    first = Math.min(first, index);
    last = Math.max(last, index);
    if (rect.top >= bounds.top - 4) firstStart = Math.min(firstStart, index);
  }
  if (first === Infinity) return { first: 0, firstStart: 0, last: -1 };
  return { first, firstStart: Math.min(firstStart, last + 1), last };
}

$effect(() => {
  const element = viewport;
  if (!element) return;
  let frame: number | undefined;
  const update = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      range = measure(element);
    });
  };
  update();
  element.addEventListener("scroll", update, { passive: true });
  const observer = new ResizeObserver(update);
  observer.observe(element);
  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    element.removeEventListener("scroll", update);
    observer.disconnect();
  };
});

/** Jump to the previous (-1) or next (1) message. Returns false at the ends. */
export function step(direction: -1 | 1): boolean {
  const current = viewport ? measure(viewport) : range;
  const target =
    direction < 0
      ? marks.findLast((mark) => mark.index < current.firstStart)
      : marks.find((mark) => mark.index > current.first);
  if (!target) return false;
  onReveal(target.index);
  return true;
}

const position = (index: number) =>
  rowCount <= 1 ? 0 : (index / (rowCount - 1)) * 100;
</script>

{#if marks.length > 1}
  <nav
    class="pointer-events-none absolute top-3 bottom-3 z-10 w-3"
    style:right="calc(var(--conversation-scrollbar-lane, 0px) + 2px)"
    aria-label="Your messages"
  >
    {#each marks as mark, ordinal (mark.key)}
      {@const inView = mark.index >= range.first && mark.index <= range.last}
      <button
        type="button"
        class="group pointer-events-auto absolute right-0 flex h-2 w-3 -translate-y-1/2 cursor-pointer items-center justify-end"
        style:top={`${position(mark.index)}%`}
        aria-label={`Message ${ordinal + 1} of ${marks.length}: ${mark.text.slice(0, 80)}`}
        onpointerenter={() => (hovered = mark)}
        onpointerleave={() => (hovered = undefined)}
        onfocus={() => (hovered = mark)}
        onblur={() => (hovered = undefined)}
        onclick={() => onReveal(mark.index)}
      >
        <span
          class={[
            "h-0.5 rounded-full transition-[width,background-color] group-hover:w-3 group-hover:bg-primary group-hover:opacity-100 group-focus-visible:w-3 group-focus-visible:bg-primary group-focus-visible:opacity-100",
            inView ? "w-3 bg-primary" : "w-2 bg-muted-foreground opacity-40",
          ]}
        ></span>
      </button>
    {/each}
    {#if hovered}
      <div
        class="absolute right-5 w-max max-w-72 -translate-y-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-ui text-popover-foreground shadow-overlay"
        style:top={`${position(hovered.index)}%`}
        role="tooltip"
      >
        <span class="line-clamp-3 whitespace-pre-wrap break-words"
          >{hovered.text}</span
        >
      </div>
    {/if}
  </nav>
{/if}
