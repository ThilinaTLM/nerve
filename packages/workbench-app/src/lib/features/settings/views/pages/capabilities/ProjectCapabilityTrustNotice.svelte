<!--
  The project's `agent.json` on a layered page: unavailable (repair), or not
  trusted (decided here, inline). General also shows the trusted file, with
  Revoke; the other pages it affects only show the notice while it is not.
-->
<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import type {
  AgentScope,
  GetAgentConfigurationResult,
} from "@nervekit/contracts/agent-configuration";
import ProjectCapabilityTrustAction from "./ProjectCapabilityTrustAction.svelte";
import UntrustedProjectCallout from "./UntrustedProjectCallout.svelte";
import { setProjectAgentTrust } from "./project-agent-trust";
let {
  document,
  scope,
  onReload,
  showTrusted = false,
}: {
  document?: GetAgentConfigurationResult;
  scope?: AgentScope;
  onReload: () => void | Promise<void>;
  /** Also show the trusted file, with Revoke (General only). */
  showTrusted?: boolean;
} = $props();
let busy = $state(false);
let error = $state<string>();
const decision = $derived(
  document?.status === "available" &&
    document.source.digest !== "missing" &&
    document.trustState
    ? document.trustState
    : undefined,
);
async function decide(trusted: boolean) {
  if (busy) return;
  busy = true;
  error = undefined;
  try {
    await setProjectAgentTrust(document, trusted);
    await onReload();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy = false;
  }
}
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
{:else if decision}
  <UntrustedProjectCallout
    state={decision}
    {busy}
    {error}
    {showTrusted}
    onDecline={() => void decide(false)}
    onRevoke={() => void decide(false)}
  >
    {#snippet review()}<ProjectCapabilityTrustAction
        {document}
        {scope}
        {onReload}
        variant="outline"
        label="Review and trust"
      />{/snippet}
  </UntrustedProjectCallout>
{/if}
