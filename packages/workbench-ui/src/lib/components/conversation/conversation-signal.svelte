<script lang="ts">
import Activity from "@lucide/svelte/icons/activity";
import type { Snippet } from "svelte";

let {
  label = "Nerve is ready",
  title,
  message,
  footer,
}: {
  label?: string;
  title: string;
  message: string;
  footer?: Snippet;
} = $props();
</script>

<div class="flex h-full min-h-full items-center justify-center p-6 text-center">
  <div class="flex w-full max-w-xl flex-col items-center">
    <div
      class="relative mb-6 grid size-28 place-items-center"
      aria-hidden="true"
    >
      <div class="absolute inset-0 rounded-full border border-border/60"></div>
      <div
        class="absolute inset-3 rounded-full border border-dashed border-primary/30"
      ></div>
      <div class="absolute inset-6 rounded-full bg-primary/10 blur-lg"></div>
      <div class="signal-orbit absolute inset-1">
        <span
          class="absolute left-1/2 top-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-sm"
        ></span>
      </div>
      <div
        class="relative grid size-14 place-items-center rounded-xl border border-primary/30 bg-card shadow-sm"
      >
        <Activity class="size-7 text-primary" strokeWidth={1.8} />
      </div>
    </div>

    <p class="text-xs font-medium uppercase tracking-wider text-primary">
      {label}
    </p>
    <h2 class="mt-2 text-xl font-semibold tracking-tight text-foreground">
      {title}
    </h2>
    <p class="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
      {message}
    </p>

    {#if footer}
      <div class="mt-6 flex flex-col items-center">
        {@render footer()}
      </div>
    {/if}
  </div>
</div>

<style>
.signal-orbit {
  animation: spin 12s linear infinite;
}
</style>
