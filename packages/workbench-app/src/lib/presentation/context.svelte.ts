import type { CompletionItem } from "@nervekit/contracts/completions";
import type { EventEnvelope } from "@nervekit/contracts/events";
import type { SubagentTranscriptSnapshot } from "@nervekit/contracts/agents";
import type {
  ToolCallDetails,
  ToolCallResultChunk,
} from "@nervekit/contracts/tools";
import type { Component } from "svelte";
import { getContext, setContext } from "svelte";

/**
 * Host-provided capabilities that let the shared transcript/tool-call
 * components reach app-specific integrations (full tool-call detail fetching,
 * voice input) without depending on any single app's state. Every capability is
 * optional; components degrade gracefully when a host does not provide one.
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
  TranscriptionActivity: Component<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Host-provided Svelte component.
  AudioAuthDialog: Component<any>;
}

export interface AtlassianLinkCapability {
  /** Reactive getter; returns undefined until settings are known. */
  jiraSiteUrl: () => string | undefined;
  /** Reactive getter; returns undefined until settings are known. */
  confluenceSiteUrl: () => string | undefined;
}

export interface SubagentTranscriptObserver {
  snapshot: (snapshot: SubagentTranscriptSnapshot) => void;
  /** Return false when canonical offset validation requests reconciliation. */
  event: (event: EventEnvelope<Record<string, unknown>>) => boolean | void;
  error: (message: string) => void;
}

/**
 * Composer-grade reply surface for the ask-user card: clipboard image paste,
 * dropped-file path resolution, and the same slash/file auto-completions the
 * prompt composer offers. Every member is optional; the reply input degrades
 * to a plain editor (plus voice) when a host does not provide them.
 */
export interface AskReplyComposerCapability {
  /** Upload a pasted clipboard image; resolves to the text to insert. */
  pasteImage?: (file: File) => Promise<string>;
  /** Resolve dropped native files to project-relative path mentions. */
  dropFiles?: (files: readonly File[]) => Promise<readonly string[]>;
  /** Reactive getter for slash-command completion items. */
  slashCompletions?: () => readonly CompletionItem[];
  /** Project file reference completions for "@" mentions. */
  fileCompletions?: (query: string) => Promise<CompletionItem[]>;
}

export interface ConversationUiCapabilities {
  /** Fetch canonical bounded details without loading the complete result. */
  fetchToolCall?: (toolCallId: string) => Promise<ToolCallDetails>;
  /** Read one bounded UTF-8 chunk of the complete result. */
  readToolCallResult?: (
    toolCallId: string,
    byteOffset: number,
    byteLimit?: number,
  ) => Promise<ToolCallResultChunk>;
  /** Observe one bounded, read-only child transcript while its dialog is open. */
  watchSubagentTranscript?: (
    parentAgentId: string,
    childAgentId: string,
    observer: SubagentTranscriptObserver,
  ) => () => void;
  /** Voice input integration for the ask-user card. */
  voice?: VoiceInputCapability;
  /** Composer-grade reply input (paste image, completions, file drop) for the ask-user card. */
  askReply?: AskReplyComposerCapability;
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
  return getContext<ConversationUiCapabilities | undefined>(KEY) ?? {};
}
