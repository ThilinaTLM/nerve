<!--
  One line under an integration's accounts: which tools use them now, which
  could, and that tools only use an account once configured in Tools.
-->
<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import type { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { openSettingsPane } from "$lib/application/settings";
import type { AccountKind, AccountOption } from "../tools/tool-settings";
import { accountUsage } from "./account-usage";

type Props = {
  kind: AccountKind;
  accounts: AccountOption[];
  editor: ScopedAgentState;
};
let { kind, accounts, editor }: Props = $props();

const usage = $derived(
  accountUsage(
    kind,
    editor.resolution?.settings.tools ?? {},
    accounts.map((a) => a.id),
  ),
);
const inUse = $derived(
  usage.inUse
    .map(({ label, accountId }) => {
      const name = accounts.find((a) => a.id === accountId)?.name;
      return accounts.length > 1 && name ? `${label} (${name})` : label;
    })
    .join(", "),
);
</script>

{#if accounts.length > 0 && editor.resolution}
  <p>
    {#if inUse}
      In use by {inUse}.
    {:else}
      Not used by any tool yet.
    {/if}
    {#if usage.available.length}
      {inUse ? "Also works with" : "Works with"}
      {usage.available.join(", ")}: turn the tool on and choose an account in
    {:else}
      Change accounts in
    {/if}
    <button
      type="button"
      class="inline-flex items-center gap-0.5 rounded-sm text-primary hover:bg-hover"
      onclick={() => void openSettingsPane("tools")}
      >Tools<ArrowRight class="size-3" aria-hidden="true" /></button
    >
  </p>
{/if}
{#if editor.error}
  <p class="text-destructive">{editor.error}</p>
{/if}
