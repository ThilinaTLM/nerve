import type { ComposerDictation } from "$lib/presentation/composer/composer-dictation-bridge";
import {
  appendTranscriptText,
  type VoiceInputTarget,
} from "$lib/features/conversations/audio/voice-input-target";

type VoiceInputRegistration = {
  registerTargetHandlers(
    target: VoiceInputTarget,
    handlers: {
      appendTranscript: (text: string) => void;
      onError?: (message: string) => void;
    },
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
  dictation?: {
    chip: ComposerDictation;
    /** Reports a failure the chip cannot show (no live chip). */
    notifyError: (message: string) => void;
  },
): () => void {
  return session.registerTargetHandlers(target, {
    appendTranscript: (transcript) => {
      if (dictation?.chip.resolve(transcript)) {
        draft.focus();
        return;
      }
      if (!transcript.trim()) return;
      draft.update(appendTranscriptText(draft.read(), transcript));
      draft.focus();
    },
    onError: dictation
      ? (message) => {
          if (!dictation.chip.fail()) dictation.notifyError(message);
        }
      : undefined,
  });
}
