<script lang="ts">
import type { Component } from "svelte";

type Props = {
  text: string;
  tone?: "success" | "info" | "default";
  icon?: Component;
};
let { text, tone = "default", icon }: Props = $props();

const toneClass: Record<NonNullable<Props["tone"]>, string> = {
  success: "text-success",
  info: "text-info",
  default: "text-muted-foreground",
};
const Icon = $derived(icon);
</script>

<div
  class="flex min-w-0 items-center gap-2 rounded-sm border bg-sidebar px-2.5 py-2"
>
  {#if Icon}
    <Icon size={14} strokeWidth={2} class={`shrink-0 ${toneClass[tone]}`} />
  {/if}
  <span
    class="min-w-0 break-words text-xs leading-normal text-sidebar-foreground"
    >{text}</span
  >
</div>
