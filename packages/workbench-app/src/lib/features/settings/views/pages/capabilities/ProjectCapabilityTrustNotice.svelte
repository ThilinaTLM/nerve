<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import type {
  AgentScope,
  GetAgentConfigurationResult,
} from "@nervekit/contracts/agent-configuration";
import ProjectCapabilityTrustAction from "./ProjectCapabilityTrustAction.svelte";
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
  <Callout
    layout="block"
    tone="warning"
    text={`Configuration is unavailable: ${document.diagnostics.map((d) => d.code).join(", ")}. Review and preview a repair, then reload. Dismissal never repairs or grants trust.`}
  >
    {#snippet actions()}<ProjectCapabilityTrustAction
        {document}
        {scope}
        {onReload}
      />{/snippet}
  </Callout>
{/if}
