<script lang="ts" module>
export type ProgressRingTone =
  | "neutral"
  | "primary"
  | "good"
  | "warn"
  | "danger";
</script>

<script lang="ts">
import { cn } from "@nervekit/ui-kit/utils";

let {
  percent = 0,
  tone = "neutral",
  class: className,
}: {
  /** 0-100; clamped. */
  percent?: number | null;
  tone?: ProgressRingTone;
  class?: string;
} = $props();

const fill = $derived(Math.min(100, Math.max(0, percent ?? 0)));
</script>

<span
  class={cn(
    "progress-ring inline-grid size-3 flex-none place-items-center rounded-full",
    className,
  )}
  data-tone={tone}
  style={`--progress-ring-fill: ${fill}%;`}
  aria-hidden="true"
>
  <span class="progress-ring-core size-2 rounded-full"></span>
</span>

<style>
.progress-ring {
  --progress-ring-color: var(--muted-foreground);
  background: conic-gradient(
    var(--progress-ring-color) var(--progress-ring-fill),
    color-mix(in oklab, var(--border) 82%, transparent) 0
  );
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 7%, transparent)
    inset;
}

.progress-ring[data-tone="primary"] {
  --progress-ring-color: var(--primary);
}

.progress-ring[data-tone="good"] {
  --progress-ring-color: var(--success);
}

.progress-ring[data-tone="warn"] {
  --progress-ring-color: var(--warning);
}

.progress-ring[data-tone="danger"] {
  --progress-ring-color: var(--destructive);
}

.progress-ring-core {
  background: var(--card);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 4%, transparent);
}
</style>
