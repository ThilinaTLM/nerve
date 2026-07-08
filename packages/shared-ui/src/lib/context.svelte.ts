import type { ToolCallRecord } from "@nervekit/shared";
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
  // biome-ignore lint/suspicious/noExplicitAny: host-provided Svelte components.
  TranscriptionActivity: Component<any>;
  // biome-ignore lint/suspicious/noExplicitAny: host-provided Svelte components.
  AudioAuthDialog: Component<any>;
}

export interface ConversationUiCapabilities {
  /** Fetch a full tool-call record for the details dialog. */
  fetchToolCall?: (toolCallId: string) => Promise<ToolCallRecord>;
  /** Voice input integration for the ask-user card. */
  voice?: VoiceInputCapability;
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
