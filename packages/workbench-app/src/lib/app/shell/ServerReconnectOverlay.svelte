<script lang="ts">
import { describeLifecycle } from "$lib/application/startup/server-lifecycle";
import { serverLifecycleState } from "$lib/application/startup/server-lifecycle.svelte";
import ServerLifecycleStatus from "./ServerLifecycleStatus.svelte";

const lifecycle = $derived(serverLifecycleState.lifecycle);
const view = $derived(
  lifecycle && lifecycle.state !== "ready"
    ? describeLifecycle(lifecycle)
    : { status: "Reconnecting to Nerve…" },
);
</script>

{#if serverLifecycleState.reconnecting && serverLifecycleState.phase === "ready"}
  <div
    class="fixed inset-0 z-[1000] grid place-items-center bg-scrim backdrop-blur-sm"
  >
    <div
      class="w-72 max-w-[calc(100vw-2rem)] rounded-lg border bg-card p-4 text-card-foreground shadow-overlay"
    >
      <ServerLifecycleStatus {view} />
    </div>
  </div>
{/if}
