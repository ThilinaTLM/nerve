<script lang="ts">
import { TimerReset } from "@lucide/svelte";
import { onDestroy } from "svelte";

let { exitAt }: { exitAt: string } = $props();

let now = $state(Date.now());
const timer = setInterval(() => {
  now = Date.now();
}, 1000);
onDestroy(() => clearInterval(timer));

const remainingMs = $derived(Math.max(0, Date.parse(exitAt) - now));
const seconds = $derived(Math.ceil(remainingMs / 1000));
</script>

<span class="inline-flex items-center gap-1 text-xs text-warning">
  <TimerReset class="size-3" />
  self-exit in {seconds}s
</span>
