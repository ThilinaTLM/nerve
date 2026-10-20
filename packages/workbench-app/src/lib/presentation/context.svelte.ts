import {
  createInMemoryAskUserDraftStore,
  type AskUserDraftStore,
} from "./tools/tool-call/ask-user-state";
import type {
  ComposerCompletionAction,
  ComposerReferenceSource,
} from "$lib/presentation/composer/composer-editor-completions";

import type { SubagentRef } from "$lib/presentation/tools/views/subagent-live";
import type {
  ToolCallDetails,
  ToolCallResultChunk,
} from "$lib/presentation/view-models/conversation";
import type { Component } from "svelte";
import { getContext, setContext } from "svelte";

/**
 * Host-provided capabilities that let the shared transcript/tool-call
 * components reach app-specific integrations (full tool-call detail fetching,
 * voice input) without depending on any single app's state. Integrations are
 * optional; without a host, answer drafts use an isolated in-memory store.
 */

// The shared ask-user card is the only consumer and always targets an
// "ask-user" input; narrowing the kind keeps host session types (whose method
// params accept a wider target union) assignable to `VoiceInputSessionLike`.
export type VoiceInputTargetRef = { kind: "ask-user"; id: string };

export interface VoiceInputSessionLike {
  recording: boolean;
  transcribing: boolean;
  pending: boolean;
  elapsedMs: number;
  maxDurationMs: number;
  retryAttempt: number;
  maxRetries: number;
  isSupported(): boolean;
  isTargetActive(target: VoiceInputTargetRef): boolean;
  isBusyForOtherTarget(target: VoiceInputTargetRef): boolean;
  registerTargetHandlers(
    target: VoiceInputTargetRef,
    handlers: {
      appendTranscript: (transcript: string) => void;
      onError: (message: string) => void;
    },
  ): () => void;
  /** Stops the recording for `target` and transcribes it; true when text arrived. */
  stop(target: VoiceInputTargetRef): Promise<boolean>;
  toggle(target: VoiceInputTargetRef): void | Promise<void>;
  cancel(target: VoiceInputTargetRef): void | Promise<void>;
  cancelIfTarget(target: VoiceInputTargetRef): void | Promise<void>;
}

export interface VoiceInputCapability {
  session: VoiceInputSessionLike;
  targetKey(target: VoiceInputTargetRef): string;
  appendTranscriptText(current: string, transcript: string): string;
  chatGptConfigured(): boolean;
  micShortcutLabel?: string;
  micShortcutAria?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Host-provided Svelte component.
  AudioAuthDialog: Component<any>;
}

export interface AtlassianLinkCapability {
  /** Reactive getter; returns undefined until settings are known. */
  jiraSiteUrl: () => string | undefined;
  /** Reactive getter; returns undefined until settings are known. */
  confluenceSiteUrl: () => string | undefined;
}

export interface SubagentsCapability {
  /** Reactive getter: sub-agents, newest parent prompt first (then creation time and name). */
  list: () => readonly SubagentRef[];
  /** Shows a sub-agent in the main view. */
  open: (conversationId: string) => void;
}

/**
 * Composer-grade reply surface for the ask-user card: clipboard image paste,
 * dropped-file path resolution, and the same unified completion system the
 * prompt composer uses. Every member is optional; the reply input degrades
 * to a plain editor (plus voice) when a host does not provide them.
 */
export interface AskReplyComposerCapability {
  /** Upload a pasted clipboard image; resolves to the text to insert. */
  pasteImage?: (file: File) => Promise<string>;
  /** Resolve dropped native files to project-relative path mentions. */
  dropFiles?: (files: readonly File[]) => Promise<readonly string[]>;
  /** Unified completion source scoped to the conversation that owns the card. */
  completionSource?: (scope: {
    projectId: string;
    conversationId: string;
  }) => ComposerReferenceSource;
  /** Runs a completion row/source action (open settings, panels, …). */
  onCompletionAction?: (action: ComposerCompletionAction) => void;
  readClipboardText?: () => Promise<string>;
  writeClipboardText?: (text: string) => Promise<void>;
  onClipboardError?: (action: "copy" | "cut" | "paste") => void;
}

export interface ConversationUiCapabilities {
  canCompactPlanBeforeImplementation?: boolean;
  /** Fetch canonical bounded details without loading the complete result. */
  fetchToolCall?: (toolCallId: string) => Promise<ToolCallDetails>;
  /** Read one bounded UTF-8 chunk of the complete result. */
  readToolCallResult?: (
    toolCallId: string,
    byteOffset: number,
    byteLimit?: number,
  ) => Promise<ToolCallResultChunk>;
  /** Live sub-agent state and navigation for the sub-agent tool cards. */
  subagents?: SubagentsCapability;
  /** Voice input integration for the ask-user card. */
  voice?: VoiceInputCapability;
  /** Composer-grade reply input (paste image, completions, file drop) for the ask-user card. */
  askReply?: AskReplyComposerCapability;
  /** Reactive answer drafts shared across card lifetimes. */
  askUserDrafts: AskUserDraftStore;
  /**
   * Resolve a workspace image file (absolute path) to a displayable `data:`
   * URL. Resolves `undefined` when the file is missing, not an image, or too
   * large; callers then keep their placeholder.
   */
  imageSource?: (path: string) => Promise<string | undefined>;
  /** Site URLs used to build external Jira/Confluence links. */
  atlassian?: AtlassianLinkCapability;
}

const KEY = Symbol.for("nerve.conversationUi.capabilities");

export function setConversationUiCapabilities(
  capabilities: ConversationUiCapabilities,
): ConversationUiCapabilities {
  return setContext(KEY, capabilities);
}

export function getConversationUiCapabilities(): ConversationUiCapabilities {
  return (
    getContext<ConversationUiCapabilities | undefined>(KEY) ?? {
      askUserDrafts: createInMemoryAskUserDraftStore(),
    }
  );
}
