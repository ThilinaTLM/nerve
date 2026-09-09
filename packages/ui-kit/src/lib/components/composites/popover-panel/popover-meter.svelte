<script lang="ts">
import { cn } from "@nervekit/ui-kit/utils";
import type { StatusTone } from "@nervekit/ui-kit/display/status";

let {
  label,
  value,
  percent,
  tone = "accent",
  caption,
  class: className,
}: {
  label: string;
  /** Formatted headline value (e.g. "48%", "12k / 272k"). */
  value: string;
  /** Fill ratio 0–100. Omit while the measurement is unavailable. */
  percent?: number;
  tone?: Extract<StatusTone, "accent" | "success" | "warning" | "destructive">;
  /** Muted supporting line (e.g. "resets in 19m"). */
  caption?: string;
  class?: string;
} = $props();

const fillClass: Record<string, string> = {
  accent: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

const width = $derived(Math.min(100, Math.max(0, percent ?? 0)));
</script>

<div class={cn("grid gap-1 px-1.5 py-0.5", className)}>
  <div class="flex items-baseline justify-between gap-4">
    <span class="min-w-0 truncate text-muted-foreground">{label}</span>
    <span class="flex-none font-medium tabular-nums text-foreground"
      >{value}</span
    >
  </div>
  <div
    class="h-1 overflow-hidden rounded-full bg-foreground/12"
    role="progressbar"
    aria-label={label}
    aria-valuenow={percent}
    aria-valuemin={0}
    aria-valuemax={100}
  >
    <div
      class={cn("h-full rounded-full transition-[width]", fillClass[tone])}
      style={`width: ${width}%`}
    ></div>
  </div>
  {#if caption}
    <span class="text-muted-foreground">{caption}</span>
  {/if}
</div>
