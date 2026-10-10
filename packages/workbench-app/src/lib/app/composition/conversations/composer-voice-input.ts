import {
  appendTranscriptText,
  type VoiceInputTarget,
} from "$lib/features/conversations/audio/voice-input-target";

type VoiceInputRegistration = {
  registerTargetHandlers(
    target: VoiceInputTarget,
    handlers: { appendTranscript: (text: string) => void },
  ): () => void;
};

export function bindComposerVoiceInput(
  session: VoiceInputRegistration,
  target: VoiceInputTarget,
  draft: {
    read: () => string;
    update: (text: string) => void;
    focus: () => void;
  },
): () => void {
  return session.registerTargetHandlers(target, {
    appendTranscript: (transcript) => {
      if (!transcript.trim()) return;
      draft.update(appendTranscriptText(draft.read(), transcript));
      draft.focus();
    },
  });
}
