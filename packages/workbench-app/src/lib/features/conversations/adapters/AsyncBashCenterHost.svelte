<script lang="ts">
import { untrack } from "svelte";
import type { AsyncBash } from "@nervekit/contracts/core";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { asyncBashDuration } from "../views/async-bash-duration";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import AsyncBashOutputPane from "../views/AsyncBashOutputPane.svelte";
import {
  AsyncBashLogSession,
  type LogStream,
} from "../state/async-bash-log-window";
import { asyncBashTabs } from "../state/async-bash-tabs.svelte";

const tab = $derived(
  workspaceState.activeCenterTab?.kind === "async-bash"
    ? workspaceState.activeCenterTab
    : undefined,
);
let bash = $state<AsyncBash>();
let streams = $state<LogStream[]>([]);
let error = $state<string>();
let session = $state<AsyncBashLogSession>();
let stopping = $state(false);
let detached = $state(false);
let now = $state(Date.now());
const elapsed = $derived(asyncBashDuration(bash, now));
// Each selected-tab lifetime already starts at the tail; consume older signals
// without an extra request when a previously inactive tab is selected.
let handledRefreshVersion = 0;

$effect(() => {
  const selected = tab;
  const progressiveActive = workbenchStartupState.progressiveActive;
  const initialBash = untrack(() =>
    selected ? asyncBashTabs.commands[selected.id] : undefined,
  );
  bash = initialBash;
  streams = [];
  error = undefined;
  stopping = false;
  detached = false;
  if (!selected || !progressiveActive) return;
  handledRefreshVersion = untrack(
    () => asyncBashTabs.refreshVersions[selected.id] ?? 0,
  );
  const logs = new AsyncBashLogSession(
    selected.conversationId,
    selected.id,
    (params) => requestConversation("asyncBash.logs", params),
    (state, failure) => {
      bash = state.bash ?? bash;
      streams = state.streams;
      error = failure;
      detached = !state.following;
      now = Date.now();
      if (state.bash) asyncBashTabs.commands[selected.id] = state.bash;
    },
    1000,
    initialBash,
  );
  session = logs;
  logs.start();
  return () => {
    logs.stop();
    session = undefined;
  };
});
$effect(() => {
  const selected = tab;
  const logs = session;
  if (!selected || !workbenchStartupState.progressiveActive || !logs) return;
  // Read only this run's signal; requests for inactive tabs never trigger I/O.
  const version = asyncBashTabs.refreshVersions[selected.id] ?? 0;
  if (version === handledRefreshVersion) return;
  handledRefreshVersion = version;
  untrack(() => void logs.load("tail"));
});

async function stop() {
  const selected = tab;
  const logs = session;
  if (!selected || !logs || stopping) return;
  stopping = true;
  try {
    await requestConversation("asyncBash.cancel", { bashId: selected.id });
    if (session === logs) await logs.load("append");
  } catch (caught) {
    if (session === logs)
      error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    if (session === logs) stopping = false;
  }
}
</script>

{#if tab}
  {#key tab.id}
    <AsyncBashOutputPane
      bashId={tab.id}
      {bash}
      command={tab.command}
      {streams}
      {error}
      {elapsed}
      {detached}
      {stopping}
      onLoadEarlier={() => session?.load("earlier") ?? Promise.resolve()}
      onJumpToLatest={() => session?.load("tail") ?? Promise.resolve()}
      onStop={() => void stop()}
    />
  {/key}
{/if}
