<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import { Button } from "@nervekit/ui-kit/components/ui/button";
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
  projectName,
  onReview,
}: {
  document?: GetAgentConfigurationResult;
  scope?: AgentScope;
  onReload: () => void | Promise<void>;
  /** With `onReview`: the unified pages' warning, which opens the Trust page. */
  projectName?: string;
  onReview?: () => void;
} = $props();
let busy = $state(false);
let error = $state<string>();
async function trust() {
  if (busy) return;
  busy = true;
  error = undefined;
  try {
    await setProjectAgentTrust(document, true);
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
{:else if document?.trusted === false && projectName && onReview}
  <UntrustedProjectCallout {onReview} />
{:else if document?.trusted === false}
  <Callout
    layout="block"
    tone="warning"
    icon={ShieldCheck}
    title="Project agent settings are not trusted"
    text={error ??
      "This project's settings file isn't trusted, so conversations ignore it and use your user settings. Trust it to apply the overrides shown below."}
  >
    {#snippet actions()}<Button
        size="sm"
        variant="outline"
        disabled={busy}
        onclick={trust}>Trust file</Button
      >{/snippet}
  </Callout>
{/if}
