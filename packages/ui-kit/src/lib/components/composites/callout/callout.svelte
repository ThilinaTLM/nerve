<script lang="ts">
import type { Component, Snippet } from "svelte";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { cn } from "@nervekit/ui-kit/utils";

let {
  tone = "neutral",
  layout = "block",
  icon: Icon,
  title,
  text,
  class: className,
  actions,
  children,
}: {
  tone?: StatusTone;
  layout?: "block" | "strip";
  icon?: Component;
  title?: string;
  text?: string;
  class?: string;
  actions?: Snippet;
  children?: Snippet;
} = $props();

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-border bg-muted",
  brand: "border-primary-strong bg-primary-subtle",
  info: "border-info-strong bg-info-subtle",
  success: "border-success-strong bg-success-subtle",
  warning: "border-warning-strong bg-warning-subtle",
  destructive: "border-destructive-strong bg-destructive-subtle",
};
const iconClasses: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  brand: "text-primary",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};
const layoutClasses = {
  block: "rounded-md border px-2.5 py-2",
  strip: "border-b px-2 py-1.5",
};
</script>

<div
  class={cn(
    "flex min-w-0 items-start gap-2 text-ui text-foreground",
    toneClasses[tone],
    layoutClasses[layout],
    className,
  )}
  role={tone === "destructive" ? "alert" : "status"}
>
  {#if Icon}
    <Icon
      class={cn("size-3.5 shrink-0 mt-0.5", iconClasses[tone])}
      aria-hidden="true"
    />
  {/if}
  <div class="min-w-0 flex-1">
    {#if title}<p class="font-medium">{title}</p>{/if}
    {#if text}<p>{text}</p>{/if}
    {#if children}{@render children()}{/if}
  </div>
  {#if actions}
    <div
      class={cn(
        "flex shrink-0 items-center",
        layout === "strip" ? "gap-0.5" : "gap-1.5",
      )}
    >
      {@render actions()}
    </div>
  {/if}
</div>
