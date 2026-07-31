<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";
import type { SettingsTone } from "./types";

type Props = {
  tone?: SettingsTone;
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

const toneClasses: Record<SettingsTone, string> = {
  info: "border-info/40 bg-info/10 text-foreground",
  success: "border-success/40 bg-success/10 text-foreground",
  warning: "border-warning/40 bg-warning/10 text-foreground",
  error: "border-destructive/40 bg-destructive/10 text-foreground",
};
</script>

<div
  class={cn(
    "flex items-center justify-between gap-3 rounded-sm border px-2.5 py-1.5 text-xs",
    toneClasses[tone],
    className,
  )}
  role={tone === "error" ? "alert" : undefined}
>
  <div class="min-w-0">
    {#if text}
      <p class="text-xs">{text}</p>
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
