import { conversationDraftStore } from "$lib/application/workspace/conversation-draft-store";
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
import {
  getToolCallDetails,
  readToolCallResult,
} from "$lib/features/conversations/adapters/core-tool-details.adapter";
import {
  confluenceSiteUrl,
  jiraSiteUrl,
} from "$lib/features/conversations/state/atlassian-site-urls.svelte";
import {
  getFileContent,
  uploadAttachment,
} from "$lib/features/filesystem/api/filesystem.api";
import { notify } from "$lib/application/notifications/notify.svelte";
import { resolveDroppedFiles } from "./dropped-files";
import { getDesktopBridge } from "$lib/platform/desktop/desktop-bridge.svelte";
import { readClipboardText } from "$lib/platform/clipboard/read-text";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { openSettingsPane } from "$lib/application/settings/settings-actions.svelte";
import { composerReferenceSource } from "./composer-reference-completions";
import { handleComposerCompletionAction } from "./composer-completion-actions";
import { selection } from "$lib/application/workspace/selection.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";

// Promise cache only; mutations do not drive rendered state.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const imageSources = new Map<string, Promise<string | undefined>>();

/** `data:` URL of a project image file, cached per project and path. */
function imageSource(path: string): Promise<string | undefined> {
  const projectId = selection.projectId;
  if (!projectId) return Promise.resolve(undefined);
  const key = `${projectId}\0${path}`;
  let pending = imageSources.get(key);
  if (!pending) {
    pending = getFileContent(projectId, path)
      .then((file) =>
        file.type === "image" && !file.truncated && file.dataBase64
          ? `data:${file.mimeType};base64,${file.dataBase64}`
          : undefined,
      )
      .catch(() => {
        imageSources.delete(key);
        return undefined;
      });
    imageSources.set(key, pending);
  }
  return pending;
}

/**
 * Build the workbench capability object consumed by the shared conversation
 * transcript/tool-call components (full tool-call detail fetching + voice
 * input). Kept in web because it wires app-only services.
 */
export function workbenchConversationUiCapabilities(
  subagents?: ConversationUiCapabilities["subagents"],
): ConversationUiCapabilities {
  return {
    canCompactPlanBeforeImplementation: false,
    askUserDrafts: conversationDraftStore(),
    fetchToolCall: (toolCallId) => getToolCallDetails(toolCallId),
    readToolCallResult: (toolCallId, byteOffset, byteLimit) =>
      readToolCallResult(toolCallId, byteOffset, byteLimit),
    subagents,
    imageSource,
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
      pasteImage: uploadAttachment,
      dropFiles: (files) => {
        const bridge = getDesktopBridge();
        const project = workspaceState.projects.find(
          (item) => item.id === selection.projectId,
        );
        return resolveDroppedFiles(files, {
          getPathForFile: bridge?.files?.getPathForFile,
          projectDir: project?.directory,
          upload: uploadAttachment,
          notifyError: (title, description) =>
            notify.error(title, { description }),
          notifyInfo: (message) => notify.message(message),
        });
      },
      completionSource: ({ projectId, conversationId }) =>
        composerReferenceSource(projectId, conversationId),
      onCompletionAction: (action) =>
        handleComposerCompletionAction(
          action,
          (page) => void openSettingsPane(page),
        ),
      readClipboardText,
      writeClipboardText,
      onClipboardError: (action) =>
        notify.error(`Could not ${action} using the clipboard`),
    },
  };
}
