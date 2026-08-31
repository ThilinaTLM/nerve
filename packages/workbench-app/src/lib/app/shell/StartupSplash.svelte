<script lang="ts">
import NerveBadge from "$lib/presentation/brand/NerveBadge.svelte";

let { status = "Opening Nerve" }: { status?: string } = $props();
</script>

<main
  class="fixed inset-0 grid place-items-center bg-background text-foreground"
  aria-busy="true"
  aria-label="Starting Nerve"
>
  <!-- Startup chrome stays at native size while the workbench honors user zoom. -->
  <div
    class="grid w-full max-w-lg justify-items-center p-6 text-center"
    style="transform: scale(var(--nerve-inverse-zoom-scale, 1)); transform-origin: center;"
  >
    <NerveBadge class="startup-breathe size-12" />
    <div class="mt-6 w-full max-w-sm">
      <p
        class="mb-2 truncate text-sm leading-relaxed text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {status}
      </p>
      <div
        class="mx-auto h-1 w-full max-w-64 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label="Starting Nerve"
      >
        <span class="block h-full w-full rounded-full bg-primary"></span>
      </div>
    </div>
  </div>
</main>
