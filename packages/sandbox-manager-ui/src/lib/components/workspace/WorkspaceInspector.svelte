<script lang="ts">
  import { PanelRightClose } from "@lucide/svelte";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Button } from "@nervekit/ui/components/ui/button";
  import TabsBar from "@nervekit/ui/components/ui/tabs-bar";
  import SandboxBootProgress from "../SandboxBootProgress.svelte";
  import SandboxConfigView from "../../routes/SandboxConfigView.svelte";
  import SandboxEventsView from "../../routes/SandboxEventsView.svelte";
  import SandboxRuntimeView from "../../routes/SandboxRuntimeView.svelte";
  import SandboxSecretsView from "../../routes/SandboxSecretsView.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";

  let {
    record,
    onClose,
  }: { record: ManagedSandboxRecord; onClose: () => void } = $props();

  const store = useSandboxManagerStore();
  const detail = $derived(store.details[record.sandboxId]);

  let tab = $state("activity");
  const tabs = [
    { value: "activity", label: "Activity" },
    { value: "runtime", label: "Runtime" },
    { value: "config", label: "Config" },
    { value: "events", label: "Events" },
    { value: "secrets", label: "Secrets" },
  ];

  $effect(() => {
    if (tab === "runtime" && detail && detail.logsText === "")
      void store.loadLogs(record.sandboxId);
  });
</script>

<div class="flex h-full min-w-0 flex-col">
  <div class="flex flex-none items-center gap-2 border-b px-3 py-2">
    <div class="min-w-0 flex-1">
      <TabsBar {tabs} bind:value={tab} ariaLabel="Sandbox inspector" />
    </div>
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Close inspector"
      title="Close inspector"
      onclick={onClose}
    >
      <PanelRightClose class="size-4" />
    </Button>
  </div>
  <div class="min-h-0 flex-1 overflow-auto">
    {#if tab === "activity"}
      <SandboxBootProgress {record} variant="rail" expanded />
    {:else if tab === "runtime"}
      <SandboxRuntimeView {record} />
    {:else if tab === "config"}
      <SandboxConfigView {record} />
    {:else if tab === "events"}
      <SandboxEventsView {record} />
    {:else if tab === "secrets"}
      <SandboxSecretsView {record} />
    {/if}
  </div>
</div>
