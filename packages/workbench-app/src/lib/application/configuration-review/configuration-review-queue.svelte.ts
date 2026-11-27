import {
  configurationDecidedEventSchema,
  type ConfigurationReviewTarget,
} from "@nervekit/contracts/configuration";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { loadSettingsSkills } from "$lib/application/settings/settings-actions.svelte";
import { configurationAttention } from "$lib/application/configuration-attention/configuration-attention-state.svelte";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import {
  ConfigurationReviewQueue,
  emptyReviewQueueFields,
  type ConfigurationDecisionListener,
  type ConfigurationReviewApi,
} from "./review-queue";

export const protocolReviewApi: ConfigurationReviewApi = {
  review: (target) => requestConversation("configuration.review", target),
  decide: (decision) => requestConversation("configuration.decide", decision),
};

/**
 * The app's one review queue. `ConfigurationReviewHost` renders the dialog
 * from it; any surface opens it with `openConfigurationReview`.
 */
// The queue writes these fields; reading them through it is reactive.
const fields = $state(emptyReviewQueueFields());
export const configurationReviewQueue = new ConfigurationReviewQueue(
  fields,
  protocolReviewApi,
  // The bell, the nav counts and the welcome line follow the decision.
  () => configurationAttention.refresh(),
);

// Decisions made in another window or on another device refresh this one too.
onEvent("configuration.decided", (event) => {
  const parsed = configurationDecidedEventSchema.safeParse(event.data);
  if (parsed.success) configurationReviewQueue.received(parsed.data);
});

// The skill list (Settings, composer) shows each skill's decision.
configurationReviewQueue.onDecision((decided) => {
  if (decided.target.kind === "skill") void loadSettingsSkills();
});

/**
 * Opens the shared review dialog on `targets`, starting at `startIndex`. With
 * several targets the dialog steps through them ("2 of 4"); Not now and each
 * decision move on, and it closes after the last.
 */
export function openConfigurationReview(
  targets: ConfigurationReviewTarget[],
  startIndex = 0,
): void {
  configurationReviewQueue.start(targets, startIndex);
}

/** Subscribes to decisions made in the dialog or on a page; returns the unsubscribe. */
export function onConfigurationDecision(
  listener: ConfigurationDecisionListener,
): () => void {
  return configurationReviewQueue.onDecision(listener);
}
