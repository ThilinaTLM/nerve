import { notify } from "$lib/application/notifications/notify.svelte";
import { TranscriptionController } from "./transcription-controller.svelte";
import {
  VoiceInputSessionCore,
  type VoiceInputSessionState,
} from "./voice-input-session-core";
import type { VoiceInputTarget } from "./voice-input-target";

export type { VoiceInputTarget } from "./voice-input-target";

const state = $state<VoiceInputSessionState>({
  activeTarget: undefined,
  starting: false,
});

export const voiceInputSession = new VoiceInputSessionCore(state, {
  createController: (callbacks) => new TranscriptionController(callbacks),
  isSupported: () => TranscriptionController.isSupported(),
  notifyError: (message) =>
    notify.error("Voice input failed", { description: message }),
  notifyInfo: (message) => notify.message(message),
});

export function cancelVoiceInputTargets(
  targets: VoiceInputTarget[],
): Promise<void> {
  return voiceInputSession.cancelIfTargets(targets);
}
