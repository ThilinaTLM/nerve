import type { ConversationUiCapabilities } from "@nervekit/conversation-ui/context";
import TranscriptionActivity from "$lib/core/audio/TranscriptionActivity.svelte";
import { voiceInputSession } from "$lib/core/audio/voice-input-session.svelte";
import {
  appendTranscriptText,
  voiceInputTargetKey,
} from "$lib/core/audio/voice-input-target";
import {
  getShortcutAriaLabel,
  getShortcutLabel,
} from "$lib/core/shortcuts/registry";
import {
  AudioInputAuthRequiredDialog,
  chatGptAudioAuth,
} from "$lib/features/audio";
import { getToolCall } from "$lib/features/tools/api/tools.api";

/**
 * Build the workbench capability object consumed by the shared conversation-ui
 * transcript/tool-call components (full tool-call detail fetching + voice
 * input). Kept in web because it wires app-only services.
 */
export function workbenchConversationUiCapabilities(): ConversationUiCapabilities {
  return {
    fetchToolCall: (toolCallId) => getToolCall(toolCallId),
    voice: {
      session: voiceInputSession,
      targetKey: voiceInputTargetKey,
      appendTranscriptText,
      chatGptConfigured: () => chatGptAudioAuth.configured,
      micShortcutLabel: getShortcutLabel("composer.toggleMic"),
      micShortcutAria: getShortcutAriaLabel("composer.toggleMic"),
      TranscriptionActivity,
      AudioAuthDialog: AudioInputAuthRequiredDialog,
    },
  };
}
