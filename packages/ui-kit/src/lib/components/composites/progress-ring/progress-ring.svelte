<script lang="ts">
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { cn } from "@nervekit/ui-kit/utils";

let {
  percent = 0,
  tone = "neutral",
  class: className,
}: {
  /** 0-100; clamped. */
  percent?: number | null;
  tone?: StatusTone;
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

.progress-ring[data-tone="accent"] {
  --progress-ring-color: var(--foreground);
}

.progress-ring[data-tone="info"] {
  --progress-ring-color: var(--info);
}

.progress-ring[data-tone="success"] {
  --progress-ring-color: var(--success);
}

.progress-ring[data-tone="warning"] {
  --progress-ring-color: var(--warning);
}

.progress-ring[data-tone="destructive"] {
  --progress-ring-color: var(--destructive);
}

.progress-ring-core {
  background: var(--card);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 4%, transparent);
}
</style>
