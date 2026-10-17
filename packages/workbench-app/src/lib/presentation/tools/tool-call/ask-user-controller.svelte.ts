import { untrack } from "svelte";
import type { UserInputAnswer } from "@nervekit/contracts/core";
import type {
  VoiceInputCapability,
  VoiceInputTargetRef,
} from "../../context.svelte";
import type { UserQuestionRecord } from "../../state/tool-types";
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import type { AskUserViewQuestion } from "../views/tool-view-types";
import {
  askUserQuestionPhase,
  projectAskUserAnswers,
  type AskUserAnswerDraft,
  type AskUserDraftStore,
  type AskUserPhase,
} from "./ask-user-state";

export type AskUserControllerInput = {
  toolCall: ToolCallDisplayRecord;
  /** Questions and recorded answers parsed from the call. */
  questions: AskUserViewQuestion[];
  dismissed: boolean;
  questionRecord?: UserQuestionRecord;
  voice?: VoiceInputCapability;
  draftStore: AskUserDraftStore;
  onAnswer?: (
    toolCallId: string,
    answers: Record<string, UserInputAnswer>,
  ) => void | Promise<void>;
  onDismiss?: (toolCallId: string) => void | Promise<void>;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

/**
 * State of one ask_user card: typed answers, the in-flight resolution, and
 * voice. The question sections and the card footer's Send/Dismiss both read it,
 * so they stay in sync while living in different parts of the card.
 */
export class AskUserController {
  get drafts(): Record<string, AskUserAnswerDraft> {
    return this.#input().draftStore.get(this.toolCallId);
  }
  submitting = $state<"answer" | "dismiss" | undefined>();
  transcribingForSend = $state(false);
  error = $state<string | undefined>();
  authDialogOpen = $state(false);
  // The locally submitted resolution bridges the gap between a successful RPC
  // and the authoritative tool result arriving through durable events.
  #resolution = $state<
    | {
        toolCallId: string;
        kind: "answered";
        answers: Record<string, UserInputAnswer>;
      }
    | { toolCallId: string; kind: "dismissed" }
    | undefined
  >();
  readonly #input: () => AskUserControllerInput;

  constructor(input: () => AskUserControllerInput) {
    this.#input = input;
    let previousId: string | undefined;
    $effect(() => {
      const id = input().toolCall?.id;
      if (!id || id === previousId) return;
      previousId = id;
      untrack(() => {
        this.submitting = undefined;
        this.transcribingForSend = false;
        this.error = undefined;
        this.authDialogOpen = false;
      });
    });
    $effect(() => {
      const { toolCall, draftStore } = input();
      if (!toolCall) return;
      const id = toolCall.id;
      const settled =
        !["committed", "running", "waiting"].includes(toolCall.status) ||
        (toolCall.interaction != null &&
          toolCall.interaction.status !== "pending");
      if (settled)
        untrack(() => {
          draftStore.clear(id);
        });
    });
  }

  get resolution() {
    return this.#resolution?.toolCallId === this.toolCallId
      ? this.#resolution
      : undefined;
  }

  get toolCallId(): string {
    return this.#input().toolCall.id;
  }

  get pending(): boolean {
    const { toolCall, questionRecord } = this.#input();
    return (
      toolCall.status === "waiting" &&
      questionRecord?.status === "pending" &&
      !this.resolution
    );
  }

  get questions(): AskUserViewQuestion[] {
    const { questionRecord, questions } = this.#input();
    return this.pending && questionRecord
      ? questionRecord.questions.map((question) => ({
          ...question,
          options: question.options ?? [],
        }))
      : questions;
  }

  get dismissed(): boolean {
    const { toolCall, dismissed, questionRecord } = this.#input();
    return (
      dismissed ||
      questionRecord?.status === "dismissed" ||
      this.resolution?.kind === "dismissed" ||
      toolCall.status === "failed" ||
      toolCall.status === "denied" ||
      toolCall.status === "cancelled"
    );
  }

  get answers(): Record<string, UserInputAnswer> {
    return projectAskUserAnswers(this.questions, this.drafts);
  }

  get answeredCount(): number {
    return Object.keys(this.answers).length;
  }

  answerFor(question: AskUserViewQuestion): UserInputAnswer | undefined {
    const local =
      this.resolution?.kind === "answered"
        ? this.resolution.answers[question.id]
        : undefined;
    return question.answer ?? local;
  }

  phaseFor(question: AskUserViewQuestion): AskUserPhase {
    const { toolCall } = this.#input();
    return askUserQuestionPhase({
      pending: this.pending,
      settled:
        toolCall.status !== "committed" &&
        toolCall.status !== "running" &&
        toolCall.status !== "waiting"
          ? true
          : this.resolution !== undefined,
      dismissed: this.dismissed,
      answer: this.answerFor(question),
    });
  }

  voiceTarget(question: { id: string }): VoiceInputTargetRef {
    return { kind: "ask-user", id: `${this.toolCallId}:${question.id}` };
  }

  /** The question being recorded right now, if any. */
  get recordingTarget(): VoiceInputTargetRef | undefined {
    const { voice } = this.#input();
    if (!voice || !this.pending) return undefined;
    return this.questions
      .map((question) => this.voiceTarget(question))
      .find(
        (target) =>
          voice.session.isTargetActive(target) && voice.session.recording,
      );
  }

  get voiceActive(): boolean {
    const { voice } = this.#input();
    if (!voice || !this.pending) return false;
    return this.questions.some(
      (question) =>
        voice.session.isTargetActive(this.voiceTarget(question)) &&
        (voice.session.recording || voice.session.transcribing),
    );
  }

  update(id: string, patch: Partial<AskUserAnswerDraft>): void {
    this.#input().draftStore.update(this.toolCallId, id, patch);
  }

  /** Like the prompt composer: Send while recording = stop, transcribe, send. */
  async send(): Promise<void> {
    const { voice, onAnswer, draftStore } = this.#input();
    const toolCallId = this.toolCallId;
    if (!this.pending || this.submitting || !onAnswer) return;
    this.submitting = "answer";
    this.error = undefined;
    try {
      const target = this.recordingTarget;
      if (voice && target) {
        this.transcribingForSend = true;
        await voice.session.stop(target);
        this.transcribingForSend = false;
      }
      if (this.toolCallId !== toolCallId) return;
      const answers = this.answers;
      if (Object.keys(answers).length === 0) return;
      await onAnswer(toolCallId, answers);
      this.#resolution = { toolCallId, kind: "answered", answers };
      draftStore.clear(toolCallId);
    } catch (error) {
      if (this.toolCallId === toolCallId)
        this.error = errorMessage(error, "Could not send the answers.");
    } finally {
      if (this.toolCallId === toolCallId) {
        this.transcribingForSend = false;
        this.submitting = undefined;
      }
    }
  }

  async dismiss(): Promise<void> {
    const { onDismiss, draftStore } = this.#input();
    const toolCallId = this.toolCallId;
    if (!this.pending || this.submitting || !onDismiss) return;
    this.submitting = "dismiss";
    this.error = undefined;
    try {
      await onDismiss(toolCallId);
      this.#resolution = { toolCallId, kind: "dismissed" };
      draftStore.clear(toolCallId);
    } catch (error) {
      if (this.toolCallId === toolCallId)
        this.error = errorMessage(error, "Could not dismiss the question.");
    } finally {
      if (this.toolCallId === toolCallId) this.submitting = undefined;
    }
  }
}
