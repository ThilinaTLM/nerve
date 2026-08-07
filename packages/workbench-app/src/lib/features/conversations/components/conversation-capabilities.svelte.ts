import type { ConversationUiCapabilities } from "$lib/presentation/context.svelte";
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
import { watchSubagentTranscript } from "$lib/features/agents/subagent-transcript-watcher";
import { getToolCall } from "$lib/features/tools/api/tools.api";
import {
  confluenceSiteUrl,
  jiraSiteUrl,
} from "$lib/features/conversations/state/atlassian-site-urls.svelte";
import { uploadClipboardImage } from "$lib/features/filesystem/api/filesystem.api";
import { resolveDroppedPaths } from "$lib/features/conversations/adapters/dropped-paths";
import { getDesktopBridge } from "$lib/features/desktop/state/desktop-bridge.svelte";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { completeFiles } from "$lib/features/workspace/state/workspace-actions.svelte";

/**
 * Build the workbench capability object consumed by the shared conversation
 * transcript/tool-call components (full tool-call detail fetching + voice
 * input). Kept in web because it wires app-only services.
 */
export function workbenchConversationUiCapabilities(): ConversationUiCapabilities {
  return {
    fetchToolCall: (toolCallId) => getToolCall(toolCallId),
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
          project.dir,
          bridge.files.getPathForFile,
        );
      },
      slashCompletions: () => conversationState.slashCompletions,
      fileCompletions: completeFiles,
    },
  };
}
