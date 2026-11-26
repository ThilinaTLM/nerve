<!--
  An `agent.json` on a layered page: unavailable (repair), or waiting for
  review or declined (decided here: Trust opens the review dialog, Decline and
  Revoke decide on the bytes shown). The project's file locks its column; the
  user's file keeps its last trusted version in effect. General also shows a
  trusted project file, with Revoke; other pages only while it is not.
-->
<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import type {
  AgentScope,
  GetAgentConfigurationResult,
} from "@nervekit/contracts/agent-configuration";
import type { ConfigurationReviewTarget } from "@nervekit/contracts/configuration";
import {
  onConfigurationDecision,
  openConfigurationReview,
} from "$lib/application/configuration-review/configuration-review-queue.svelte";
import ConfigurationReviewCallout from "$lib/presentation/configuration-review/ConfigurationReviewCallout.svelte";
import ProjectCapabilityTrustAction from "./ProjectCapabilityTrustAction.svelte";
import { useItemReview } from "../review/item-review.svelte";
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
const decision = $derived(
  document?.status === "available" &&
    document.source.digest !== "missing" &&
    document.trustState
    ? document.trustState
    : undefined,
);
const fileScope = $derived(
  document?.status === "available" ? document.source.scope : scope,
);
const target = $derived<ConfigurationReviewTarget | undefined>(
  fileScope?.scope === "project"
    ? {
        kind: "agent-preferences",
        scope: "project",
        projectId: fileScope.projectId,
        id: "agent.json",
      }
    : fileScope?.scope === "user"
      ? { kind: "agent-preferences", scope: "user", id: "agent.json" }
      : undefined,
);
const user = $derived(fileScope?.scope === "user");
const review = useItemReview(() => (decision ? target : undefined));

// A decision in the review dialog changes the file's state: read it again.
$effect(() =>
  onConfigurationDecision((review) => {
    if (review.target.kind === "agent-preferences") void onReload();
  }),
);
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
  <ConfigurationReviewCallout
    state={decision}
    subject={user ? "Your agent settings file" : "This project's settings file"}
    effect={user
      ? "the last version you trusted stays in effect"
      : "the project uses your settings and its column is locked"}
    changedSinceDecision={review.current?.review?.changedSinceDecision}
    busy={review.current?.busy}
    error={review.current?.notice ?? review.current?.error}
    {showTrusted}
    onTrust={target ? () => openConfigurationReview([target]) : undefined}
    onDecline={() => void review.current?.decline()}
    onRevoke={() => void review.current?.decline()}
  />
{/if}
