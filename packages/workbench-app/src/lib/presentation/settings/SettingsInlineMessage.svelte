<script lang="ts">
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  tone?: StatusTone;
  text?: string;
  class?: string;
  actions?: Snippet;
  children?: Snippet;
};

let {
  tone = "info",
  text,
  class: className,
  actions,
  children,
}: Props = $props();

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-border bg-muted text-foreground",
  brand: "border-primary-strong bg-primary-subtle text-foreground",
  info: "border-info-strong bg-info-subtle text-foreground",
  success: "border-success-strong bg-success-subtle text-foreground",
  warning: "border-warning-strong bg-warning-subtle text-foreground",
  destructive:
    "border-destructive-strong bg-destructive-subtle text-foreground",
};
</script>

<div
  class={cn(
    "flex items-center justify-between gap-3 rounded-sm border px-2.5 py-1.5 text-ui",
    toneClasses[tone],
    className,
  )}
  role={tone === "destructive" ? "alert" : undefined}
>
  <div class="min-w-0">
    {#if text}
      <p class="text-ui">{text}</p>
    {/if}
    {#if children}
      {@render children()}
    {/if}
  </div>
  {#if actions}
    <div class="flex flex-none items-center gap-1.5">
      {@render actions()}
    </div>
  {/if}
</div>
