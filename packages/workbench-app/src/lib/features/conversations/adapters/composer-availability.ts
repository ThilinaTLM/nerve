export type ComposerAvailabilityInput = {
  interactive: boolean;
  hasProject: boolean;
  hasConversation: boolean;
  hasModels: boolean;
  blockedForReview: boolean;
  compacting: boolean;
  stopping: boolean;
  sending: boolean;
  commandMode: boolean;
  voiceSubmitPending: boolean;
};

export type ComposerAvailability = {
  hasTarget: boolean;
  canEdit: boolean;
  canPrompt: boolean;
  canSubmit: boolean;
};

export function deriveComposerAvailability(
  input: ComposerAvailabilityInput,
): ComposerAvailability {
  const hasTarget = input.hasProject && input.hasConversation;
  const canEdit = Boolean(
    input.interactive &&
    hasTarget &&
    !input.blockedForReview &&
    !input.compacting &&
    !input.stopping,
  );
  const canPrompt = canEdit && input.hasModels;
  return {
    hasTarget,
    canEdit,
    canPrompt,
    canSubmit: Boolean(
      canPrompt &&
      !input.voiceSubmitPending &&
      !(input.commandMode && input.sending),
    ),
  };
}
