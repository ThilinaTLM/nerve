<script lang="ts">
  import {
    Activity,
    FileClock,
    KeyRound,
    ListTree,
    MessageSquare,
    Terminal,
  } from "@lucide/svelte";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import TabsBar from "$lib/components/ui/tabs-bar";
  import SandboxActionMenu from "../components/SandboxActionMenu.svelte";
  import SandboxStatusBadge from "../components/SandboxStatusBadge.svelte";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import SandboxBootTimeline from "./SandboxBootTimeline.svelte";
  import SandboxChatView from "./SandboxChatView.svelte";
  import SandboxEventsView from "./SandboxEventsView.svelte";
  import SandboxOverview from "./SandboxOverview.svelte";
  import SandboxRuntimeView from "./SandboxRuntimeView.svelte";
  import SandboxSecretsView from "./SandboxSecretsView.svelte";

  let { record }: { record: ManagedSandboxRecord } = $props();

  const store = useSandboxManagerStore();
  let tab = $state("overview");

  const tabs = [
    { value: "overview", label: "Overview", icon: Activity },
    { value: "chat", label: "Chat", icon: MessageSquare },
    { value: "boot", label: "Boot/setup", icon: ListTree },
    { value: "runtime", label: "Runtime/logs", icon: Terminal },
    { value: "secrets", label: "Secrets/config", icon: KeyRound },
    { value: "events", label: "Events", icon: FileClock },
  ];

  const detail = $derived(store.details[record.sandboxId]);

  $effect(() => {
    if (tab === "runtime" && detail && detail.logsText === "")
      void store.loadLogs(record.sandboxId);
  });
</script>

<div class="flex h-full flex-col">
  <header class="flex flex-none flex-wrap items-center gap-3 border-b px-4 py-2.5">
    <div class="flex min-w-0 flex-col">
      <span class="truncate text-sm font-semibold">
        {record.name ?? record.sandboxId}
      </span>
      <span class="truncate font-mono text-xs text-muted-foreground">
        {record.sandboxId}
      </span>
    </div>
    <SandboxStatusBadge {record} />
    <div class="ml-auto">
      <SandboxActionMenu {record} />
    </div>
  </header>

  <div class="flex-none border-b px-2">
    <TabsBar {tabs} bind:value={tab} ariaLabel="Sandbox detail sections" />
  </div>

  <div class="min-h-0 flex-1 overflow-hidden">
    {#if tab === "overview"}
      <SandboxOverview {record} />
    {:else if tab === "chat"}
      <SandboxChatView {record} />
    {:else if tab === "boot"}
      <SandboxBootTimeline {record} />
    {:else if tab === "runtime"}
      <SandboxRuntimeView {record} />
    {:else if tab === "secrets"}
      <SandboxSecretsView {record} />
    {:else if tab === "events"}
      <SandboxEventsView {record} />
    {/if}
  </div>
</div>
