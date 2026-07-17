import type { ConversationUiCapabilities } from "@nervekit/workbench-ui/context";
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
import {
  confluenceSiteUrl,
  ensureAtlassianSiteUrls,
  jiraSiteUrl,
} from "$lib/features/conversations/state/atlassian-site-urls.svelte";

/**
 * Build the workbench capability object consumed by the shared conversation
 * transcript/tool-call components (full tool-call detail fetching + voice
 * input). Kept in web because it wires app-only services.
 */
export function workbenchConversationUiCapabilities(): ConversationUiCapabilities {
  ensureAtlassianSiteUrls();
  return {
    fetchToolCall: (toolCallId) => getToolCall(toolCallId),
    atlassian: { jiraSiteUrl, confluenceSiteUrl },
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
