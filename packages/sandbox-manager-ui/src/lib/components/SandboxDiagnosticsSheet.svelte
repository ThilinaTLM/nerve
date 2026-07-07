<script lang="ts">
  import { FileClock, FileCode2, KeyRound, ListTree, Terminal } from "@lucide/svelte";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
  } from "@nervekit/ui/components/ui/sheet";
  import TabsBar from "@nervekit/ui/components/ui/tabs-bar";
  import SandboxBootTimeline from "../routes/SandboxBootTimeline.svelte";
  import SandboxEventsView from "../routes/SandboxEventsView.svelte";  import SandboxConfigView from "../routes/SandboxConfigView.svelte";

  import SandboxRuntimeView from "../routes/SandboxRuntimeView.svelte";
  import SandboxSecretsView from "../routes/SandboxSecretsView.svelte";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";

  let {
    open = $bindable(false),
    record,
  }: { open?: boolean; record: ManagedSandboxRecord } = $props();

  const store = useSandboxManagerStore();
  const detail = $derived(store.details[record.sandboxId]);

  let tab = $state("runtime");

  const tabs = [
    { value: "runtime", label: "Runtime/logs", icon: Terminal },
    { value: "config", label: "Config", icon: FileCode2 },
    { value: "secrets", label: "Secrets", icon: KeyRound },
    { value: "events", label: "Events", icon: FileClock },
    { value: "boot", label: "Boot log", icon: ListTree },
  ];

  $effect(() => {
    if (open && tab === "runtime" && detail && detail.logsText === "")
      void store.loadLogs(record.sandboxId);
  });
</script>

<Sheet bind:open>
  <SheetContent side="right" class="w-[min(92vw,44rem)] gap-0 p-0">
    <SheetHeader class="gap-3 border-b px-4 py-3">
      <div class="flex flex-col gap-0.5">
        <SheetTitle>Diagnostics</SheetTitle>
        <SheetDescription class="font-mono text-xs">
          {record.sandboxId}
        </SheetDescription>
      </div>
      <TabsBar {tabs} bind:value={tab} ariaLabel="Sandbox diagnostics" />
    </SheetHeader>
    <div class="min-h-0 flex-1 overflow-auto">
      {#if tab === "runtime"}
        <SandboxRuntimeView {record} />
      {:else if tab === "config"}
        <SandboxConfigView {record} />
      {:else if tab === "secrets"}
        <SandboxSecretsView {record} />
      {:else if tab === "events"}
        <SandboxEventsView {record} />
      {:else if tab === "boot"}
        <SandboxBootTimeline {record} />
      {/if}
    </div>
  </SheetContent>
</Sheet>
