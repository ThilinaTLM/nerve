<script lang="ts">
import type {
  AgentScope,
  GetAgentConfigurationResult,
} from "@nervekit/contracts/agent-configuration";
import ProjectCapabilityTrustAction from "./ProjectCapabilityTrustAction.svelte";
import { SettingsInlineMessage } from "$lib/presentation/settings";
let {
  document,
  scope,
  onReload,
}: {
  document?: GetAgentConfigurationResult;
  scope?: AgentScope;
  onReload: () => void | Promise<void>;
} = $props();
</script>
{#if document?.status === "unavailable"}
  <SettingsInlineMessage
    tone="warning"
    text={`Configuration is unavailable: ${document.diagnostics.map((d) => d.code).join(", ")}. Review and preview a repair, then reload. Dismissal never repairs or grants trust.`}
  >
    {#snippet actions()}<ProjectCapabilityTrustAction
        {document}
        {scope}
        {onReload}
      />{/snippet}
  </SettingsInlineMessage>
{/if}
