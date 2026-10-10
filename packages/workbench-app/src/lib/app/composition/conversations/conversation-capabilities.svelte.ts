import type { ConversationUiCapabilities } from "$lib/presentation/context.svelte";
import TranscriptionActivity from "$lib/features/conversations/audio/TranscriptionActivity.svelte";
import { voiceInputSession } from "$lib/features/conversations/audio/voice-input-session.svelte";
import {
  appendTranscriptText,
  voiceInputTargetKey,
} from "$lib/features/conversations/audio/voice-input-target";
import {
  getShortcutAriaLabel,
  getShortcutLabel,
} from "$lib/application/commands/command-registry";
import {
  AudioInputAuthRequiredDialog,
  chatGptAudioAuth,
} from "$lib/features/audio";
import { watchSubagentTranscript } from "$lib/features/conversations/adapters/core-subagent.adapter.svelte";
import {
  getToolCallDetails,
  readToolCallResult,
} from "$lib/features/conversations/adapters/core-tool-details.adapter";
import {
  confluenceSiteUrl,
  jiraSiteUrl,
} from "$lib/features/conversations/state/atlassian-site-urls.svelte";
import { uploadClipboardImage } from "$lib/features/filesystem/api/filesystem.api";
import { resolveDroppedPaths } from "$lib/features/conversations/adapters/dropped-paths";
import { getDesktopBridge } from "$lib/platform/desktop/desktop-bridge.svelte";
import { conversationCatalog } from "$lib/features/conversations/state/conversation-catalog.svelte";
import { selection } from "$lib/application/workspace/selection.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { completeFiles } from "$lib/application/workspace/workspace-actions.svelte";

/**
 * Build the workbench capability object consumed by the shared conversation
 * transcript/tool-call components (full tool-call detail fetching + voice
 * input). Kept in web because it wires app-only services.
 */
export function workbenchConversationUiCapabilities(): ConversationUiCapabilities {
  return {
    canCompactPlanBeforeImplementation: false,
    fetchToolCall: (toolCallId) => getToolCallDetails(toolCallId),
    readToolCallResult: (toolCallId, byteOffset, byteLimit) =>
      readToolCallResult(toolCallId, byteOffset, byteLimit),
    watchSubagentTranscript,
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
    askReply: {
      pasteImage: uploadClipboardImage,
      dropFiles: async (files) => {
        const bridge = getDesktopBridge();
        const project = workspaceState.projects.find(
          (item) => item.id === selection.projectId,
        );
        if (!bridge?.files || !project) {
          throw new Error("Native file paths are unavailable in this window.");
        }
        return resolveDroppedPaths(
          files,
          project.directory,
          bridge.files.getPathForFile,
        );
      },
      slashCompletions: () => conversationCatalog.slashCompletions,
      fileCompletions: completeFiles,
    },
  };
}
